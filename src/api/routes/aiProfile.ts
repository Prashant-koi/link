import { Router } from "express";
import { resolveMeParam } from "../../auth/middleware.js";
import { streamProfileSummary } from "../../services/profileSummary.js";
import { wrap } from "./conversations.js";

export const aiProfileRouter = Router();

// Streams an AI summary of a person ("Learn more" in the profile panel) as server-sent events.
aiProfileRouter.get(
  "/ai/profiles/:id/summary",
  wrap(async (req, res) => {
    await streamProfileSummary(req.actorId!, resolveMeParam(req, req.params.id), res);
  }),
);
