import { pool } from "../db.js";

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
