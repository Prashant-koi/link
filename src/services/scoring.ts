import { pool } from "../db.js";
import type { EvidenceRef, Reason } from "../types.js";

// Tuning constants the data model handoff leaves open (section "Open
// questions": hop decay constant, and no concrete values are given for the
// context weight/recency terms either). Defaults here are placeholders,
// same as the doc's own 0.92/0.75 thresholds, pending measurement.
const HOP_DECAY = 0.5;
const CONNECTED_PENALTY = 5;
const CONTEXT_RECENCY_HALF_LIFE_YEARS = 3;
const REASONS_CAP = 3;

interface ScoredEvidence {
  contribution: number;
  reason: Reason;
}

export interface ScoredCandidate {
  actorId: string;
  score: number;
  reasons: Reason[];
}

function contextRecency(validTo: string | null): number {
  if (validTo === null) return 1; // still current
  const years = (Date.now() - new Date(validTo).getTime()) / (365.25 * 24 * 3600 * 1000);
  return Math.pow(0.5, Math.max(years, 0) / CONTEXT_RECENCY_HALF_LIFE_YEARS);
}

// Collects raw scoring evidence for actorId against each of candidateIds:
//   score(a,b) = sum_c idf(c) s(a,c) s(b,c) gamma^hops(c)
//              + sum_x w(x) rec(x)
//              - lambda * connected(a,b)
// (data model handoff, "Ranking, and not overwhelming people"). Shared by
// the ranked-suggestions path and the single-pair detail path so both stay
// consistent with the same formula.
async function collectEvidence(
  actorId: string,
  candidateIds: string[],
): Promise<{ byCandidate: Map<string, ScoredEvidence[]>; connectedSet: Set<string> }> {
  const byCandidate = new Map<string, ScoredEvidence[]>();
  const add = (candidateId: string, evidence: ScoredEvidence) => {
    if (!byCandidate.has(candidateId)) byCandidate.set(candidateId, []);
    byCandidate.get(candidateId)!.push(evidence);
  };

  if (candidateIds.length === 0) return { byCandidate, connectedSet: new Set() };

  // Direct shared concepts (hop 0, decay 1).
  const direct = await pool.query(
    `SELECT ac_b.actor_id AS candidate_id, c.id AS concept_id, c.pref_label,
            ac_a.strength AS strength_a, ac_b.strength AS strength_b, idf.idf
     FROM actor_concept ac_a
     JOIN actor_concept ac_b
       ON ac_b.concept_id = ac_a.concept_id AND ac_b.actor_id = ANY($2) AND ac_b.visibility <> 'private'
     JOIN concept c ON c.id = ac_a.concept_id
     JOIN concept_idf idf ON idf.concept_id = ac_a.concept_id
     WHERE ac_a.actor_id = $1 AND ac_a.visibility <> 'private'`,
    [actorId, candidateIds],
  );
  for (const row of direct.rows) {
    const contribution = row.idf * (row.strength_a ?? 1) * (row.strength_b ?? 1);
    const evidence: EvidenceRef = { kind: "concept", id: row.concept_id, label: row.pref_label };
    add(row.candidate_id, {
      contribution,
      reason: { kind: "shared_concept", summary: `Both interested in ${row.pref_label}`, evidence: [evidence] },
    });
  }

  // One-hop concept hierarchy (broader/related), decayed by HOP_DECAY.
  const hierarchy = await pool.query(
    `SELECT ac_b.actor_id AS candidate_id, c_a.pref_label AS label_a, c_b.pref_label AS label_b,
            c_b.id AS concept_id_b, ac_a.strength AS strength_a, ac_b.strength AS strength_b,
            idf.idf, cr.weight
     FROM actor_concept ac_a
     JOIN concept_relation cr ON cr.src_id = ac_a.concept_id OR cr.dst_id = ac_a.concept_id
     JOIN actor_concept ac_b
       ON ac_b.concept_id = CASE WHEN cr.src_id = ac_a.concept_id THEN cr.dst_id ELSE cr.src_id END
      AND ac_b.actor_id = ANY($2) AND ac_b.visibility <> 'private'
      AND ac_b.concept_id <> ac_a.concept_id
     JOIN concept c_a ON c_a.id = ac_a.concept_id
     JOIN concept c_b ON c_b.id = ac_b.concept_id
     JOIN concept_idf idf ON idf.concept_id = ac_a.concept_id
     WHERE ac_a.actor_id = $1 AND ac_a.visibility <> 'private'`,
    [actorId, candidateIds],
  );
  for (const row of hierarchy.rows) {
    const contribution =
      row.idf * (row.strength_a ?? 1) * (row.strength_b ?? 1) * HOP_DECAY * (row.weight ?? 1);
    add(row.candidate_id, {
      contribution,
      reason: {
        kind: "shared_concept",
        summary: `Related interests: ${row.label_a} and ${row.label_b}`,
        evidence: [{ kind: "concept", id: row.concept_id_b, label: row.label_b }],
      },
    });
  }

  // Shared contexts: actor -> context <- candidate.
  const contexts = await pool.query(
    `SELECT e_b.src_id AS candidate_id, e_a.dst_id AS context_id, ctx.title,
            e_a.weight AS weight_a, e_b.weight AS weight_b,
            e_a.valid_to AS valid_to_a, e_b.valid_to AS valid_to_b,
            e_a.valid_from AS valid_from_a, e_b.valid_from AS valid_from_b
     FROM edge e_a
     JOIN edge e_b
       ON e_b.dst_id = e_a.dst_id AND e_b.dst_type = e_a.dst_type
      AND e_b.src_id = ANY($2) AND e_b.src_type = 'actor' AND e_b.visibility <> 'private'
     LEFT JOIN context ctx ON ctx.id = e_a.dst_id AND e_a.dst_type = 'context'
     WHERE e_a.src_id = $1 AND e_a.src_type = 'actor' AND e_a.visibility <> 'private'
       AND e_a.dst_id <> $1`,
    [actorId, candidateIds],
  );
  for (const row of contexts.rows) {
    const mostRecentValidTo =
      row.valid_to_a === null || row.valid_to_b === null ? null : [row.valid_to_a, row.valid_to_b].sort().pop();
    const recency = contextRecency(mostRecentValidTo ?? null);
    const weight = (row.weight_a ?? 1) * (row.weight_b ?? 1);
    const contribution = weight * recency;
    const period =
      row.valid_from_a || row.valid_to_a
        ? { from: row.valid_from_a, to: row.valid_to_a ?? undefined }
        : undefined;
    add(row.candidate_id, {
      contribution,
      reason: {
        kind: "shared_context",
        summary: row.title ? `Both connected to ${row.title}` : "Shared context",
        evidence: [{ kind: "context", id: row.context_id, label: row.title ?? "context", period }],
      },
    });
  }

  // Direct actor-actor edges: penalize recommending an existing connection.
  const connected = await pool.query<{ actor_id: string }>(
    `SELECT CASE WHEN src_id = $1 THEN dst_id ELSE src_id END AS actor_id
     FROM edge
     WHERE src_type = 'actor' AND dst_type = 'actor'
       AND ((src_id = $1 AND dst_id = ANY($2)) OR (dst_id = $1 AND src_id = ANY($2)))`,
    [actorId, candidateIds],
  );

  return { byCandidate, connectedSet: new Set(connected.rows.map((r) => r.actor_id)) };
}

