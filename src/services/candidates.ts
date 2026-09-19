import { pool } from "../db.js";

const CANDIDATE_CAP = 2000;
const IDF_FLOOR = 0.5; // below this, a concept is common enough to ignore as a signal

// Candidate generation, data model handoff section 6: actors sharing any
// above-floor concept, plus actors reachable in two edge-hops (actor ->
// shared context <- actor). No model involvement, capped so exact scoring
// stays cheap.
export async function getCandidateActorIds(actorId: string): Promise<string[]> {
  const { rows } = await pool.query<{ actor_id: string }>(
    `
    WITH my_concepts AS (
      SELECT concept_id FROM actor_concept
      WHERE actor_id = $1 AND visibility <> 'private'
    ),
    concept_neighbors AS (
      SELECT DISTINCT ac.actor_id
      FROM actor_concept ac
      JOIN my_concepts mc ON mc.concept_id = ac.concept_id
      JOIN concept_idf idf ON idf.concept_id = ac.concept_id
      WHERE ac.actor_id <> $1 AND ac.visibility <> 'private' AND idf.idf >= $3
    ),
    my_contexts AS (
      SELECT dst_id, dst_type FROM edge
      WHERE src_id = $1 AND src_type = 'actor' AND visibility <> 'private'
        AND (valid_to IS NULL OR valid_to >= current_date)
    ),
    context_neighbors AS (
      SELECT DISTINCT e.src_id AS actor_id
      FROM edge e
      JOIN my_contexts mc ON mc.dst_id = e.dst_id AND mc.dst_type = e.dst_type
      WHERE e.src_type = 'actor' AND e.src_id <> $1 AND e.visibility <> 'private'
        AND (e.valid_to IS NULL OR e.valid_to >= current_date)
    ),
    combined AS (
      SELECT actor_id FROM concept_neighbors
      UNION
      SELECT actor_id FROM context_neighbors
    )
    SELECT c.actor_id
    FROM combined c
    JOIN actor a ON a.id = c.actor_id
    WHERE a.discoverable = true
    LIMIT $2
    `,
    [actorId, CANDIDATE_CAP, IDF_FLOOR],
  );
  return rows.map((r) => r.actor_id);
}
