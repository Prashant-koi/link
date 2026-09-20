import type pg from "pg";
import { enqueue } from "../queue.js";
import type { LoadedConcept } from "./cso.js";
import type { Person } from "./generate.js";
import { insertEdge } from "./assign.js";
import { deterministicUuid, Rng } from "./rng.js";

export interface PlantedReport {
  demoUser: { id: string; name: string };
  heroPair: { ids: [string, string]; names: [string, string]; conceptLabel: string };
  synonymPair: { names: [string, string]; conceptLabel: string; variants: [string, string] };
  searchTriple: { conceptLabel: string };
  commonConceptDecoy: { conceptLabel: string };
}

async function addActorConcept(
  client: pg.PoolClient,
  actorId: string,
  conceptLabel: string,
  rawText: string,
  strength: number,
  stance: "established" | "exploring" | "aspiring",
  stanceSince: string | null,
): Promise<void> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO actor_concept (actor_id, raw_text, strength, source, stance, stance_since)
     VALUES ($1, $2, $3, 'planted', $4, $5)
     RETURNING id`,
    [actorId, rawText, strength, stance, stanceSince],
  );
  await enqueue(client, "resolve_concept", { target: "actor_concept", targetId: rows[0].id, rawText });
  void conceptLabel; // kept for call-site readability only
}

// Random generation gives *a* result, not a *good* one. These five cases
// are overwritten in on top of it, after the fact, so the demo has
// guaranteed, known-good talking points instead of hoping the dice landed
// right — seed data handoff, "Planted cases".
export async function applyPlantedCases(
  client: pg.PoolClient,
  rng: Rng,
  seed: number,
  people: Person[],
  concepts: LoadedConcept[],
  conceptById: Map<string, LoadedConcept>,
  trendingConceptIds: string[],
  usageCount: Map<string, number>,
): Promise<PlantedReport> {
  const demoUser = people[0];
  const heroPartner = people[1];
  const synonymA = people[2];
  const synonymB = people[3];
  const triplePeople = people.slice(4, 13); // 9 people, 3 per stance
  const decoyPeople = people.slice(13, 18); // 5 people

  // --- Hero pair: one rare concept (0 other holders) + one fresh current
  // shared course, nothing else engineered. This is the pair to click
  // during the demo, and it's also what makes the demo user's own score
  // spread gate pass (a clear #1 with real distance to #2).
  const rareConcept = concepts.find((c) => c.depth === 3 && (usageCount.get(c.id) ?? 0) === 0) ?? concepts[concepts.length - 1];
  await addActorConcept(client, demoUser.id, rareConcept.label, rareConcept.label, 1.0, "established", null);
  await addActorConcept(
    client,
    heroPartner.id,
    rareConcept.label,
    rareConcept.altLabels[0] ?? rareConcept.label,
    1.0,
    "established",
    null,
  );
  const heroCourseId = deterministicUuid(seed, "context:hero-course", 0);
  await client.query(
    `INSERT INTO context (id, kind, title, starts_on, ends_on)
     VALUES ($1, 'course', $2, current_date - interval '30 days', NULL)
     ON CONFLICT (id) DO NOTHING`,
    [heroCourseId, `Seminar: ${rareConcept.label}`],
  );
  for (const p of [demoUser, heroPartner]) {
    // A dedicated 2-person seminar is a materially more significant tie
    // than a 25-person cohort lecture course — weight says so explicitly,
    // rather than pretending every enrolled_in edge carries equal signal.
    await insertEdge(client, p.id, "actor", heroCourseId, "context", "enrolled_in", null, null, 4.0);
  }

  // --- Synonym pair: same concept, deliberately different raw_text. The
  // canonical form always resolves exact (cso.ts seeds a self-alias); the
  // other form uses a real CSO alt-label when one exists, so both resolve
  // without needing the model.
  const synonymConcept = conceptById.get(trendingConceptIds[1])!;
  const variantB = synonymConcept.altLabels[0] ?? synonymConcept.label.replace(/\s+/g, "-");
  await addActorConcept(client, synonymA.id, synonymConcept.label, synonymConcept.label, 1.0, "established", null);
  await addActorConcept(client, synonymB.id, synonymConcept.label, variantB, 1.0, "established", null);

  // --- Search triple: guarantee >=3 people at each stance on one concept,
  // regardless of what randomly landed there, so searching it always
  // returns all three sections.
  const tripleConcept = conceptById.get(trendingConceptIds[0])!;
  const stances: Array<"established" | "exploring" | "aspiring"> = ["established", "exploring", "aspiring"];
  for (let i = 0; i < triplePeople.length; i++) {
    const stance = stances[Math.floor(i / 3)];
    const since = stance === "established" ? null : new Date().toISOString().slice(0, 10);
    await addActorConcept(client, triplePeople[i].id, tripleConcept.label, tripleConcept.label, 1.0, stance, since);
  }

  // --- Common-concept decoy: the concept the random phase used most,
  // planted onto a handful more people plus the demo user, so it visibly
  // ranks low against the hero pair — proof idf is doing real work.
  let commonConceptId = trendingConceptIds[0];
  let bestCount = -1;
  for (const [id, count] of usageCount) {
    if (count > bestCount) {
      bestCount = count;
      commonConceptId = id;
    }
  }
  const commonConcept = conceptById.get(commonConceptId)!;
  await addActorConcept(client, demoUser.id, commonConcept.label, commonConcept.label, 0.5, "established", null);
  for (const p of decoyPeople) {
    await addActorConcept(client, p.id, commonConcept.label, commonConcept.label, 0.5, "established", null);
  }

  return {
    demoUser: { id: demoUser.id, name: demoUser.displayName },
    heroPair: {
      ids: [demoUser.id, heroPartner.id],
      names: [demoUser.displayName, heroPartner.displayName],
      conceptLabel: rareConcept.label,
    },
    synonymPair: {
      names: [synonymA.displayName, synonymB.displayName],
      conceptLabel: synonymConcept.label,
      variants: [synonymConcept.label, variantB],
    },
    searchTriple: { conceptLabel: tripleConcept.label },
    commonConceptDecoy: { conceptLabel: commonConcept.label },
  };
}
