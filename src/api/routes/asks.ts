import { Router } from "express";
import { createAsk, listAsks } from "../../services/asks.js";

export const asksRouter = Router();

asksRouter.get("/asks", async (req, res) => {
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  res.json(await listAsks(cursor));
});

// Author is the session actor, never the body — same rule as /intros and
// /me/interests (auth handoff, section 6).
asksRouter.post("/asks", async (req, res) => {
  const { text, openUntil } = req.body as { text?: string; openUntil?: string };
  if (!text) {
    return res.status(400).json({ error: "text is required" });
  }
  const id = await createAsk(req.actorId!, text, openUntil);
  // Accepted immediately; `requires` fills in once parse_ask resolves.
  res.status(202).json({ id });
});
