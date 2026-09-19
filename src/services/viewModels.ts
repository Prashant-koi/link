import { pool } from "../db.js";
import { getMaxIdf, normalizeRarity } from "./idf.js";
import type { ActorSummary, ConceptChip, ContactBlock } from "../types.js";

const TOP_CONCEPTS_CAP = 5;

async function getContactBlock(actorId: string, hasAccount: boolean): Promise<ContactBlock> {
  const { rows } = await pool.query(
    `SELECT kind, value, label FROM actor_contact_method
     WHERE actor_id = $1 AND visibility <> 'private'
     ORDER BY sort_order`,
    [actorId],
  );
  return {
    hasAccount,
    methods: rows.map((row) => ({ kind: row.kind, value: row.value, label: row.label ?? undefined })),
  };
}

async function getTopConcepts(actorId: string): Promise<ConceptChip[]> {
  const maxIdf = await getMaxIdf();
  const { rows } = await pool.query(
    `SELECT c.id AS concept_id, c.pref_label, ac.raw_text, idf.idf
     FROM actor_concept ac
     JOIN concept c ON c.id = ac.concept_id
     JOIN concept_idf idf ON idf.concept_id = c.id
     WHERE ac.actor_id = $1 AND ac.visibility <> 'private'
     ORDER BY idf.idf DESC
     LIMIT $2`,
    [actorId, TOP_CONCEPTS_CAP],
  );
  return rows.map((row) => ({
    conceptId: row.concept_id,
    label: row.pref_label,
    shownAs: row.raw_text,
    rarity: normalizeRarity(row.idf, maxIdf),
  }));
}

export async function getActorSummary(actorId: string): Promise<ActorSummary | null> {
  const { rows } = await pool.query(
    `SELECT a.id, a.kind, a.person_kind, a.display_name, a.has_account,
            hu.id AS home_unit_id, hu.display_name AS home_unit_name
     FROM actor a
     LEFT JOIN actor hu ON hu.id = a.home_unit
     WHERE a.id = $1`,
    [actorId],
  );
  if (rows.length === 0) return null;
  const row = rows[0];

  return {
    id: row.id,
    kind: row.kind,
    personKind: row.person_kind ?? undefined,
    displayName: row.display_name,
    homeUnit: row.home_unit_id ? { id: row.home_unit_id, name: row.home_unit_name } : undefined,
    topConcepts: await getTopConcepts(actorId),
    contact: await getContactBlock(actorId, row.has_account),
  };
}

export async function getActorSummaries(actorIds: string[]): Promise<Map<string, ActorSummary>> {
  const result = new Map<string, ActorSummary>();
  // Small candidate counts (<=2000) — sequential per-actor fetch keeps this
  // readable; batch it if suggestion latency ever shows up as a problem.
  for (const id of actorIds) {
    const summary = await getActorSummary(id);
    if (summary) result.set(id, summary);
  }
  return result;
}
