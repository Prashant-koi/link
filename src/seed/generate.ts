import type pg from "pg";
import { enqueue } from "../queue.js";
import type { LoadedConcept } from "./cso.js";
import { mangleSurface } from "./variants.js";
import { deterministicUuid, Rng } from "./rng.js";
import {
  CLUB_NAMES,
  DEPARTMENTS,
  FIRST_NAMES,
  LAB_NAMES,
  LAST_NAMES,
  courseTitle,
  eventTitle,
  paperTitle,
} from "./names.js";

// Starting value was 1.0 per the handoff's own open question ("if the idf
// spread gate fails, this is the first knob"). idf spread passes with huge
// margin (7.6x vs the 2.5x gate), so it's lowered here instead: at s=1.0,
// cohort-mates concentrated so hard on the same top few concepts that 2-3
// ordinary overlaps could rival one deliberately rare hero-pair match.
const ZIPF_S = 0.7;
const COHORT_COUNT = 12;
const PEOPLE_COUNT = 300;
const ORG_COUNT = { departments: DEPARTMENTS.length, labs: LAB_NAMES.length, clubs: CLUB_NAMES.length };
const CONTEXT_COUNT = { courses: 30, events: 15, papers: 15 };
const TRENDING_COUNT = 15;

export interface Cohort {
  index: number;
  name: string;
  branches: string[];
  poolIds: string[]; // this cohort's concepts, ordered by global popularity (rank 0 first)
}

export interface Org {
  id: string;
  kind: "department" | "lab" | "club";
  displayName: string;
}

export interface Context {
  id: string;
  kind: "course" | "event" | "paper";
  title: string;
  startsOn: string;
  endsOn: string | null;
}

export interface Person {
  id: string;
  displayName: string;
  cohort: number;
  homeUnitId: string;
  personKind: "student" | "faculty" | "staff";
}

export interface GenerationResult {
  cohorts: Cohort[];
  trendingConceptIds: string[];
  commonConceptId: string;
  orgs: { departments: Org[]; labs: Org[]; clubs: Org[] };
  contexts: Context[];
  people: Person[];
}

const BRANCH_COHORTS: { name: string; branches: string[] }[] = [
  { name: "Machine Learning", branches: ["machine learning"] },
  { name: "Computer Networks", branches: ["computer networks"] },
  { name: "Software Engineering", branches: ["software engineering"] },
  { name: "Computer Vision", branches: ["computer vision"] },
  { name: "Cryptography", branches: ["cryptography"] },
  { name: "Database Systems", branches: ["database systems"] },
  { name: "Human-Computer Interaction", branches: ["human computer interaction"] },
  { name: "Robotics", branches: ["robotics"] },
  { name: "AI & Vision", branches: ["machine learning", "computer vision"] },
  { name: "Security & Networks", branches: ["cryptography", "computer networks"] },
  { name: "Backend & Data", branches: ["software engineering", "database systems"] },
  { name: "Interactive Robotics", branches: ["human computer interaction", "robotics"] },
];

// The single most important distribution in the seed (handoff's own words):
// concepts get a popularity rank, then each cohort's pool is that cohort's
// concepts sorted by that same rank — so sampling Zipfianly within a cohort
// still respects overall rarity, and idf ends up with a real spread instead
// of every concept being equally likely.
//
// Popularity is ranked shallow-first (shuffled only within each depth tier),
// not by a pure random shuffle: depth in the CSO hierarchy also determines
// how many concept_relation edges a concept fans out through. A random rank
// can hand a highly-connected hub concept a rare-looking (high-idf) rank,
// which then inflates the hop-1 hierarchy scoring term far past what a
// single genuine rare-concept match should score. Correlating popularity
// with breadth avoids that and is also just more realistic — "machine
// learning" really is held by more people than a depth-3 leaf topic.
export function buildCohorts(
  concepts: LoadedConcept[],
  rng: Rng,
): { cohorts: Cohort[]; popularityOrder: string[]; rankOf: Map<string, number> } {
  const byDepth = new Map<number, string[]>();
  for (const c of concepts) {
    if (!byDepth.has(c.depth)) byDepth.set(c.depth, []);
    byDepth.get(c.depth)!.push(c.id);
  }
  const popularityOrder = [...byDepth.keys()]
    .sort((a, b) => a - b)
    .flatMap((depth) => rng.shuffle(byDepth.get(depth)!));
  const rankOf = new Map(popularityOrder.map((id, rank) => [id, rank]));

  const cohorts: Cohort[] = BRANCH_COHORTS.map((def, index) => {
    const poolIds = concepts
      .filter((c) => def.branches.includes(c.branch))
      .map((c) => c.id)
      .sort((a, b) => rankOf.get(a)! - rankOf.get(b)!);
    return { index, name: def.name, branches: def.branches, poolIds };
  });

  return { cohorts, popularityOrder, rankOf };
}

export async function generateOrgs(client: pg.PoolClient, rng: Rng, seed: number): Promise<GenerationResult["orgs"]> {
  const departments: Org[] = DEPARTMENTS.map((name, i) => ({
    id: deterministicUuid(seed, "org:department", i),
    kind: "department" as const,
    displayName: name,
  }));
  const labs: Org[] = LAB_NAMES.map((name, i) => ({
    id: deterministicUuid(seed, "org:lab", i),
    kind: "lab" as const,
    displayName: name,
  }));
  const clubs: Org[] = CLUB_NAMES.map((name, i) => ({
    id: deterministicUuid(seed, "org:club", i),
    kind: "club" as const,
    displayName: name,
  }));

  for (const org of [...departments, ...labs, ...clubs]) {
    await client.query(
      `INSERT INTO actor (id, kind, display_name, discoverable, has_account)
       VALUES ($1, $2, $3, true, false)
       ON CONFLICT (id) DO UPDATE SET display_name = $3`,
      [org.id, org.kind, org.displayName],
    );
  }

  return { departments, labs, clubs };
}

