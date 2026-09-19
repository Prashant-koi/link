import { Router } from "express";
import { search } from "../../services/search.js";
import { searchAspirations } from "../../services/aspirations.js";

export const searchRouter = Router();

searchRouter.get("/search", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  if (!q) return res.json([]);
  res.json(await search(q));
});

// Auth is unresolved (see backend handoff open questions), so `me` is
// passed explicitly rather than derived from a session, same as
// requesterId/authorId elsewhere in this API.
searchRouter.get("/search/aspirations", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const me = typeof req.query.me === "string" ? req.query.me : "";
  if (!q || !me) return res.status(400).json({ error: "q and me are required" });
  res.json(await searchAspirations(me, q));
});
