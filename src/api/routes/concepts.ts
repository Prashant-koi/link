import { Router } from "express";
import { getActorsForConcept } from "../../services/concepts.js";

export const conceptsRouter = Router();

conceptsRouter.get("/concepts/:id/actors", async (req, res) => {
  res.json(await getActorsForConcept(req.params.id));
});
