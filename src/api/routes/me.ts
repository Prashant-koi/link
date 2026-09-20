import { Router } from "express";
import { recordInterest } from "../../services/aspirations.js";
import type { Stance } from "../../types.js";

export const meRouter = Router();

const VALID_STANCES: Stance[] = ["established", "exploring", "aspiring"];

// Session actor only. An actorId in the body is ignored if present — auth
// handoff, section 6: "any endpoint that accepts an actor id in a body
// where it could have used the session is a bug."
meRouter.post("/me/interests", async (req, res) => {
  const { rawText, stance } = req.body as { rawText?: string; stance?: Stance };
  if (!rawText || !stance || !VALID_STANCES.includes(stance)) {
    return res.status(400).json({ error: "rawText and a valid stance are required" });
  }
  await recordInterest(req.actorId!, rawText, stance);
  res.status(202).json({ ok: true });
});
