import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { config } from "../config.js";
import { embed } from "../modelRuntime.js";
import { normalizeSurface } from "../services/normalize.js";
import { stableUuid, type Rng } from "./rng.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUBSET_PATH = path.join(__dirname, "..", "..", "db", "seed-data", "cso-subset.json");

interface CsoConcept {
  label: string;
  depth: number;
  parentLabel: string | null;
  branch: string;
  definition: string;
  acronym: string | null;
}

interface CsoSubset {
  concepts: CsoConcept[];
  aliases: { surface: string; conceptLabel: string }[];
  relations: { srcLabel: string; dstLabel: string; kind: "broader" | "related" }[];
}

export interface LoadedConcept {
  id: string;
  label: string;
  definition: string;
  depth: number;
  branch: string;
  acronym: string | null;
  altLabels: string[];
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

// Stages 2-3: load the real CSO subset (see db/seed-data/README.md) into
// concept/concept_alias/concept_relation, then embed definitions. Concept
// ids are derived from the label only (stableUuid, not seed-dependent) —
// the ontology is fixed data, so it shouldn't reshuffle across --seed
// values the way person/context generation does.
export async function loadCsoSubset(
  client: pg.PoolClient,
  rng: Rng,
  opts: { skipEmbeddings: boolean },
): Promise<LoadedConcept[]> {
  const raw = await readFile(SUBSET_PATH, "utf8");
  const subset: CsoSubset = JSON.parse(raw);

  const idByLabel = new Map<string, string>();
  for (const c of subset.concepts) idByLabel.set(c.label, stableUuid("concept", c.label));

  const altLabelsByConcept = new Map<string, string[]>();
  for (const a of subset.aliases) {
    if (!altLabelsByConcept.has(a.conceptLabel)) altLabelsByConcept.set(a.conceptLabel, []);
    altLabelsByConcept.get(a.conceptLabel)!.push(a.surface);
  }

  for (const c of subset.concepts) {
    const id = idByLabel.get(c.label)!;
    await client.query(
      `INSERT INTO concept (id, pref_label, definition, depth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET pref_label = $2, definition = $3, depth = $4`,
      [id, c.label, c.definition, c.depth],
    );
    // A concept's own canonical label needs an exact-alias row too —
    // without this, typing the term *exactly right* still misses the fast
    // path for any concept that happens to have no other seeded aliases.
    await client.query(
      `INSERT INTO concept_alias (surface, surface_norm, concept_id, source, confidence)
       VALUES ($1, $2, $3, 'seed', 1.0)
       ON CONFLICT (surface_norm) DO NOTHING`,
      [c.label, normalizeSurface(c.label), id],
    );
  }

  for (const a of subset.aliases) {
    const conceptId = idByLabel.get(a.conceptLabel);
    if (!conceptId) continue;
    await client.query(
      `INSERT INTO concept_alias (surface, surface_norm, concept_id, source, confidence)
       VALUES ($1, $2, $3, 'seed', 1.0)
       ON CONFLICT (surface_norm) DO NOTHING`,
      [a.surface, normalizeSurface(a.surface), conceptId],
    );
  }

  // Deliberate asymmetry (seed data handoff, "Surface variants"): only
  // about half of eligible acronyms get seeded as an alias. The other half
  // must genuinely go through vector match or the model, so the demo can
  // show both resolution paths rather than everything landing on the fast
  // exact-alias path.
  for (const c of subset.concepts) {
    if (!c.acronym) continue;
    if (!rng.bool(0.5)) continue;
    const conceptId = idByLabel.get(c.label)!;
    await client.query(
      `INSERT INTO concept_alias (surface, surface_norm, concept_id, source, confidence)
       VALUES ($1, $2, $3, 'seed', 1.0)
       ON CONFLICT (surface_norm) DO NOTHING`,
      [c.acronym, normalizeSurface(c.acronym), conceptId],
    );
  }

  for (const r of subset.relations) {
    const src = idByLabel.get(r.srcLabel);
    const dst = idByLabel.get(r.dstLabel);
    if (!src || !dst) continue;
    await client.query(
      `INSERT INTO concept_relation (src_id, dst_id, kind, weight)
       VALUES ($1, $2, $3, 1.0)
       ON CONFLICT (src_id, dst_id, kind) DO NOTHING`,
      [src, dst, r.kind],
    );
  }

  if (!opts.skipEmbeddings) {
    const batchSize = config.workers.embeddingBatchSize;
    for (let i = 0; i < subset.concepts.length; i += batchSize) {
      const batch = subset.concepts.slice(i, i + batchSize);
      const vectors = await embed(batch.map((c) => c.definition));
      for (let j = 0; j < batch.length; j++) {
        await client.query(`UPDATE concept SET embedding = $2::vector WHERE id = $1`, [
          idByLabel.get(batch[j].label),
          toVectorLiteral(vectors[j]),
        ]);
      }
    }
  }

  return subset.concepts.map((c) => ({
    id: idByLabel.get(c.label)!,
    label: c.label,
    definition: c.definition,
    depth: c.depth,
    branch: c.branch,
    acronym: c.acronym,
    altLabels: altLabelsByConcept.get(c.label) ?? [],
  }));
}
