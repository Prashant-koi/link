import { Router } from "express";
import { search } from "../../services/search.js";
import { searchAspirations } from "../../services/aspirations.js";

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
