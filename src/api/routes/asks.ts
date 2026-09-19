import { Router } from "express";
import { createAsk, listAsks } from "../../services/asks.js";

export const asksRouter = Router();

asksRouter.get("/asks", async (req, res) => {
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  res.json(await listAsks(cursor));
});

asksRouter.post("/asks", async (req, res) => {
  const { authorId, text, openUntil } = req.body as {
    authorId?: string;
    text?: string;
    openUntil?: string;
  };
  if (!authorId || !text) {
    return res.status(400).json({ error: "authorId and text are required" });
  }
  const id = await createAsk(authorId, text, openUntil);
  // Accepted immediately; `requires` fills in once parse_ask resolves.
  res.status(202).json({ id });
});
