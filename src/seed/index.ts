import { pool } from "../db.js";
import { runMigrations } from "../migrate.js";
import { config } from "../config.js";
import { runOnce as drainOnce } from "../workers/resolutionWorker.js";
import { loadCsoSubset } from "./cso.js";
import { buildCohorts, generateContexts, generateOrgs, generatePeople, TRENDING_COUNT } from "./generate.js";
import { assignConceptsAndEdges, assignOrgConcepts } from "./assign.js";
import { applyPlantedCases } from "./planted.js";
import { generateCredentials } from "./credentials.js";
import { runVerification, printReport } from "./verify.js";
import { Rng } from "./rng.js";

interface CliArgs {
  seed: number;
  reset: boolean;
  strict: boolean;
  definitions: "template" | "llm";
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { seed: 42, reset: false, strict: false, definitions: "template" };
  for (const arg of argv) {
    if (arg.startsWith("--seed=")) args.seed = Number(arg.slice("--seed=".length));
    else if (arg === "--seed") continue; // value comes as next arg, handled below
    else if (arg === "--reset") args.reset = true;
    else if (arg === "--strict") args.strict = true;
    else if (arg.startsWith("--definitions=")) {
      const v = arg.slice("--definitions=".length);
      if (v === "llm") args.definitions = "llm";
    }
  }
  // support `--seed 42` (space-separated) as well as `--seed=42`
  const seedFlagIdx = argv.indexOf("--seed");
  if (seedFlagIdx >= 0 && argv[seedFlagIdx + 1]) args.seed = Number(argv[seedFlagIdx + 1]);
  return args;
}

const RESET_TABLES_IN_ORDER = [
  "job",
  "llm_call",
  "ask_concept",
  "ask",
  "intro",
  "session",
  "credential",
  "actor_contact_method",
  "actor_concept",
  "edge",
  "concept_relation",
  "concept_alias",
  "concept",
  "context",
  "actor",
];

