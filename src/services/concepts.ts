import { pool } from "../db.js";
import { getActorSummaries } from "./viewModels.js";
import type { ActorSummary } from "../types.js";

export async function getActorsForConcept(conceptId: string): Promise<ActorSummary[]> {
  const { rows } = await pool.query<{ actor_id: string }>(
    `SELECT DISTINCT ac.actor_id
     FROM actor_concept ac
     JOIN actor a ON a.id = ac.actor_id
     WHERE ac.concept_id = $1 AND ac.visibility <> 'private' AND a.discoverable = true`,
    [conceptId],
  );
  const summaries = await getActorSummaries(rows.map((r) => r.actor_id));
  return [...summaries.values()];
}
