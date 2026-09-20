import { pool } from "../db.js";

// concept_idf is a materialized view, so a concept resolved a second ago is
// absent from it until it is refreshed — and an absent row means the concept
// is dropped by every inner join on the read path (topConcepts, candidate
// generation, scoring). Live ingestion therefore has to refresh it, not just
// a nightly schedule. CONCURRENTLY needs the unique index from migration
// 0002 and keeps readers unblocked; it cannot run inside a transaction.
export async function refreshConceptIdf(): Promise<void> {
  try {
    await pool.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY concept_idf`);
  } catch (err) {
    // A refresh racing another refresh is not worth failing a job over; the
    // next resolved concept triggers another one.
    console.warn("concept_idf refresh skipped:", err instanceof Error ? err.message : err);
  }
}

export async function getMaxIdf(): Promise<number> {
  const { rows } = await pool.query<{ max: number }>(`SELECT max(idf) AS max FROM concept_idf`);
  return rows[0]?.max ?? 0;
}

// idf(c) can be negative (a concept held by most of the population) — the
// raw data model formula allows that, but ConceptChip.rarity is documented
// as 0..1, so both ends need clamping, not just the upper one.
export function normalizeRarity(idf: number, maxIdf: number): number {
  if (maxIdf <= 0) return 0;
  return Math.max(0, Math.min(idf / maxIdf, 1));
}