export async function scoreCandidates(actorId: string, candidateIds: string[]): Promise<ScoredCandidate[]> {
  const { byCandidate, connectedSet } = await collectEvidence(actorId, candidateIds);

  const results: ScoredCandidate[] = [];
  for (const candidateId of candidateIds) {
    const evidence = byCandidate.get(candidateId);
    if (!evidence || evidence.length === 0) continue;

    const rawScore = evidence.reduce((sum, e) => sum + e.contribution, 0);
    const score = rawScore - (connectedSet.has(candidateId) ? CONNECTED_PENALTY : 0);
    if (score <= 0) continue;

    const reasons = evidence
      .slice()
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, REASONS_CAP)
      .map((e) => e.reason);

    results.push({ actorId: candidateId, score, reasons });
  }

  return results.sort((a, b) => b.score - a.score);
}

// Full path detail for one specific pair (GET /actors/{id}/connections/{otherId}):
// every reason, uncapped, ordered by contribution.
export async function getPairReasons(actorId: string, otherId: string): Promise<Reason[]> {
  const { byCandidate } = await collectEvidence(actorId, [otherId]);
  const evidence = byCandidate.get(otherId) ?? [];
  return evidence
    .slice()
    .sort((a, b) => b.contribution - a.contribution)
    .map((e) => e.reason);
}
