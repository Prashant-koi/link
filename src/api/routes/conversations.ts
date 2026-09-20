import { Router, type NextFunction, type Request, type Response } from "express";
import {
  listConversations,
  listMessages,
  markRead,
  respond,
  sendMessage,
  startOrSend,
} from "../../services/conversations.js";
import { subscribe } from "../../services/events.js";
import { HttpError } from "../../services/httpError.js";

export const conversationsRouter = Router();

type Handler = (req: Request, res: Response) => Promise<unknown>;
export const wrap =
  (fn: Handler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch((err) => {
      // A stream that already started cannot become a JSON error: just close it.
      if (res.headersSent) {
        console.error("error after the response started:", err);
        if (!res.writableEnded) res.end();
        return;
      }
      if (err instanceof HttpError) res.status(err.status).json({ error: err.code });
      else next(err);
    });
  };

conversationsRouter.get(
  "/conversations",
  wrap(async (req, res) => res.json(await listConversations(req.actorId!))),
);

conversationsRouter.get(
  "/conversations/:id/messages",
  wrap(async (req, res) =>
    res.json(
      await listMessages(req.actorId!, req.params.id, {
        before: typeof req.query.before === "string" ? req.query.before : undefined,
        limit: typeof req.query.limit === "string" ? Number(req.query.limit) : undefined,
      }),
    ),
  ),
);

conversationsRouter.post(
  "/conversations/:id/messages",
  wrap(async (req, res) => {
    const message = await sendMessage(req.actorId!, req.params.id, (req.body as { body?: unknown })?.body);
    res.status(201).json(message);
  }),
);

conversationsRouter.post(
  "/conversations/:id/accept",
  wrap(async (req, res) => res.json({ state: await respond(req.actorId!, req.params.id, true) })),
);
conversationsRouter.post(
  "/conversations/:id/decline",
  wrap(async (req, res) => res.json({ state: await respond(req.actorId!, req.params.id, false) })),
);
conversationsRouter.post(
  "/conversations/:id/read",
  wrap(async (req, res) => {
    await markRead(req.actorId!, req.params.id);
    res.status(204).end();
  }),
);

// Server-sent events: the client refetches on any event and on reconnect, so
// events carry ids only, never message content.
conversationsRouter.get("/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write("retry: 3000\n\n");
  const unsubscribe = subscribe(req.actorId!, res);
  req.on("close", unsubscribe);
});

// Start (or continue) a thread with a person. The first message is the request.
conversationsRouter.post(
  "/conversations",
  wrap(async (req, res) => {
    const { targetId, body } = req.body as { targetId?: string; body?: unknown };
    if (!targetId || !/^[0-9a-f-]{36}$/i.test(targetId)) throw new HttpError(400, "targetId_required");
    res.status(201).json(await startOrSend(req.actorId!, targetId, body));
  }),
);