export async function generateContexts(
  client: pg.PoolClient,
  rng: Rng,
  seed: number,
  departments: Org[],
  trendingConceptLabels: string[],
): Promise<Context[]> {
  const contexts: Context[] = [];
  const now = Date.now();
  const threeYearsMs = 3 * 365 * 24 * 3600 * 1000;

  function randomDateWithinLast3Years(): Date {
    return new Date(now - rng.int(threeYearsMs));
  }

  let idx = 0;
  for (let i = 0; i < CONTEXT_COUNT.courses; i++, idx++) {
    const dept = departments[i % departments.length];
    const starts = randomDateWithinLast3Years();
    const ends = new Date(starts.getTime() + 90 * 24 * 3600 * 1000);
    const current = rng.bool(0.2); // ~20% null ends_on, exercises current-vs-past weighting
    contexts.push({
      id: deterministicUuid(seed, "context:course", idx),
      kind: "course",
      title: courseTitle(dept.displayName, i),
      startsOn: starts.toISOString().slice(0, 10),
      endsOn: current ? null : ends.toISOString().slice(0, 10),
    });
  }
  for (let i = 0; i < CONTEXT_COUNT.events; i++, idx++) {
    const starts = randomDateWithinLast3Years();
    contexts.push({
      id: deterministicUuid(seed, "context:event", idx),
      kind: "event",
      title: eventTitle(i),
      startsOn: starts.toISOString().slice(0, 10),
      endsOn: starts.toISOString().slice(0, 10),
    });
  }
  for (let i = 0; i < CONTEXT_COUNT.papers; i++, idx++) {
    const starts = randomDateWithinLast3Years();
    const concept = rng.pick(trendingConceptLabels);
    contexts.push({
      id: deterministicUuid(seed, "context:paper", idx),
      kind: "paper",
      title: paperTitle(concept, i),
      startsOn: starts.toISOString().slice(0, 10),
      endsOn: null,
    });
  }

  for (const ctx of contexts) {
    await client.query(
      `INSERT INTO context (id, kind, title, starts_on, ends_on)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET title = $3, starts_on = $4, ends_on = $5`,
      [ctx.id, ctx.kind, ctx.title, ctx.startsOn, ctx.endsOn],
    );
  }

  return contexts;
}

export async function generatePeople(
  client: pg.PoolClient,
  rng: Rng,
  seed: number,
  departments: Org[],
): Promise<Person[]> {
  const people: Person[] = [];
  const usedNames = new Set<string>();

  for (let i = 0; i < PEOPLE_COUNT; i++) {
    let displayName = "";
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
      if (!usedNames.has(candidate)) {
        displayName = candidate;
        break;
      }
    }
    if (!displayName) displayName = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)} ${i}`;
    usedNames.add(displayName);

    const roll = rng.float();
    const personKind: Person["personKind"] = roll < 0.75 ? "student" : roll < 0.9 ? "faculty" : "staff";
    const cohort = i % COHORT_COUNT; // even spread across cohorts, deterministic
    const homeUnit = departments[i % departments.length];
    const discoverable = !rng.bool(0.05); // ~5% false, so the visibility filter has something to filter
    const hasAccount = rng.bool(0.55);

    const person: Person = {
      id: deterministicUuid(seed, "actor:person", i),
      displayName,
      cohort,
      homeUnitId: homeUnit.id,
      personKind,
    };
    people.push(person);

    await client.query(
      `INSERT INTO actor (id, kind, person_kind, display_name, home_unit, discoverable, has_account)
       VALUES ($1, 'person', $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET person_kind = $2, display_name = $3, home_unit = $4, discoverable = $5, has_account = $6`,
      [person.id, personKind, displayName, homeUnit.id, discoverable, hasAccount],
    );

    // Contact states (§ "Stance and contact states"): hasAccount:true needs
    // no methods row. hasAccount:false gets 0-2 methods, ~35% of the total
    // vs ~10% with none — handled by sometimes emitting zero rows below.
    if (!hasAccount) {
      const hasMethods = rng.bool(35 / 45); // 35% of all people vs the 10% no-methods slice
      if (hasMethods) {
        const skewOffice = personKind === "faculty"; // frontend handoff's own reasoning: faculty skew website/office
        const kinds = skewOffice ? (["website", "office"] as const) : (["email", "website"] as const);
        const methodCount = rng.intRange(1, 2);
        const chosenKinds = rng.sample(kinds, Math.min(methodCount, kinds.length));
        for (let m = 0; m < chosenKinds.length; m++) {
          const kind = chosenKinds[m];
          const value =
            kind === "email"
              ? `${displayName.toLowerCase().replace(/\s+/g, ".")}@example.edu`
              : kind === "website"
                ? `https://${displayName.toLowerCase().replace(/\s+/g, "")}.example.edu`
                : `Building ${rng.intRange(1, 9)}, Room ${rng.intRange(100, 399)}`;
          await client.query(
            `INSERT INTO actor_contact_method (actor_id, kind, value, sort_order)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT DO NOTHING`,
            [person.id, kind, value, m],
          );
        }
      }
    }
  }

  return people;
}

export { COHORT_COUNT, PEOPLE_COUNT, TRENDING_COUNT, ZIPF_S, BRANCH_COHORTS };
