import { Router } from "express";
import { pool } from "../../db.js";
import { requestIntro } from "../../services/intros.js";

export const introsRouter = Router();

// Author is the session actor, never the body — auth handoff, section 6.
// Target must be discoverable; 404 rather than exposing whether a
// non-discoverable id exists.
introsRouter.post("/intros", async (req, res) => {
  const { targetId } = req.body as { targetId?: string };
  if (!targetId) {
    return res.status(400).json({ error: "targetId is required" });
  }
  const { rows } = await pool.query<{ discoverable: boolean }>(
    `SELECT discoverable FROM actor WHERE id = $1`,
    [targetId],
  );
  if (!rows[0]?.discoverable) return res.status(404).json({ error: "not_found" });

  const state = await requestIntro(req.actorId!, targetId);
  res.status(201).json({ state });
});
