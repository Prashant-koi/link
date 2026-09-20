import express from "express";
import { authRouter } from "../auth/routes.js";
import { requireSession } from "../auth/middleware.js";
import { actorsRouter } from "./routes/actors.js";
import { asksRouter } from "./routes/asks.js";
import { conceptsRouter } from "./routes/concepts.js";
import { importsRouter } from "./routes/imports.js";
import { introsRouter } from "./routes/intros.js";
import { meRouter } from "./routes/me.js";
import { searchRouter } from "./routes/search.js";

// One requireSession layer in front of everything except /auth/*, static
// assets, and onboarding — auth handoff, "Endpoints". actor identity comes
// from the session everywhere below requireSession, never from the request
// body.
//
// importsRouter is the one exception, mounted ahead of requireSession:
// onboarding (POST /actors, the resume/LinkedIn/GitHub/course imports)
// necessarily runs *before* a person has any credential or session — the
// auth handoff explicitly leaves signup out of scope, and imports is what
// currently fills that gap. Its endpoints still take actorId explicitly
// rather than from a session, by design, not by omission.
export function createServer() {
  const app = express();
  // Uploads arrive as base64 in the JSON body (no multipart middleware in
  // this API), so the default 100kb limit would reject an ordinary resume.
  app.use(express.json({ limit: "12mb" }));

  app.use(authRouter);
  app.use(importsRouter);

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
