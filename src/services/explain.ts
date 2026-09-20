import { pool } from "../db.js";
import { getCachedPromptResult } from "../modelRuntime.js";
import { getActivePrompt } from "../promptRegistry.js";
import { enqueue } from "../queue.js";
import type { Reason } from "../types.js";

export async function getGraphVersion(): Promise<number> {
  const { rows } = await pool.query<{ version: string }>(`SELECT version FROM graph_version WHERE id = true`);
  return Number(rows[0]?.version ?? 1);
}

function evidencePathText(reason: Reason): string {
  return reason.evidence.map((e) => `${e.kind}:${e.label}`).join(", ");
}

// Both user-visible model paths (explain_pair, parse_ask) are designed so
// the model is optional: this renders the template summary immediately and
// upgrades to prose only when a cached result already exists — it never
// calls the model inline. A cache miss enqueues a background job instead,
// and the next request picks up the prose once the cache warms.
export async function attachCachedProse(
  actorA: string,
  actorB: string,
  reason: Reason,
  graphVersion: number,
): Promise<Reason> {
  const prompt = await getActivePrompt("explain_pair").catch(() => null);
  if (!prompt) return reason;

  const vars = { evidence_path: evidencePathText(reason), graph_version: String(graphVersion) };
  const cached = await getCachedPromptResult(prompt, vars);

  if (cached && typeof cached.prose === "string") {
    return { ...reason, prose: cached.prose };
  }

  // The prose cache is keyed on (evidence_path, graph_version) alone — the
  // worker never looks at the actors — so an identical job that is already
  // waiting or running will produce exactly this result. Without this guard
  // every suggestions request re-enqueued one job per reason.
  const alreadyQueued = await pool.query(
    `SELECT 1 FROM job
     WHERE kind = 'explain_pair' AND state IN ('pending', 'running')
       AND payload->>'evidence_path' = $1 AND payload->>'graph_version' = $2
     LIMIT 1`,
    [vars.evidence_path, vars.graph_version],
  );
  if (alreadyQueued.rows.length === 0) {
    await enqueue(pool, "explain_pair", { actorA, actorB, ...vars });
  }
  return reason;
}
