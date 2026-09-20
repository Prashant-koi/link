import { pool } from "../db.js";
import { attachCachedProse, getGraphVersion } from "./explain.js";
import { scoreCandidates } from "./scoring.js";
import { getActorSummary } from "./viewModels.js";
import type { AtlasResponse, AtlasSuggestion, Reason } from "../types.js";

export const DEFAULT_ATLAS_LIMIT = 12;
export const MAX_ATLAS_LIMIT = 24;

/**
 * A people-only map grounded in exact, visible shared interests. Membership
 * comes from the complete graph, never the five chips on a profile or the
 * three reasons returned by the scorer. There are no decorative candidates.
 */
export async function getAtlas(
  actorId: string,
  conceptId?: string,
  limit = DEFAULT_ATLAS_LIMIT,
): Promise<AtlasResponse> {
  const { rows } = await pool.query<{
    concept_id: string;
    pref_label: string;
    candidate_id: string | null;
  }>(
    `WITH my_concepts AS (
       SELECT DISTINCT c.id, c.pref_label
       FROM actor_concept ac
       JOIN concept c ON c.id = ac.concept_id
       WHERE ac.actor_id = $1 AND ac.visibility <> 'private'
     ), visible_people AS (
       SELECT DISTINCT ac.concept_id, ac.actor_id
       FROM actor_concept ac
       JOIN actor a ON a.id = ac.actor_id
       WHERE ac.visibility <> 'private' AND a.discoverable = true
         AND a.kind = 'person' AND a.id <> $1
     )
     SELECT mc.id AS concept_id, mc.pref_label, vp.actor_id AS candidate_id
     FROM my_concepts mc
     LEFT JOIN visible_people vp ON vp.concept_id = mc.id
     ORDER BY mc.pref_label, mc.id, vp.actor_id`,
    [actorId],
  );

  const interests = new Map<string, { conceptId: string; label: string; count: number }>();
  const sharedByActor = new Map<string, Set<string>>();
  for (const row of rows) {
    interests.set(row.concept_id, { conceptId: row.concept_id, label: row.pref_label, count: 0 });
    if (!row.candidate_id) continue;
    const shared = sharedByActor.get(row.candidate_id) ?? new Set<string>();
    shared.add(row.concept_id);
    sharedByActor.set(row.candidate_id, shared);
  }

  // Existing scoring includes rarity, strength, shared contexts, and the
  // connected-person penalty. Rank before capping so switching interests
  // can reveal people outside the original twelve results.
  const ranked = await scoreCandidates(actorId, [...sharedByActor.keys()]);
  for (const candidate of ranked) {
    for (const id of sharedByActor.get(candidate.actorId)!) interests.get(id)!.count++;
  }
  const matching = conceptId
    ? ranked.filter((candidate) => sharedByActor.get(candidate.actorId)!.has(conceptId))
    : ranked;
  const graphVersion = matching.length ? await getGraphVersion() : 0;
  const selectedInterest = conceptId ? interests.get(conceptId) : undefined;
  const cappedLimit = Number.isFinite(limit)
    ? Math.min(MAX_ATLAS_LIMIT, Math.max(1, Math.floor(limit)))
    : DEFAULT_ATLAS_LIMIT;

  const suggestions = await Promise.all(matching.slice(0, cappedLimit).map(async (candidate): Promise<AtlasSuggestion | null> => {
    const actor = await getActorSummary(candidate.actorId);
    if (!actor) return null;
    let rawReasons = candidate.reasons;
    if (selectedInterest) {
      // The selected interest may be less rare than the top three reasons;
      // keep its exact evidence visible without claiming a different score.
      const selectedReason: Reason = {
        kind: "shared_concept",
        summary: `Both interested in ${selectedInterest.label}`,
        evidence: [{ kind: "concept", id: selectedInterest.conceptId, label: selectedInterest.label }],
      };
      rawReasons = [selectedReason, ...rawReasons.filter((reason) =>
        !reason.evidence.some((evidence) => evidence.kind === "concept" && evidence.id === conceptId),
      )].slice(0, 3);
    }
    return {
      actor,
      score: candidate.score,
      sharedConceptIds: [...sharedByActor.get(candidate.actorId)!],
      reasons: await Promise.all(rawReasons.map((reason) => attachCachedProse(actorId, candidate.actorId, reason, graphVersion))),
    };
  }));

  return {
    interests: [...interests.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    suggestions: suggestions.filter((suggestion): suggestion is AtlasSuggestion => suggestion !== null),
    total: matching.length,
  };
}
