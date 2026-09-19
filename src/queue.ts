import { pool } from "./db.js";
import type { Queryable } from "./db.js";

export type JobKind = "resolve_concept" | "embed" | "extract_bio" | "explain_pair" | "parse_ask";
export type JobState = "pending" | "running" | "done" | "failed" | "needs_review";

export interface Job {
  id: number;
  kind: JobKind;
  payload: Record<string, unknown>;
  state: JobState;
  attempts: number;
}

// Enqueue against whatever connection the caller passes in, so the insert
// that creates the work item and the enqueue land in the same transaction.
export async function enqueue(
  db: Queryable,
  kind: JobKind,
  payload: Record<string, unknown>,
  runAfter?: Date,
): Promise<number> {
  const result = await db.query(
    `INSERT INTO job (kind, payload, run_after)
     VALUES ($1, $2::jsonb, coalesce($3, now()))
     RETURNING id`,
    [kind, JSON.stringify(payload), runAfter ?? null],
  );
  return result.rows[0].id as number;
}

// Claims up to `limit` pending jobs of the given kinds with
// SELECT ... FOR UPDATE SKIP LOCKED: correct concurrent draining across
// worker processes with no external coordination.
export async function claim(
  kinds: JobKind[],
  workerId: string,
  limit: number,
): Promise<Job[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT id FROM job
       WHERE state = 'pending' AND run_after <= now() AND kind = ANY($1)
       ORDER BY run_after
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      [kinds, limit],
    );
    const ids = rows.map((r) => r.id as number);
    if (ids.length === 0) {
      await client.query("COMMIT");
      return [];
    }
    const claimed = await client.query(
      `UPDATE job SET state = 'running', locked_by = $2, locked_at = now(), attempts = attempts + 1
       WHERE id = ANY($1)
       RETURNING id, kind, payload, state, attempts`,
      [ids, workerId],
    );
    await client.query("COMMIT");
    return claimed.rows as Job[];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function complete(jobId: number): Promise<void> {
  await pool.query(`UPDATE job SET state = 'done' WHERE id = $1`, [jobId]);
}

// needs_review is terminal, not a failure: the row sits inert until a human
// acts, and nothing downstream reads it until then.
export async function needsReview(jobId: number, reason: string): Promise<void> {
  await pool.query(
    `UPDATE job SET state = 'needs_review', last_error = $2 WHERE id = $1`,
    [jobId, reason],
  );
}

export async function fail(jobId: number, error: string): Promise<void> {
  await pool.query(
    `UPDATE job SET state = 'failed', last_error = $2 WHERE id = $1`,
    [jobId, error],
  );
}
