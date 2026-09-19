import { pool, withTransaction } from "../db.js";
import { runStructuredPrompt } from "../modelRuntime.js";
import { getActivePrompt } from "../promptRegistry.js";
import { claim, complete, enqueue, fail, needsReview, type Job } from "../queue.js";
import { embedConceptDefinition, resolveRawText } from "../services/resolution.js";

const JOB_KINDS = ["resolve_concept", "embed", "extract_bio", "explain_pair", "parse_ask"] as const;

async function handleResolveConcept(job: Job): Promise<void> {
  const { target, targetId, rawText } = job.payload as {
    target: "actor_concept" | "ask_concept";
    targetId: string;
    rawText: string;
  };

  const result = await resolveRawText(rawText);

  if (result.status === "needs_review") {
    await needsReview(job.id, result.reason);
    return;
  }

  const table = target === "ask_concept" ? "ask_concept" : "actor_concept";
  await pool.query(
    `UPDATE ${table} SET concept_id = $2, resolved_at = now() WHERE id = $1`,
    [targetId, result.conceptId],
  );
  await complete(job.id);
}

async function handleEmbed(job: Job): Promise<void> {
  const { conceptId } = job.payload as { conceptId: string };
  await embedConceptDefinition(conceptId);
  await complete(job.id);
}

async function handleExtractBio(job: Job): Promise<void> {
  const { actorId, sourceText } = job.payload as { actorId: string; sourceText: string };
  const prompt = await getActivePrompt("bio_extract");
  const { parsed } = await runStructuredPrompt(prompt, { source_text: sourceText });
  const items = Array.isArray(parsed.items) ? (parsed.items as string[]) : [];

  await withTransaction(async (client) => {
    for (const rawText of items) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO actor_concept (actor_id, raw_text, source) VALUES ($1, $2, 'llm') RETURNING id`,
        [actorId, rawText],
      );
      await enqueue(client, "resolve_concept", {
        target: "actor_concept",
        targetId: rows[0].id,
        rawText,
      });
    }
  });
  await complete(job.id);
}

async function handleExplainPair(job: Job): Promise<void> {
  const { evidence_path, graph_version } = job.payload as {
    evidence_path: string;
    graph_version: string;
  };
  const prompt = await getActivePrompt("explain_pair");
  // The call's own result caches under (prompt, evidence_path, graph_version)
  // via input_hash — this write is what attachCachedProse later finds.
  await runStructuredPrompt(prompt, { evidence_path, graph_version });
  await complete(job.id);
}

async function handleParseAsk(job: Job): Promise<void> {
  const { askId, text } = job.payload as { askId: string; text: string };
  const prompt = await getActivePrompt("parse_ask");
  const { parsed } = await runStructuredPrompt(prompt, { ask_text: text });
  const requires = Array.isArray(parsed.requires) ? (parsed.requires as string[]) : [];

  await withTransaction(async (client) => {
    for (const rawText of requires) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO ask_concept (ask_id, raw_text) VALUES ($1, $2) RETURNING id`,
        [askId, rawText],
      );
      await enqueue(client, "resolve_concept", {
        target: "ask_concept",
        targetId: rows[0].id,
        rawText,
      });
    }
  });
  await complete(job.id);
}

async function dispatch(job: Job): Promise<void> {
  switch (job.kind) {
    case "resolve_concept":
      return handleResolveConcept(job);
    case "embed":
      return handleEmbed(job);
    case "extract_bio":
      return handleExtractBio(job);
    case "explain_pair":
      return handleExplainPair(job);
    case "parse_ask":
      return handleParseAsk(job);
  }
}

// The resolution worker is the only process that talks to the model
// runtime; all graph reasoning (candidate generation, threshold branching)
// lives in services/resolution.ts, testable independently of the GPU.
export async function runOnce(workerId: string, batchSize: number): Promise<number> {
  const jobs = await claim([...JOB_KINDS], workerId, batchSize);
  for (const job of jobs) {
    try {
      await dispatch(job);
    } catch (err) {
      await fail(job.id, err instanceof Error ? err.message : String(err));
    }
  }
  return jobs.length;
}

export async function runForever(workerId: string, pollIntervalMs: number, batchSize = 10): Promise<never> {
  for (;;) {
    const claimed = await runOnce(workerId, batchSize);
    if (claimed === 0) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }
}
