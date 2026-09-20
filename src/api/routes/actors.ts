import { Router } from "express";
import { pool } from "../../db.js";
import { resolveMeParam } from "../../auth/middleware.js";
import { getCandidateActorIds } from "../../services/candidates.js";
import { attachCachedProse, getGraphVersion } from "../../services/explain.js";
import { getPairReasons, scoreCandidates } from "../../services/scoring.js";
import { getActorSummary } from "../../services/viewModels.js";
import { listInterests, setInterestVisibility } from "../../services/interests.js";
import { DEFAULT_ATLAS_LIMIT, getAtlas, MAX_ATLAS_LIMIT } from "../../services/atlas.js";
import type { ConnectionSuggestion } from "../../types.js";

// Default cap (home's constellation) is a product decision that belongs
// with ranking, not the UI. Frontend handoff §10: /view needs to override
// it via ?limit=, capped server-side so a client can't request everything.
const DEFAULT_SUGGESTIONS_LIMIT = 5;
const MAX_SUGGESTIONS_LIMIT = 200;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const actorsRouter = Router();

// The Home map: the session actor's own interests, and the people who share them.
// Only the actor themself may ask; malformed filters are rejected, not guessed at.
actorsRouter.get("/actors/:id/atlas", async (req, res, next) => {
  const actorId = resolveMeParam(req, req.params.id);
  if (actorId !== req.actorId) return res.status(403).json({ error: "forbidden" });
  const { conceptId, limit: rawLimit } = req.query;
  if (conceptId !== undefined && (typeof conceptId !== "string" || !UUID_PATTERN.test(conceptId))) {
    return res.status(400).json({ error: "conceptId must be a valid concept ID" });
  }
  const requestedLimit = rawLimit === undefined ? DEFAULT_ATLAS_LIMIT : Number(rawLimit);
  if ((rawLimit !== undefined && typeof rawLimit !== "string") || !Number.isInteger(requestedLimit) || requestedLimit < 1) {
    return res.status(400).json({ error: "limit must be a positive integer" });
  }
  try {
    res.json(await getAtlas(actorId, conceptId, Math.min(requestedLimit, MAX_ATLAS_LIMIT)));
  } catch (error) {
    next(error);
  }
});

// Allowed for any discoverable actor, or for the session actor viewing
// their own (possibly non-discoverable) profile. 404 rather than 403 for
// everyone else, so the response never confirms the actor exists — auth
// handoff, section 6.
actorsRouter.get("/actors/:id", async (req, res) => {
  const id = resolveMeParam(req, req.params.id);
  const actor = await getActorSummary(id);
  if (!actor) return res.status(404).json({ error: "not_found" });
  const { rows } = await pool.query<{ discoverable: boolean }>(`SELECT discoverable FROM actor WHERE id = $1`, [id]);
  if (!rows[0]?.discoverable && id !== req.actorId) return res.status(404).json({ error: "not_found" });
  res.json(actor);
});

// "Someone else's matches are not yours to read" — the rule most likely to
// get missed, per the handoff's own callout.
actorsRouter.get("/actors/:id/suggestions", async (req, res) => {
  const actorId = resolveMeParam(req, req.params.id);
  if (actorId !== req.actorId) return res.status(403).json({ error: "forbidden" });

  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, MAX_SUGGESTIONS_LIMIT)
    : DEFAULT_SUGGESTIONS_LIMIT;

  const candidateIds = await getCandidateActorIds(actorId);
  const scored = await scoreCandidates(actorId, candidateIds);
  const top = scored.slice(0, limit);
  const graphVersion = await getGraphVersion();

  const suggestions: ConnectionSuggestion[] = [];
  for (const candidate of top) {
    const summary = await getActorSummary(candidate.actorId);
    if (!summary) continue;
    const reasons = await Promise.all(
      candidate.reasons.map((r) => attachCachedProse(actorId, candidate.actorId, r, graphVersion)),
    );
    suggestions.push({ actor: summary, score: candidate.score, reasons });
  }

  res.json(suggestions);
});

// Allowed only from the session actor's side.
actorsRouter.get("/actors/:id/connections/:otherId", async (req, res) => {
  const id = resolveMeParam(req, req.params.id);
  if (id !== req.actorId) return res.status(403).json({ error: "forbidden" });

  const { otherId } = req.params;
  const graphVersion = await getGraphVersion();
  const rawReasons = await getPairReasons(id, otherId);
  const reasons = await Promise.all(rawReasons.map((r) => attachCachedProse(id, otherId, r, graphVersion)));
  res.json(reasons);
});

// Settings-only endpoints below — not in the frontend handoff's endpoint
// table, but self-editing operations, so the same "session actor only"
// rule applies by the same logic as /me/interests.

actorsRouter.patch("/actors/:id", async (req, res) => {
  const id = resolveMeParam(req, req.params.id);
  if (id !== req.actorId) return res.status(403).json({ error: "forbidden" });

  const { discoverable } = req.body as { discoverable?: boolean };
  if (typeof discoverable !== "boolean") {
    return res.status(400).json({ error: "discoverable (boolean) is required" });
  }
  await pool.query(`UPDATE actor SET discoverable = $2 WHERE id = $1`, [id, discoverable]);
  const actor = await getActorSummary(id);
  if (!actor) return res.status(404).json({ error: "not_found" });
  res.json(actor);
});

// Settings-only: `discoverable` isn't part of the §9 ActorSummary contract
// (deliberately — other pages never need to see it), so it's returned as a
// separate shape rather than reshaping the shared type.
actorsRouter.get("/actors/:id/settings", async (req, res) => {
  const id = resolveMeParam(req, req.params.id);
  if (id !== req.actorId) return res.status(403).json({ error: "forbidden" });

  const actor = await getActorSummary(id);
  if (!actor) return res.status(404).json({ error: "not_found" });
  const { rows } = await pool.query<{ discoverable: boolean }>(`SELECT discoverable FROM actor WHERE id = $1`, [id]);
  res.json({ ...actor, discoverable: rows[0].discoverable });
});

actorsRouter.get("/actors/:id/interests", async (req, res) => {
  const id = resolveMeParam(req, req.params.id);
  if (id !== req.actorId) return res.status(403).json({ error: "forbidden" });
  res.json(await listInterests(id));
});

actorsRouter.patch("/actors/:id/interests/:interestId", async (req, res, next) => {
  const id = resolveMeParam(req, req.params.id);
  if (id !== req.actorId) return res.status(403).json({ error: "forbidden" });

  const { visibility } = req.body as { visibility?: "public" | "institution" | "private" };
  if (!visibility || !["public", "institution", "private"].includes(visibility)) {
    return res.status(400).json({ error: "a valid visibility is required" });
  }
  if (!UUID_PATTERN.test(req.params.interestId)) return res.status(400).json({ error: "interestId must be a valid interest ID" });
  try {
    // Scoped to the session actor: without this, anyone could change anyone's interest visibility by id.
    const updated = await setInterestVisibility(id, req.params.interestId, visibility);
    if (!updated) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
