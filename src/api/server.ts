import express from "express";
import { authRouter } from "../auth/routes.js";
import { requireSession } from "../auth/middleware.js";
import { actorsRouter } from "./routes/actors.js";
import { asksRouter } from "./routes/asks.js";
import { conceptsRouter } from "./routes/concepts.js";
import { introsRouter } from "./routes/intros.js";
import { meRouter } from "./routes/me.js";
import { searchRouter } from "./routes/search.js";

// One requireSession layer in front of everything except /auth/* and
// static assets — auth handoff, "Endpoints". actor identity comes from the
// session everywhere below, never from the request body.
export function createServer() {
  const app = express();
  app.use(express.json());

  app.use(authRouter);

  app.use(requireSession);
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
