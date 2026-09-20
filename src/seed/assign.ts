import type pg from "pg";
import { enqueue } from "../queue.js";
import type { LoadedConcept } from "./cso.js";
import { mangleSurface } from "./variants.js";
import type { Rng } from "./rng.js";
import type { Cohort, Context, Org, Person } from "./generate.js";
import { ZIPF_S } from "./generate.js";

const MS_PER_DAY = 24 * 3600 * 1000;

function pickFromPool(rng: Rng, pool: string[], exclude: Set<string>): string | null {
  for (let attempt = 0; attempt < pool.length; attempt++) {
    const idx = rng.zipfIndex(pool.length, ZIPF_S);
    if (!exclude.has(pool[idx])) return pool[idx];
  }
  return null;
}

function stanceSince(rng: Rng): string {
  const days = rng.bool(0.15)
    ? rng.intRange(370, 540) // deliberately stale, for decay to act on
    : rng.intRange(0, 365 * 1.5);
  return new Date(Date.now() - days * MS_PER_DAY).toISOString().slice(0, 10);
}

// Section "Actors, contexts and edges": Zipfian, cohort-biased concept
// assignment. This is the distribution that gives idf and scoring a real
// spread — uniform sampling here would make every suggestion score near
// identical. Aspiring/exploring stances are concentrated on the trending
// pool rather than sampled independently, so a search on any of those 15
// concepts is guaranteed to find people at every stance.
export async function assignConceptsAndEdges(
  client: pg.PoolClient,
  rng: Rng,
  people: Person[],
  conceptById: Map<string, LoadedConcept>,
  cohorts: Cohort[],
  popularityOrder: string[],
  trendingConceptIds: string[],
  contexts: Context[],
  labs: Org[],
  clubs: Org[],
): Promise<{ usageCount: Map<string, number> }> {
  const courses = contexts.filter((c) => c.kind === "course");
  const events = contexts.filter((c) => c.kind === "event");
  const papers = contexts.filter((c) => c.kind === "paper");
  const usageCount = new Map<string, number>();

  for (const person of people) {
    const cohort = cohorts[person.cohort];
    const assigned = new Set<string>();
    const numConcepts = rng.intRange(6, 10);

    for (let slot = 0; slot < numConcepts; slot++) {
      const stanceRoll = rng.float();
      const stance = stanceRoll < 0.7 ? "established" : stanceRoll < 0.9 ? "exploring" : "aspiring";

      let conceptId: string | null;
      if (stance === "established") {
        const useCohortPool = rng.bool(0.8);
        conceptId = pickFromPool(rng, useCohortPool ? cohort.poolIds : popularityOrder, assigned);
      } else {
        conceptId = pickFromPool(rng, trendingConceptIds, assigned);
      }
      if (!conceptId) continue;
      assigned.add(conceptId);
      usageCount.set(conceptId, (usageCount.get(conceptId) ?? 0) + 1);

      const concept = conceptById.get(conceptId)!;
      const { text: rawText } = mangleSurface(rng, concept, concept.altLabels);
      const strength =
        stance === "established"
          ? 0.7 + rng.float() * 0.3
          : stance === "exploring"
            ? 0.4 + rng.float() * 0.3
            : 0.1 + rng.float() * 0.3;
      const since = stance === "established" ? null : stanceSince(rng);

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO actor_concept (actor_id, raw_text, strength, source, stance, stance_since)
         VALUES ($1, $2, $3, 'user', $4, $5)
         RETURNING id`,
        [person.id, rawText, strength, stance, since],
      );
      await enqueue(client, "resolve_concept", {
        target: "actor_concept",
        targetId: rows[0].id,
        rawText,
      });
    }

    // Edges: member_of an org, enrolled_in cohort-clustered courses, plus
    // attended/authored, averaging roughly the handoff's ~6-per-person.
    const org = rng.bool(0.5) ? labs[person.cohort % labs.length] : clubs[person.cohort % clubs.length];
    await insertEdge(client, person.id, "actor", org.id, "actor", "member_of", null, null);

    // Cohort members cluster into a few shared courses — this is what
    // creates the two-hop paths candidate generation walks.
    const cohortCourseBase = (person.cohort * 3) % courses.length;
    const courseCount = rng.intRange(2, 3);
    for (let i = 0; i < courseCount; i++) {
      const course = courses[(cohortCourseBase + i) % courses.length];
      await insertEdge(client, person.id, "actor", course.id, "context", "enrolled_in", course.startsOn, course.endsOn);
    }

    if (rng.bool(0.5)) {
      const event = rng.pick(events);
      await insertEdge(client, person.id, "actor", event.id, "context", "attended", event.startsOn, event.endsOn);
    }

    const authorProb = person.personKind === "faculty" ? 0.9 : 0.15;
    if (rng.bool(authorProb)) {
      const paper = rng.pick(papers);
      await insertEdge(client, person.id, "actor", paper.id, "context", "authored", paper.startsOn, paper.endsOn);
    }
  }

  return { usageCount };
}

export async function insertEdge(
  client: pg.PoolClient,
  srcId: string,
  srcType: string,
  dstId: string,
  dstType: string,
  relation: string,
  validFrom: string | null,
  validTo: string | null,
  weight = 1.0,
): Promise<void> {
  await client.query(
    `INSERT INTO edge (src_id, src_type, dst_id, dst_type, relation, weight, valid_from, valid_to)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [srcId, srcType, dstId, dstType, relation, weight, validFrom, validTo],
  );
}

export async function assignOrgConcepts(
  client: pg.PoolClient,
  rng: Rng,
  orgs: Org[],
  cohorts: Cohort[],
  conceptById: Map<string, LoadedConcept>,
): Promise<void> {
  for (let i = 0; i < orgs.length; i++) {
    const org = orgs[i];
    const cohort = cohorts[i % cohorts.length];
    const count = rng.intRange(3, 6);
    const chosen = rng.sample(cohort.poolIds, Math.min(count, cohort.poolIds.length));
    for (const conceptId of chosen) {
      const concept = conceptById.get(conceptId)!;
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO actor_concept (actor_id, raw_text, strength, source, stance)
         VALUES ($1, $2, 1.0, 'seed', 'established')
         RETURNING id`,
        [org.id, concept.label],
      );
      await enqueue(client, "resolve_concept", { target: "actor_concept", targetId: rows[0].id, rawText: concept.label });
    }
  }
}
