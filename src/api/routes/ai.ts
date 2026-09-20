import { Router } from "express";
import {
  answer,
  createThread,
  deleteThread,
  getThread,
  listAttachable,
  listMessages,
  listThreads,
  renameThread,
  setSources,
} from "../../services/ai/threads.js";
import { HttpError } from "../../services/httpError.js";
import { wrap } from "./conversations.js";

export const aiRouter = Router();

aiRouter.get("/ai/sources", wrap(async (req, res) => res.json(await listAttachable(req.actorId!))));
aiRouter.get("/ai/threads", wrap(async (req, res) => res.json(await listThreads(req.actorId!))));
aiRouter.post(
  "/ai/threads",
  wrap(async (req, res) => res.status(201).json(await createThread(req.actorId!, (req.body as { sources?: unknown })?.sources))),
);
aiRouter.get("/ai/threads/:id", wrap(async (req, res) => res.json(await getThread(req.actorId!, req.params.id))));
aiRouter.patch(
  "/ai/threads/:id",
  wrap(async (req, res) => {
    await renameThread(req.actorId!, req.params.id, (req.body as { title?: unknown })?.title);
    res.status(204).end();
  }),
);
aiRouter.delete(
  "/ai/threads/:id",
  wrap(async (req, res) => {
    await deleteThread(req.actorId!, req.params.id);
    res.status(204).end();
  }),
);
aiRouter.put(
  "/ai/threads/:id/sources",
  wrap(async (req, res) => {
    await setSources(req.actorId!, req.params.id, (req.body as { sources?: unknown })?.sources);
    res.status(204).end();
  }),
);
aiRouter.get("/ai/threads/:id/messages", wrap(async (req, res) => res.json(await listMessages(req.actorId!, req.params.id))));

// Streams the answer as server-sent events. Errors thrown before the stream
// starts (bad input, rate limit, not yours) are ordinary JSON errors.
aiRouter.post(
  "/ai/threads/:id/messages",
  wrap(async (req, res) => {
    const text = (req.body as { text?: unknown })?.text;
    if (typeof text !== "string") throw new HttpError(400, "message_required");
    await answer(req.actorId!, req.params.id, text, res);
  }),
);
