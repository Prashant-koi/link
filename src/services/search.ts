import { pool } from "../db.js";
import { getMaxIdf, normalizeRarity } from "./idf.js";
import { getActorSummary } from "./viewModels.js";
import type { ActorSummary, ConceptChip } from "../types.js";

export type SearchResult =
  | { type: "actor"; actor: ActorSummary }
  | { type: "concept"; concept: ConceptChip };

const LIMIT_PER_KIND = 10;

// GET /search?q=: mixed actor + concept results, visibility applied at the
// boundary (non-discoverable actors are simply absent, not flagged).
export async function search(q: string): Promise<SearchResult[]> {
  const like = `%${q}%`;

  const actorRows = await pool.query<{ id: string }>(
    `SELECT id FROM actor WHERE discoverable = true AND display_name ILIKE $1 LIMIT $2`,
    [like, LIMIT_PER_KIND],
  );
  const actors: SearchResult[] = [];
  for (const row of actorRows.rows) {
    const summary = await getActorSummary(row.id);
    if (summary) actors.push({ type: "actor", actor: summary });
  }

  const maxIdf = await getMaxIdf();
  const conceptRows = await pool.query(
    `SELECT c.id, c.pref_label, coalesce(idf.idf, 0) AS idf
     FROM concept c
     LEFT JOIN concept_idf idf ON idf.concept_id = c.id
     WHERE c.pref_label ILIKE $1
        OR EXISTS (SELECT 1 FROM concept_alias ca WHERE ca.concept_id = c.id AND ca.surface ILIKE $1)
     LIMIT $2`,
    [like, LIMIT_PER_KIND],
  );
  const concepts: SearchResult[] = conceptRows.rows.map((row) => ({
    type: "concept",
    concept: {
      conceptId: row.id,
      label: row.pref_label,
      shownAs: row.pref_label,
      rarity: normalizeRarity(row.idf, maxIdf),
    },
  }));

  return [...actors, ...concepts];
}
