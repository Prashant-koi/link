import { Router } from "express";
import { search } from "../../services/search.js";
import { searchAspirations } from "../../services/aspirations.js";
import { refineSearch, smartSearch } from "../../services/smartSearch.js";

export const searchRouter = Router();

searchRouter.get("/search", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  if (!q) return res.json([]);
  res.json(await search(q));
});

// The session actor's own stances inform the match — auth handoff, section 6.
searchRouter.get("/search/aspirations", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  if (!q) return res.status(400).json({ error: "q is required" });
  res.json(await searchAspirations(req.actorId!, q));
});

// Meaning-based search. Phase 1 (default) is instant and never calls the model;
// `ai=1` asks the local model to read the query against the candidates (split
// multi-part queries, pick the fitting topics, fix typos). It reads only — a
// search never changes anyone's profile — and answers 204 when the model
// cannot add anything (down, slow, or nothing to refine), leaving phase 1 as is.
const recent = new Map<string, number[]>();
function tooMany(actorId: string): boolean {
  const now = Date.now();
  const list = (recent.get(actorId) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  recent.set(actorId, list);
  return list.length > 90;
}

searchRouter.get("/search/smart", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  if (!q.trim()) return res.status(400).json({ error: "q is required" });
  if (tooMany(req.actorId!)) return res.status(429).json({ error: "rate_limited" });
  try {
    if (req.query.ai === "1") {
      const refined = await refineSearch(req.actorId!, q);
      return refined ? res.json(refined) : res.status(204).end();
    }
    res.json(await smartSearch(req.actorId!, q));
  } catch (err) {
    console.error("smart search failed:", err);
    res.status(500).json({ error: "search_failed" });
  }
});
