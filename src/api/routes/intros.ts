import { Router } from "express";
import { requestIntro } from "../../services/intros.js";

export const introsRouter = Router();

introsRouter.post("/intros", async (req, res) => {
  const { requesterId, targetId } = req.body as { requesterId?: string; targetId?: string };
  if (!requesterId || !targetId) {
    return res.status(400).json({ error: "requesterId and targetId are required" });
  }
  const state = await requestIntro(requesterId, targetId);
  res.status(201).json({ state });
});
