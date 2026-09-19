import { Router } from "express";
import { recordInterest } from "../../services/aspirations.js";
import type { Stance } from "../../types.js";

export const meRouter = Router();

const VALID_STANCES: Stance[] = ["established", "exploring", "aspiring"];

// Auth is unresolved — actorId stands in for a session-derived "me".
meRouter.post("/me/interests", async (req, res) => {
  const { actorId, rawText, stance } = req.body as {
    actorId?: string;
    rawText?: string;
    stance?: Stance;
  };
  if (!actorId || !rawText || !stance || !VALID_STANCES.includes(stance)) {
    return res.status(400).json({ error: "actorId, rawText, and a valid stance are required" });
  }
  await recordInterest(actorId, rawText, stance);
  res.status(202).json({ ok: true });
});
