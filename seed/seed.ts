/**
 * Wipes and reloads the synthetic university. Deterministic: same graph every run.
 *   npm run db:up && npm run seed
 */
import "dotenv/config";
import neo4j from "neo4j-driver";
import { GRAPH, HERO, DEMO_LOGINS } from "./data";

const uri = process.env.NEO4J_URI || "bolt://localhost:7687";
const user = process.env.NEO4J_USER || "neo4j";
const password = process.env.NEO4J_PASSWORD || "studentos";

async function main() {
  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
    disableLosslessIntegers: true,
  });
  const session = driver.session({ database: process.env.NEO4J_DATABASE || "neo4j" });

  try {
    console.log(`connecting to ${uri} ...`);
    await session.run("MATCH (n) DETACH DELETE n");
    console.log("wiped existing graph");

    for (const label of [
      "Person","Department","Course","Offering","Term","Lab","Club","Event",
      "Interest","Goal","Paper","Position","Assignment","Application",
      "FinanceRecord","HRRecord",
    ]) {
      await session.run(
        `CREATE CONSTRAINT ${label.toLowerCase()}_id IF NOT EXISTS FOR (n:${label}) REQUIRE n.id IS UNIQUE`,
      );
    }

    /* nodes, batched by label set */
    const byLabels = new Map<string, Record<string, unknown>[]>();
    for (const n of GRAPH.nodes) {
      const key = n.labels.join(":");
      if (!byLabels.has(key)) byLabels.set(key, []);
      byLabels.get(key)!.push(n.props);
    }
    for (const [labels, props] of byLabels) {
      await session.run(
        `UNWIND $props AS p CREATE (n:${labels}) SET n = p`,
        { props },
      );
      console.log(`  + ${String(props.length).padStart(4)} :${labels}`);
    }

    /* edges, batched by type */
    const byType = new Map<string, { from: string; to: string; props: Record<string, unknown> }[]>();
    for (const e of GRAPH.edges) {
      if (!byType.has(e.type)) byType.set(e.type, []);
      byType.get(e.type)!.push({ from: e.from, to: e.to, props: e.props ?? {} });
    }
    for (const [type, rows] of byType) {
      await session.run(
        `
        UNWIND $rows AS row
        MATCH (a {id: row.from}), (b {id: row.to})
        CREATE (a)-[r:${type}]->(b)
        SET r = row.props
        `,
        { rows },
      );
      console.log(`  → ${String(rows.length).padStart(4)} [:${type}]`);
    }

    /* acceptance check from the spec: counts + a hero traversal */
    const counts = await session.run(
      `MATCH (n) RETURN labels(n)[0] AS label, count(*) AS c ORDER BY c DESC`,
    );
    const total = await session.run(`MATCH (n) RETURN count(n) AS n`);
    const rels = await session.run(`MATCH ()-[r]->() RETURN count(r) AS n`);

    console.log("\nnode counts:");
    for (const r of counts.records) {
      console.log(`  ${String(r.get("label")).padEnd(14)} ${r.get("c")}`);
    }
    console.log(`\ntotal nodes: ${total.records[0].get("n")}  relationships: ${rels.records[0].get("n")}`);

    const hero = await session.run(
      `
      MATCH (me:Person {id: $hero})-[:INTERESTED_IN|OWNS]->(x)
      OPTIONAL MATCH (x)-[:ABOUT]->(gi:Interest)
      WITH me, collect(DISTINCT coalesce(gi, x)) AS interests
      UNWIND interests AS i
      MATCH (n)-[:FOCUSES_ON|COVERS|CENTERED_ON]->(i)
      RETURN labels(n)[0] AS label, count(DISTINCT n) AS c ORDER BY c DESC
      `,
      { hero: HERO },
    );
    console.log(`\nhero (${HERO}) reaches via shared interest:`);
    for (const r of hero.records) console.log(`  ${String(r.get("label")).padEnd(10)} ${r.get("c")}`);
    if (hero.records.length === 0) {
      throw new Error("hero traversal returned nothing — the interest edges are wrong");
    }

    console.log("\ndemo logins:");
    for (const l of DEMO_LOGINS) console.log(`  ${l.id.padEnd(10)} ${l.label}`);
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
