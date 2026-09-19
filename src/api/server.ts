import express from "express";
import { actorsRouter } from "./routes/actors.js";
import { asksRouter } from "./routes/asks.js";
import { conceptsRouter } from "./routes/concepts.js";
import { introsRouter } from "./routes/intros.js";
import { meRouter } from "./routes/me.js";
import { searchRouter } from "./routes/search.js";

// Auth is an explicit open question in the backend handoff (actor identity
// vs. session identity isn't reconciled yet) — no auth middleware here.
export function createServer() {
  const app = express();
  app.use(express.json());

  app.use(actorsRouter);
  app.use(conceptsRouter);
  app.use(asksRouter);
  app.use(introsRouter);
  app.use(meRouter);
  app.use(searchRouter);

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
