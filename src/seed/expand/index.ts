// Additive seed expansion: many more people, interests, clubs and organizations,
// built from open datasets (db/seed-data/open). It never touches existing rows
// (no --reset); every row it creates has a deterministic id, so re-running is a
// no-op for anything already loaded.
//
//   npx tsx src/seed/expand/index.ts [--people=1200] [--seed=42] [--dry-run] [--rebuild] [--orgs-only]
//
// --rebuild first removes the rows a previous run created (recognised by their
// namespaced deterministic ids) and regenerates them with the current recipe.

import { pool } from "../../db.js";
import { config } from "../../config.js";
import { embed } from "../../modelRuntime.js";
import { Rng } from "../rng.js";
import { buildOrgs, saveOrgs } from "./orgs.js";
import { rebuildCleanup } from "./rebuild.js";
import { buildPeople, savePeople } from "./people.js";
import { buildVocab, saveVocab, type ExpConcept } from "./vocab.js";

const args = new Map<string, string | undefined>(process.argv.slice(2).map((a): [string, string | undefined] => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v]; }));
const COUNT = Number(args.get("people") ?? 1200);
const SEED = Number(args.get("seed") ?? 42);
const DRY = args.has("dry-run");
const REBUILD = args.has("rebuild");
const ORGS_ONLY = args.has("orgs-only"); // (re)write departments/labs/clubs and what they are about; no people

// A department with no stated concepts (the original base-seed ones) is described by
// what its NAME means: the concepts nearest to "Physics" or "Design" in embedding
// space. (Its members' interests cannot be used: in the base seed, department and
// interests are unrelated.) Idempotent: only fills departments that have none.
async function deriveDepartmentConcepts(client: import("pg").PoolClient): Promise<number> {
  if (!config.llm.baseUrl) return 0;
  const depts = (await client.query<{ id: string; name: string }>(
    `SELECT d.id, d.display_name AS name FROM actor d WHERE d.kind = 'department' AND NOT EXISTS (SELECT 1 FROM actor_concept x WHERE x.actor_id = d.id)`,
  )).rows;
  let rows = 0;
  for (const d of depts) {
    const [v] = await embed([d.name], "query");
    const near = await client.query<{ id: string; label: string }>(
      `SELECT id, pref_label AS label FROM concept WHERE embedding IS NOT NULL AND (1 - (embedding <=> $1::vector)) >= 0.62 ORDER BY embedding <=> $1::vector LIMIT 6`,
      [toVector(v)],
    );
    for (const c of near.rows) {
      await client.query(
        `INSERT INTO actor_concept (actor_id, concept_id, raw_text, strength, source, stance, resolved_at) VALUES ($1, $2, $3, 1.0, 'seed', 'established', now())`,
        [d.id, c.id, c.label],
      );
      rows++;
    }
  }
  return rows;
}

const toVector = (v: number[]) => `[${v.join(",")}]`;

