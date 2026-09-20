import type { Queryable } from "../db.js";
import { getCandidateActorIds } from "../services/candidates.js";
import { scoreCandidates } from "../services/scoring.js";
import type { PlantedReport } from "./planted.js";

export interface GateResult {
  name: string;
  passed: boolean;
  detail: string;
}

// Every gate here is checked against the doc's own pass condition, verbatim
// where a number is given. A failure here is a seed bug, not something to
// paper over in the UI — see "Verification" in the seed data handoff.
export async function runVerification(client: Queryable, planted: PlantedReport): Promise<GateResult[]> {
  const gates: GateResult[] = [];

  const coverage = await client.query<{ actor_id: string; n: string }>(
    `SELECT a.id AS actor_id, count(ac.id) AS n
     FROM actor a
     LEFT JOIN actor_concept ac ON ac.actor_id = a.id AND ac.concept_id IS NOT NULL
     WHERE a.discoverable = true AND a.kind = 'person'
     GROUP BY a.id`,
  );
  const belowCoverage = coverage.rows.filter((r) => Number(r.n) < 3).length;
  gates.push({
    name: "Coverage",
    passed: belowCoverage === 0,
    detail: `${coverage.rows.length - belowCoverage}/${coverage.rows.length} discoverable actors have >=3 resolved concepts`,
  });

  const idfSpread = await client.query<{ max: number; min: number }>(
    `SELECT max(idf) AS max, min(idf) AS min FROM concept_idf WHERE idf > 0`,
  );
  const spread = idfSpread.rows[0].max / Math.max(idfSpread.rows[0].min, 1e-9);
  gates.push({
    name: "idf spread",
    passed: spread >= 2.5,
    detail: `max/min idf = ${spread.toFixed(2)} (need >= 2.5)`,
  });

  const resolutionMix = await client.query<{ status: string; n: string }>(
    `SELECT
       CASE
         WHEN concept_id IS NOT NULL THEN 'resolved'
         ELSE 'needs_review'
       END AS status,
       count(*) AS n
     FROM actor_concept
     GROUP BY 1`,
  );
  const total = resolutionMix.rows.reduce((sum, r) => sum + Number(r.n), 0);
  const needsReview = Number(resolutionMix.rows.find((r) => r.status === "needs_review")?.n ?? 0);
  const needsReviewJobs = await client.query<{ n: string }>(`SELECT count(*) AS n FROM job WHERE state = 'needs_review'`);
  // A failed job is not a parked one: it means the pipeline broke (an
  // unregistered prompt, an unreachable model), and its row stays unresolved
  // looking exactly like a needs_review row. Counting rows alone hid 112 of them.
  const failedJobs = await client.query<{ n: string }>(`SELECT count(*) AS n FROM job WHERE state = 'failed'`);
  const needsReviewShare = total > 0 ? needsReview / total : 0;
  const exactShare = total > 0 ? (total - needsReview) / total : 0;
  gates.push({
    name: "Resolution mix",
    passed: exactShare >= 0.75 && needsReviewShare <= 0.2 && Number(failedJobs.rows[0].n) === 0,
    detail: `resolved ${(exactShare * 100).toFixed(1)}%, needs_review ${(needsReviewShare * 100).toFixed(1)}% (${needsReviewJobs.rows[0].n} parked jobs, ${failedJobs.rows[0].n} FAILED jobs)`,
  });

  const collapse = await client.query<{ concept_id: string; n: string }>(
    `SELECT concept_id, count(DISTINCT raw_text) AS n
     FROM actor_concept
     WHERE concept_id IS NOT NULL
     GROUP BY concept_id
     HAVING count(DISTINCT raw_text) >= 3`,
  );
  gates.push({
    name: "Collapse",
    passed: collapse.rows.length >= 20,
    detail: `${collapse.rows.length} concepts have >=3 distinct raw_text variants (need >= 20)`,
  });

  const actorsWithFive = await client.query<{ n: string; total: string }>(
    `WITH suggestable AS (
       SELECT id FROM actor WHERE discoverable = true AND kind = 'person'
     )
     SELECT
       (SELECT count(*) FROM suggestable) AS total,
       count(*) AS n
     FROM suggestable s
     WHERE (
       SELECT count(*) FROM actor_concept ac
       WHERE ac.actor_id = s.id AND ac.concept_id IS NOT NULL
     ) >= 3`,
  );
  const suggestableShare = Number(actorsWithFive.rows[0].n) / Math.max(Number(actorsWithFive.rows[0].total), 1);
  gates.push({
    name: "Suggestions",
    passed: suggestableShare >= 0.8,
    detail: `${(suggestableShare * 100).toFixed(1)}% of people have >=3 resolved concepts to seed suggestions from (need >= 80%)`,
  });

  // Score spread and hero-pair ranking both need the real scoring pipeline,
  // not just an assumption that construction alone guarantees them — other
  // organic overlaps (shared cohort courses, etc.) could in principle
  // produce a competing candidate.
  const demoCandidates = await getCandidateActorIds(planted.demoUser.id);
  const demoScored = await scoreCandidates(planted.demoUser.id, demoCandidates);
  const top5 = demoScored.slice(0, 5);
  const scoreSpreadOk = top5.length >= 5 && top5[0].score >= 2 * top5[4].score;
  gates.push({
    name: "Score spread",
    passed: scoreSpreadOk,
    detail:
      top5.length >= 5
        ? `demo user top score ${top5[0].score.toFixed(3)} vs 5th ${top5[4].score.toFixed(3)} (need >= 2x)`
        : `demo user only has ${top5.length} suggestions with score > 0 (need >= 5)`,
  });

  const heroRanksFirst = demoScored[0]?.actorId === planted.heroPair.ids[1]; // demoScored already sorted desc by score
  gates.push({
    name: "Hero pair",
    passed: heroRanksFirst,
    detail: `${planted.heroPair.names[0]}'s #1 suggestion via "${planted.heroPair.conceptLabel}"`,
  });

  const tripleCounts = await client.query<{ stance: string; n: string }>(
    `SELECT ac.stance, count(DISTINCT ac.actor_id) AS n
     FROM actor_concept ac
     JOIN concept c ON c.id = ac.concept_id
     WHERE c.pref_label = $1
     GROUP BY ac.stance`,
    [planted.searchTriple.conceptLabel],
  );
  const byStance = Object.fromEntries(tripleCounts.rows.map((r) => [r.stance, Number(r.n)]));
  const tripleOk = (byStance.established ?? 0) >= 3 && (byStance.exploring ?? 0) >= 3 && (byStance.aspiring ?? 0) >= 3;
  gates.push({
    name: "Search triple",
    passed: tripleOk,
    detail: `"${planted.searchTriple.conceptLabel}": established=${byStance.established ?? 0}, exploring=${byStance.exploring ?? 0}, aspiring=${byStance.aspiring ?? 0}`,
  });

  const contactStates = await client.query<{ state: string; n: string }>(
    `SELECT
       CASE
         WHEN a.has_account THEN 'has_account'
         WHEN EXISTS (SELECT 1 FROM actor_contact_method m WHERE m.actor_id = a.id) THEN 'methods'
         ELSE 'none'
       END AS state,
       count(*) AS n
     FROM actor a
     WHERE a.kind = 'person'
     GROUP BY 1`,
  );
  const contactByState = Object.fromEntries(contactStates.rows.map((r) => [r.state, Number(r.n)]));
  const contactOk = (contactByState.has_account ?? 0) >= 10 && (contactByState.methods ?? 0) >= 10 && (contactByState.none ?? 0) >= 10;
  gates.push({
    name: "Contact states",
    passed: contactOk,
    detail: `has_account=${contactByState.has_account ?? 0}, methods=${contactByState.methods ?? 0}, none=${contactByState.none ?? 0} (each need >= 10)`,
  });

  return gates;
}

export function printReport(gates: GateResult[], planted: PlantedReport): void {
  console.log("\n=== Seed verification ===");
  for (const gate of gates) {
    console.log(`[${gate.passed ? "PASS" : "FAIL"}] ${gate.name}: ${gate.detail}`);
  }
  const failed = gates.filter((g) => !g.passed);
  console.log(failed.length === 0 ? "\nAll gates passed." : `\n${failed.length} gate(s) FAILED — see above.`);

  console.log("\n=== Demo cheat sheet ===");
  console.log(`Demo user id: ${planted.demoUser.id} (${planted.demoUser.name})`);
  console.log(`Hero pair: ${planted.heroPair.names[0]} <-> ${planted.heroPair.names[1]} (concept: ${planted.heroPair.conceptLabel})`);
  console.log(
    `Synonym pair: ${planted.synonymPair.names[0]} ("${planted.synonymPair.variants[0]}") <-> ${planted.synonymPair.names[1]} ("${planted.synonymPair.variants[1]}") -> ${planted.synonymPair.conceptLabel}`,
  );
  console.log(`Search this on the Search page: "${planted.searchTriple.conceptLabel}"`);
  console.log(`Common-concept decoy: "${planted.commonConceptDecoy.conceptLabel}"`);
}
