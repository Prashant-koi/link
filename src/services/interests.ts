import { pool } from "../db.js";
import type { Stance } from "../types.js";

export interface InterestRow {
  id: string;
  rawText: string;
  conceptLabel: string | null;
  stance: Stance;
  visibility: "public" | "institution" | "private";
  resolved: boolean;
  /** Set once the interest resolves to a concept; lets the client match it against people. */
  conceptId: string | null;
}

// Backend gap surfaced by the Settings page (frontend handoff §6): editing
// per-interest visibility needs a listing with ids, which ActorSummary's
// capped/anonymous-of-id topConcepts doesn't provide.
export async function listInterests(actorId: string): Promise<InterestRow[]> {
  const { rows } = await pool.query(
    `SELECT ac.id, ac.raw_text, ac.stance, ac.visibility, ac.concept_id, c.pref_label
     FROM actor_concept ac
     LEFT JOIN concept c ON c.id = ac.concept_id
     WHERE ac.actor_id = $1
     ORDER BY ac.resolved_at DESC NULLS FIRST`,
    [actorId],
  );
  return rows.map((row) => ({
    id: row.id,
    rawText: row.raw_text,
    conceptLabel: row.pref_label,
    stance: row.stance,
    visibility: row.visibility,
    resolved: row.pref_label !== null,
    conceptId: row.concept_id ?? null,
  }));
}

export async function setInterestVisibility(
  actorId: string,
  interestId: string,
  visibility: "public" | "institution" | "private",
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE actor_concept SET visibility = $3 WHERE id = $2 AND actor_id = $1`,
    [actorId, interestId, visibility],
  );
  return result.rowCount === 1;
}
