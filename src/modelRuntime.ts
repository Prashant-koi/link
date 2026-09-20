import { createHash } from "node:crypto";
import { config } from "./config.js";
import { pool } from "./db.js";
import type { RegisteredPrompt } from "./promptRegistry.js";

// A tiny counting semaphore. The embedding and instruct pools get separate
// instances so a 40k-item embedding backlog never queues behind a
// four-second generation, and instruct concurrency stays pinned to 1-2 so a
// single GPU's KV cache isn't thrashed by concurrent sequences.
class Semaphore {
  private queue: Array<() => void> = [];
  private available: number;

  constructor(concurrency: number) {
    this.available = concurrency;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.available <= 0) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.available--;
    try {
      return await fn();
    } finally {
      this.available++;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

const embeddingPool = new Semaphore(config.workers.embeddingConcurrency);
const instructPool = new Semaphore(config.workers.instructConcurrency);

function llmUrl(pathname: string): string {
  if (!config.llm.baseUrl) {
    throw new Error("LLM_BASE_URL is not set — model runtime is unavailable");
  }
  return new URL(pathname, config.llm.baseUrl).toString();
}

function authHeaders(): Record<string, string> {
  return config.llm.apiKey ? { Authorization: `Bearer ${config.llm.apiKey}` } : {};
}

// Batches up to embeddingBatchSize texts per request against the
// OpenAI-compatible /embeddings endpoint.
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += config.workers.embeddingBatchSize) {
    batches.push(texts.slice(i, i + config.workers.embeddingBatchSize));
  }

  const results: number[][][] = await Promise.all(
    batches.map((batch) =>
      embeddingPool.run(async () => {
        const res = await fetch(llmUrl("/v1/embeddings"), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          // keep_alive: Ollama unloads an idle model after a few minutes and
          // the next request pays a full reload; -1 keeps it resident. A
          // no-op field for any other OpenAI-compatible runtime.
          body: JSON.stringify({ model: config.llm.embeddingModel, input: batch, keep_alive: -1 }),
        });
        if (!res.ok) {
          throw new Error(`embedding request failed: ${res.status} ${await res.text()}`);
        }
        const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
        return json.data.map((d) => d.embedding);
      }),
    ),
  );

  return results.flat();
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "");
}

export function hashRenderedInput(userMessage: string): string {
  return createHash("sha256").update(userMessage).digest("hex");
}

// Looks up a cached result for (prompt, vars) without calling the model —
// same rendering + hashing runStructuredPrompt uses, so a cache check and
// the write that eventually satisfies it always agree on the key.
export async function getCachedPromptResult(
  prompt: RegisteredPrompt,
  vars: Record<string, string>,
): Promise<Record<string, unknown> | null> {
  const inputHash = hashRenderedInput(renderTemplate(prompt.user_template, vars));
  const { rows } = await pool.query(
    `SELECT parsed FROM llm_call WHERE prompt_name = $1 AND prompt_version = $2 AND input_hash = $3`,
    [prompt.name, prompt.version, inputHash],
  );
  return rows.length > 0 ? rows[0].parsed : null;
}

export interface AdjudicationResult {
  parsed: Record<string, unknown>;
  fromCache: boolean;
}

// Runs a structured instruct call against the given prompt + input variables.
// Output is constrained by prompt.params.json_schema (guided JSON / GBNF on
// the runtime side), not parsed from free text — a malformed response is a
// runtime error, never a silent data bug. Identical (prompt, input) pairs
// are served from llm_call without touching the GPU.
export async function runStructuredPrompt(
  prompt: RegisteredPrompt,
  vars: Record<string, string>,
): Promise<AdjudicationResult> {
  const userMessage = renderTemplate(prompt.user_template, vars);
  const inputHash = hashRenderedInput(userMessage);

  const cached = await pool.query(
    `SELECT parsed FROM llm_call WHERE prompt_name = $1 AND prompt_version = $2 AND input_hash = $3`,
    [prompt.name, prompt.version, inputHash],
  );
  if (cached.rows.length > 0) {
    return { parsed: cached.rows[0].parsed, fromCache: true };
  }

  const params = (prompt.params ?? {}) as {
    temperature?: number;
    max_tokens?: number;
    json_schema?: Record<string, unknown>;
  };

  const started = Date.now();
  const { text, tokensIn, tokensOut } = await instructPool.run(async () => {
    const res = await fetch(llmUrl("/v1/chat/completions"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        model: config.llm.instructModel,
        temperature: params.temperature ?? 0,
        max_tokens: params.max_tokens ?? 300,
        keep_alive: -1, // Ollama: stays resident: 128GB unified memory, no reason to reload
        messages: [
          { role: "system", content: prompt.system_body },
          { role: "user", content: userMessage },
        ],
        // vLLM / llama.cpp guided-JSON extension: constrains generation to
        // the schema rather than hoping the model free-texts valid JSON.
        response_format: params.json_schema
          ? { type: "json_schema", json_schema: { name: prompt.name, schema: params.json_schema } }
          : { type: "json_object" },
        // Ollama's own structured-output extension (deployment handoff,
        // "Wiring the worker"): takes the schema directly rather than
        // wrapped in response_format. Ignored by a strict OpenAI/vLLM
        // server, so both runtimes get constrained output from one call.
        ...(params.json_schema ? { format: params.json_schema } : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(`instruct request failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: json.choices[0].message.content,
      tokensIn: json.usage?.prompt_tokens ?? null,
      tokensOut: json.usage?.completion_tokens ?? null,
    };
  });

  const parsed = JSON.parse(text) as Record<string, unknown>;

  await pool.query(
    `INSERT INTO llm_call
       (prompt_name, prompt_version, input_hash, raw_output, parsed, model, latency_ms, tokens_in, tokens_out)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
     ON CONFLICT (prompt_name, prompt_version, input_hash) DO NOTHING`,
    [
      prompt.name,
      prompt.version,
      inputHash,
      text,
      JSON.stringify(parsed),
      prompt.model,
      Date.now() - started,
      tokensIn,
      tokensOut,
    ],
  );

  return { parsed, fromCache: false };
}
