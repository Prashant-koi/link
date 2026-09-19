import { pool, withTransaction } from "../db.js";
import { enqueue } from "../queue.js";
import { tryFastResolve } from "./resolution.js";
import { getMaxIdf, normalizeRarity } from "./idf.js";
import { getActorSummary } from "./viewModels.js";
import type { AspirationMatch, MatchKind, Stance } from "../types.js";

const DECAY_HALF_LIFE_DAYS = 270; // ~9 months; same unconfigured-constant status as gamma

function matchKindFor(theirStance: Stance): MatchKind {
  switch (theirStance) {
    case "established":
      return "mentor";
    case "exploring":
      return "peer";
    case "aspiring":
      return "fellow_explorer";
  }
}

// Aspirations and explorations rot: someone who wrote "want to learn RF
// design" 14 months ago probably moved on. Established expertise doesn't
// decay (no stance_since is recorded for it).
function stanceDecay(stance: Stance, stanceSince: string | null): number {
  if (stance === "established" || !stanceSince) return 1;
  const days = (Date.now() - new Date(stanceSince).getTime()) / (24 * 3600 * 1000);
  return Math.pow(0.5, Math.max(days, 0) / DECAY_HALF_LIFE_DAYS);
}

// Records a stated interest with its stance (settings defaults to
// 'established', search defaults to 'aspiring') and resolves it
// asynchronously through the normal pipeline, same as any other raw_text.
export async function recordInterest(actorId: string, rawText: string, stance: Stance): Promise<void> {
  await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO actor_concept (actor_id, raw_text, source, stance, stance_since)
       VALUES ($1, $2, 'user', $3, CASE WHEN $3 = 'established' THEN NULL ELSE current_date END)
       RETURNING id`,
      [actorId, rawText, stance],
    );
    await enqueue(client, "resolve_concept", { target: "actor_concept", targetId: rows[0].id, rawText });
  });
}

// GET /search/aspirations?q=: my stance is always 'aspiring' here (this is
// the aspiration-search page). Resolution only goes as far as exact/fuzzy —
// a read path never blocks on the model; an unresolved query returns no
// matches rather than waiting on a background job.
export async function searchAspirations(meActorId: string, q: string): Promise<AspirationMatch[]> {
  const resolved = await tryFastResolve(q);
  if (!resolved) return [];

  const maxIdf = await getMaxIdf();
  const { rows } = await pool.query(
    `SELECT ac.actor_id, ac.stance, ac.stance_since, ac.strength, c.pref_label, idf.idf
     FROM actor_concept ac
     JOIN actor a ON a.id = ac.actor_id
     JOIN concept c ON c.id = ac.concept_id
     JOIN concept_idf idf ON idf.concept_id = ac.concept_id
     WHERE ac.concept_id = $1 AND ac.actor_id <> $2
       AND ac.visibility <> 'private' AND a.discoverable = true`,
    [resolved.conceptId, meActorId],
  );

  const matches: AspirationMatch[] = [];
  for (const row of rows) {
    const actor = await getActorSummary(row.actor_id);
    if (!actor) continue;

    const decay = stanceDecay(row.stance, row.stance_since);
    const score = row.idf * (row.strength ?? 1) * decay;

    matches.push({
      actor,
      matchKind: matchKindFor(row.stance),
      concept: {
        conceptId: resolved.conceptId,
        label: row.pref_label,
        shownAs: row.pref_label,
        rarity: normalizeRarity(row.idf, maxIdf),
      },
      theirStance: row.stance,
      score,
      reasons: [
        {
          kind: "shared_concept",
          summary: `${actor.displayName} is ${row.stance} in ${row.pref_label}`,
          evidence: [{ kind: "concept", id: resolved.conceptId, label: row.pref_label }],
        },
      ],
    });
  }

  return matches.sort((a, b) => b.score - a.score);
}
