import { pool } from "../db.js";
import type { IntroState } from "../types.js";

// Auth model is an explicit open question in the backend handoff — actor
// identity vs. session identity isn't reconciled yet, so this trusts
// requesterId as given rather than deriving it from a session.
export async function requestIntro(requesterId: string, targetId: string): Promise<IntroState> {
  const { rows } = await pool.query<{ state: IntroState }>(
    `INSERT INTO intro (requester_id, target_id, state)
     VALUES ($1, $2, 'requested')
     ON CONFLICT (requester_id, target_id) DO UPDATE SET updated_at = now()
     RETURNING state`,
    [requesterId, targetId],
  );
  return rows[0].state;
}
