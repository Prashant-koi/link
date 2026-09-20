import { pool, withTransaction } from "../db.js";
import { config } from "../config.js";
import { embed } from "../modelRuntime.js";
import { enqueue } from "../queue.js";

// "Re-resolution is a button, not a migration" (backend handoff, supporting
// services): after the model runtime comes up, or improves, replay whatever
// it couldn't do before. Idempotent — safe to run any number of times.
//
// Order matters. Concept embeddings go first and are written directly, before
// any resolution job is queued: resolving against an empty vector index would
// send every string down the "propose a new concept" path.

const BATCH = config.workers.embeddingBatchSize;

function vectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

async function embedMissingConcepts(): Promise<number> {
  const { rows } = await pool.query<{ id: string; definition: string }>(
    `SELECT id, definition FROM concept WHERE embedding IS NULL ORDER BY id`,
  );
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const vectors = await embed(batch.map((r) => r.definition), "document");
    for (let j = 0; j < batch.length; j++) {
      await pool.query(`UPDATE concept SET embedding = $2::vector WHERE id = $1`, [batch[j].id, vectorLiteral(vectors[j])]);
    }
    console.log(`  embedded ${Math.min(i + BATCH, rows.length)}/${rows.length} concepts`);
  }
  return rows.length;
}

// Unresolved rows that have no resolution job already waiting. The old
// needs_review job for a row is closed out so counts of "parked" work reflect
// reality afterwards, instead of still showing rows that have since resolved.
async function requeueUnresolved(table: "actor_concept" | "ask_concept"): Promise<number> {
  const target = table;
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string; raw_text: string }>(
      `SELECT t.id, t.raw_text FROM ${table} t
       WHERE t.concept_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM job j
           WHERE j.kind = 'resolve_concept' AND j.state IN ('pending', 'running')
             AND j.payload->>'targetId' = t.id::text)`,
    );
    for (const row of rows) {
      await client.query(
        `UPDATE job SET state = 'done', last_error = coalesce(last_error, '') || ' [superseded by reprocess]'
         WHERE kind = 'resolve_concept' AND state = 'needs_review' AND payload->>'targetId' = $1`,
        [row.id],
      );
      await enqueue(client, "resolve_concept", { target, targetId: row.id, rawText: row.raw_text });
    }
    return rows.length;
  });
}

// Only jobs that failed because the model was unreachable. explain_pair is
// deliberately not requeued: its cache key includes a graph_version that has
// moved on, so a stale result would never be read — it regenerates on demand.
async function requeueModelFailures(): Promise<{ requeued: number; staleExplain: number }> {
  const requeued = await pool.query(
    `UPDATE job SET state = 'pending', attempts = 0, last_error = NULL, run_after = now()
     WHERE state = 'failed' AND kind IN ('parse_ask', 'extract_bio') AND last_error ILIKE '%LLM_BASE_URL%'`,
  );
  const stale = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM job WHERE state = 'failed' AND kind = 'explain_pair'`,
  );
  return { requeued: requeued.rowCount ?? 0, staleExplain: Number(stale.rows[0].n) };
}

async function main() {
  if (!config.llm.baseUrl) {
    throw new Error("LLM_BASE_URL is not set — nothing to reprocess against");
  }

  console.log("1/3 embedding concepts with no embedding...");
  const embedded = await embedMissingConcepts();

  console.log("2/3 requeueing unresolved interests...");
  const interests = await requeueUnresolved("actor_concept");
  const asks = await requeueUnresolved("ask_concept");

  console.log("3/3 requeueing model failures...");
  const { requeued, staleExplain } = await requeueModelFailures();

  console.log(
    `\nembedded ${embedded} concept(s); queued ${interests} interest(s) + ${asks} ask requirement(s) for resolution; ` +
      `requeued ${requeued} failed job(s); left ${staleExplain} stale explain_pair failure(s) alone (regenerated on demand).`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