async function main() {
  const client = await pool.connect();
  try {
    const before = (await client.query(`SELECT (SELECT count(*) FROM actor WHERE kind='person') AS people, (SELECT count(*) FROM concept) AS concepts, (SELECT count(*) FROM actor WHERE kind='club') AS clubs`)).rows[0];
    console.log("before:", before);

    if (REBUILD && !DRY) {
      await client.query("BEGIN");
      console.log("rebuild: removed", await rebuildCleanup(client, SEED));
      await client.query("COMMIT");
    }

    const rng = new Rng(SEED);
    const vocab = await buildVocab(client, rng);
    const fresh = vocab.concepts.filter((c) => !c.existing);
    console.log(`vocabulary: ${vocab.concepts.length} concepts (${fresh.length} new, ${vocab.concepts.length - fresh.length} reused from the database)`);

    const orgs = await buildOrgs(client, rng, SEED, vocab);
    console.log(`orgs: ${orgs.depts.length} departments, ${orgs.labs.length} labs, ${orgs.clubs.length} clubs, ${orgs.contexts.length} contexts`);
    console.log("department pools:", orgs.depts.map((d) => `${d.name} ${d.pool.length}`).join("; "));

    // Broad CS concepts, so the new populations connect to the existing one.
    const cso = await client.query<{ id: string; label: string; definition: string }>(
      `SELECT id, pref_label AS label, definition FROM concept WHERE depth <= 2 AND embedding IS NOT NULL ORDER BY depth, pref_label LIMIT 80`,
    );
    const csoBroad: ExpConcept[] = cso.rows.map((r) => ({ id: r.id, label: r.label, definition: r.definition, depth: 2, kind: "program", altLabels: [], existing: true }));

    const ctxById = new Map(orgs.contexts.map((c) => [c.id, c]));
    const people = await buildPeople(client, rng, vocab, orgs.depts, orgs.labs, orgs.clubs, ctxById, orgs.contexts.filter((c) => c.kind === "event" && !orgs.depts.some((d) => d.eventIds.includes(c.id))), { count: COUNT, seed: SEED, csoBroad });
    console.log(`people planned: ${people.length}; interests ${people.reduce((n, p) => n + p.interests.length, 0)}; edges ${people.reduce((n, p) => n + p.edges.length, 0)}`);
    if (DRY) {
      console.log("dry run: nothing written. sample:", people.slice(0, 3).map((p) => `${p.name} (${p.kind}, ${orgs.depts[p.deptIndex].name}): ${p.interests.map((i) => i.concept.label).join(", ")}`));
      return;
    }

    await client.query("BEGIN");
    const v = await saveVocab(client, vocab);
    await saveOrgs(client, orgs);
    await client.query("COMMIT");
    console.log(`saved vocabulary: ${v.created} concepts, ${v.aliases} aliases`);

    // Embeddings for the new concepts (small, fast model). Skipped without a model.
    if (config.llm.baseUrl) {
      const need = (await client.query<{ id: string; definition: string }>(`SELECT id, definition FROM concept WHERE embedding IS NULL`)).rows;
      for (let i = 0; i < need.length; i += 128) {
        const batch = need.slice(i, i + 128);
        const vectors = await embed(batch.map((c) => c.definition), "document");
        for (let j = 0; j < batch.length; j++) await client.query(`UPDATE concept SET embedding = $2::vector WHERE id = $1`, [batch[j].id, toVector(vectors[j])]);
      }
      console.log(`embedded ${need.length} concepts`);
    } else console.log("LLM_BASE_URL unset: concepts left without embeddings");

    console.log(`derived concepts for ${await deriveDepartmentConcepts(client)} department rows`);
    if (ORGS_ONLY) {
      await client.query(`REFRESH MATERIALIZED VIEW concept_idf`);
      await client.query(`UPDATE graph_version SET version = version + 1 WHERE id = true`);
      console.log("orgs-only: groups saved with their concepts; people untouched");
      return;
    }

    let inserted = 0, interests = 0, queued = 0;
    const logins: { username: string; password: string }[] = [];
    for (let i = 0; i < people.length; i += 100) {
      await client.query("BEGIN");
      const r = await savePeople(client, SEED, people.slice(i, i + 100), orgs.depts);
      await client.query("COMMIT");
      inserted += r.inserted; interests += r.interests; queued += r.queued; logins.push(...r.logins);
      process.stdout.write(`\r  people ${Math.min(i + 100, people.length)}/${people.length}`);
    }
    console.log(`\nsaved ${inserted} new people, ${interests} interests (${queued} queued for the resolution worker)`);

    await client.query(`REFRESH MATERIALIZED VIEW concept_idf`);
    await client.query(`UPDATE graph_version SET version = version + 1 WHERE id = true`);
    const after = (await client.query(`SELECT (SELECT count(*) FROM actor WHERE kind='person') AS people, (SELECT count(*) FROM concept) AS concepts, (SELECT count(*) FROM actor WHERE kind='club') AS clubs, (SELECT count(*) FROM actor WHERE kind='lab') AS labs, (SELECT count(*) FROM actor WHERE kind='department') AS departments, (SELECT count(*) FROM actor_concept) AS actor_concepts`)).rows[0];
    console.log("after:", after);
    if (logins.length) console.log("sample logins:", logins.slice(0, 3).map((l) => `${l.username} / ${l.password}`).join("  |  "));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
