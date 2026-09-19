import { pool } from "../db.js";
import type { Stance } from "../types.js";

export interface InterestRow {
  id: string;
  rawText: string;
  conceptLabel: string | null;
  stance: Stance;
  visibility: "public" | "institution" | "private";
  resolved: boolean;
}

// Backend gap surfaced by the Settings page (frontend handoff §6): editing
// per-interest visibility needs a listing with ids, which ActorSummary's
// capped/anonymous-of-id topConcepts doesn't provide.
export async function listInterests(actorId: string): Promise<InterestRow[]> {
  const { rows } = await pool.query(
    `SELECT ac.id, ac.raw_text, ac.stance, ac.visibility, c.pref_label
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
  }));
}

export async function setInterestVisibility(
  interestId: string,
  visibility: "public" | "institution" | "private",
): Promise<void> {
  await pool.query(`UPDATE actor_concept SET visibility = $2 WHERE id = $1`, [interestId, visibility]);
}
