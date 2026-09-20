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

// "query" = a messy string being looked up; "document" = a concept definition
// being indexed. nomic-embed-text is trained with a different prefix for
// each, so the two sides of the kNN match have to say which they are.
export type EmbedKind = "query" | "document";

// Batches up to embeddingBatchSize texts per request against the
// OpenAI-compatible /embeddings endpoint.
export async function embed(texts: string[], kind: EmbedKind): Promise<number[][]> {
  if (texts.length === 0) return [];
  const prefix = kind === "query" ? config.llm.embedQueryPrefix : config.llm.embedDocumentPrefix;
  const prefixed = texts.map((t) => prefix + t);
  const batches: string[][] = [];
  for (let i = 0; i < prefixed.length; i += config.workers.embeddingBatchSize) {
    batches.push(prefixed.slice(i, i + config.workers.embeddingBatchSize));
  }

  const results: number[][][] = await Promise.all(
    batches.map((batch) =>
      embeddingPool.run(async () => {
        const res = await fetch(llmUrl("/v1/embeddings"), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ model: config.llm.embeddingModel, input: batch }),
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
        ...(config.llm.reasoningEffort ? { reasoning_effort: config.llm.reasoningEffort } : {}),
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
      choices: Array<{ message: { content: string | null }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = json.choices[0].message.content;
    if (!content?.trim()) {
      // The signature of a thinking model that spent its whole budget
      // reasoning — say so, instead of surfacing a bare JSON.parse error.
      throw new Error(
        `instruct model returned empty content for ${prompt.name} ` +
          `(finish_reason=${json.choices[0].finish_reason}; if this is a thinking model, LLM_REASONING_EFFORT must be "none")`,
      );
    }
    return {
      text: content,
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

// Ollama unloads an idle model after ~5 minutes, and the next call then pays
// a full reload (measured: ~14s for the embedder, ~46s for qwen3.8). A
// `keep_alive: -1` field on /v1/* requests is accepted but ignored, and every
// /v1 request resets the expiry to the 5-minute default anyway — so the
// models are pinned through Ollama's native /api/generate with an empty
// prompt (loads, no generation) or a one-word embed, repeated inside the idle window. Best-effort
// and Ollama-specific: against any other runtime it just fails quietly.
async function pinModel(model: string, kind: "embedding" | "chat"): Promise<void> {
  if (!model) return;
  try {
    // An embedding model refuses /api/generate, so it is pinned with a tiny
    // /api/embed instead; both native endpoints honour keep_alive.
    const [path, body] =
      kind === "embedding"
        ? ["/api/embed", { model, input: "warm", keep_alive: -1 }]
        : ["/api/generate", { model, keep_alive: -1 }];
    await fetch(llmUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
  } catch {
    // Not fatal: the next real request will just pay the load time.
  }
}

export function keepModelsWarm(): void {
  if (!config.llm.baseUrl) return;
  const pinAll = () =>
    Promise.all([pinModel(config.llm.embeddingModel, "embedding"), pinModel(config.llm.instructModel, "chat")]);
  void pinAll();
  setInterval(() => void pinAll(), 2 * 60 * 1000).unref();
}

// ---- Streaming chat ---------------------------------------------------------
// Free-text answers for the AI assistant, streamed from Ollama's native
// /api/chat (NDJSON). Deliberately does not set `num_ctx`: the model is already
// loaded with the default window, and asking for a different one forces a full
// reload (~46 s). The caller keeps its prompt inside a budget instead.
export interface ChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatStreamEvent {
  delta?: string;
  done?: boolean;
  promptTokens?: number;
  outputTokens?: number;
}

const generationPool = new Semaphore(2); // protect the GPU from a pile of long answers

export async function* streamChat(
  messages: ChatTurn[],
  opts: { signal?: AbortSignal; temperature?: number; maxTokens?: number } = {},
): AsyncGenerator<ChatStreamEvent> {
  const release = await acquire(generationPool, opts.signal);
  try {
    const res = await fetch(llmUrl("/api/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      signal: opts.signal,
      body: JSON.stringify({
        model: config.llm.instructModel,
        stream: true,
        think: false,
        messages,
        options: { temperature: opts.temperature ?? 0.3, num_predict: opts.maxTokens ?? 1200 },
      }),
    });
    if (!res.ok || !res.body) throw new Error(`chat request failed: ${res.status} ${await res.text().catch(() => "")}`);

    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const json = JSON.parse(line) as {
          message?: { content?: string };
          done?: boolean;
          prompt_eval_count?: number;
          eval_count?: number;
          error?: string;
        };
        if (json.error) throw new Error(json.error);
        if (json.message?.content) yield { delta: json.message.content };
        if (json.done) yield { done: true, promptTokens: json.prompt_eval_count, outputTokens: json.eval_count };
      }
    }
  } finally {
    release();
  }
}

// Semaphore.run wraps a function; a generator needs an explicit acquire/release.
function acquire(sem: Semaphore, signal?: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    let started = false;
    const onAbort = () => reject(new Error("aborted"));
    signal?.addEventListener("abort", onAbort, { once: true });
    void sem.run(
      () =>
        new Promise<void>((done) => {
          started = true;
          signal?.removeEventListener("abort", onAbort);
          resolve(() => done());
        }),
    );
    if (signal?.aborted && !started) onAbort();
  });
}