async function resetData(): Promise<void> {
  console.log("Resetting seed data...");
  for (const table of RESET_TABLES_IN_ORDER) {
    await pool.query(`TRUNCATE TABLE ${table} CASCADE`);
  }
  await pool.query(`UPDATE graph_version SET version = 1 WHERE id = true`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.strict) process.env.RESOLUTION_STRICT = "true";
  console.log(`Seeding with --seed=${args.seed} reset=${args.reset} strict=${args.strict}`);

  // Stage 1
  const applied = await runMigrations();
  console.log(`Migrations applied: ${applied.length ? applied.join(", ") : "(none — already up to date)"}`);

  if (args.reset) await resetData();

  const rng = new Rng(args.seed);

  // Stages 2-3
  const client = await pool.connect();
  let concepts;
  try {
    await client.query("BEGIN");
    concepts = await loadCsoSubset(client, rng, { skipEmbeddings: !config.llm.baseUrl && args.definitions !== "llm" });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  console.log(`Loaded ${concepts.length} concepts from the CSO subset`);
  if (!config.llm.baseUrl) {
    console.log("LLM_BASE_URL is unset — concept embeddings skipped (vector-band resolution will fall through to needs_review)");
  }

  const conceptById = new Map(concepts.map((c) => [c.id, c]));
  const { cohorts, popularityOrder } = buildCohorts(concepts, rng);
  const trendingConceptIds = rng.sample(popularityOrder, TRENDING_COUNT);

  // Stage 4
  const client2 = await pool.connect();
  let orgs, contexts, people;
  try {
    await client2.query("BEGIN");
    orgs = await generateOrgs(client2, rng, args.seed);
    contexts = await generateContexts(client2, rng, args.seed, orgs.departments, trendingConceptIds.map((id) => conceptById.get(id)!.label));
    people = await generatePeople(client2, rng, args.seed, orgs.departments);
    await client2.query("COMMIT");
  } catch (err) {
    await client2.query("ROLLBACK");
    throw err;
  } finally {
    client2.release();
  }
  console.log(`Generated ${orgs.departments.length + orgs.labs.length + orgs.clubs.length} orgs, ${contexts.length} contexts, ${people.length} people`);

  // Stage 4b: credentials. Pure string manipulation + hashing, no model
  // calls — see auth handoff, "Seeder integration". This is the slowest
  // stage (bcrypt at cost 8 is deliberately expensive), so it only runs
  // when (re)generating people, same guard as stage 5 below.
  const alreadyHasCredentials = await pool.query(`SELECT 1 FROM credential WHERE actor_id = $1`, [people[0].id]);
  let credentials: Awaited<ReturnType<typeof generateCredentials>> = [];
  if (alreadyHasCredentials.rows.length > 0 && !args.reset) {
    console.log("credentials already exist for this seed — skipping (pass --reset to regenerate)");
  } else {
    const credClient = await pool.connect();
    try {
      await credClient.query("BEGIN");
      credentials = await generateCredentials(credClient, rng, people);
      await credClient.query("COMMIT");
    } catch (err) {
      await credClient.query("ROLLBACK");
      throw err;
    } finally {
      credClient.release();
    }
    console.log(`Generated ${credentials.length} credentials`);
  }

  // Stage 5 (skipped if this seed's data already exists and --reset wasn't passed)
  const alreadySeeded = await pool.query(`SELECT 1 FROM actor_concept WHERE actor_id = $1 LIMIT 1`, [people[0].id]);
  let usageCount = new Map<string, number>();
  if (alreadySeeded.rows.length > 0 && !args.reset) {
    console.log("actor_concept rows already exist for this seed — skipping assignment (pass --reset to regenerate)");
  } else {
    const client3 = await pool.connect();
    try {
      await client3.query("BEGIN");
      const result = await assignConceptsAndEdges(
        client3,
        rng,
        people,
        conceptById,
        cohorts,
        popularityOrder,
        trendingConceptIds,
        contexts,
        orgs.labs,
        orgs.clubs,
      );
      usageCount = result.usageCount;
      await assignOrgConcepts(client3, rng, [...orgs.labs, ...orgs.clubs], cohorts, conceptById);
      await client3.query("COMMIT");
    } catch (err) {
      await client3.query("ROLLBACK");
      throw err;
    } finally {
      client3.release();
    }
    console.log("Assigned concepts and edges");

    // Stage 6
    const client4 = await pool.connect();
    let planted;
    try {
      await client4.query("BEGIN");
      planted = await applyPlantedCases(
        client4,
        rng,
        args.seed,
        people,
        concepts,
        conceptById,
        trendingConceptIds,
        usageCount,
      );
      await client4.query("COMMIT");
    } catch (err) {
      await client4.query("ROLLBACK");
      throw err;
    } finally {
      client4.release();
    }
    console.log("Applied planted cases");

    // Stage 7: drain the resolution queue. Must work with the model
    // offline — unresolvable rows land in needs_review (see resolution.ts).
    console.log("Draining resolution queue...");
    let totalDrained = 0;
    for (;;) {
      const claimed = await drainOnce("seed-drain", 50);
      totalDrained += claimed;
      if (claimed === 0) break;
    }
    console.log(`Drained ${totalDrained} jobs`);

    // Stage 8
    await pool.query(`REFRESH MATERIALIZED VIEW concept_idf`);
    await pool.query(`UPDATE graph_version SET version = version + 1 WHERE id = true`);
    console.log("Refreshed concept_idf, bumped graph_version");

    // Stage 9
    const gates = await runVerification(pool, planted);
    printReport(gates, planted);

    if (credentials.length > 0) {
      const byActorId = new Map(credentials.map((c) => [c.actorId, c]));
      const demoCred = byActorId.get(planted.demoUser.id);
      const heroPartnerCred = byActorId.get(planted.heroPair.ids[1]);
      console.log("\n=== Login credentials ===");
      if (demoCred) console.log(`Demo user:  ${demoCred.username} / ${demoCred.password}`);
      if (demoCred && heroPartnerCred) console.log(`Hero pair:  ${demoCred.username}  <->  ${heroPartnerCred.username}`);
      console.log(`Search concept: "${planted.searchTriple.conceptLabel}"`);
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
