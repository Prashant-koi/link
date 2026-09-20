import path from "node:path";
import { fileURLToPath } from "node:url";
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "..", "public"); // ./public in the built image — see Dockerfile

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

  // Everything API-shaped lives under /api. Deployment handoff, "Serve the
  // frontend from the API container": the frontend calls the API at
  // `/api/...` regardless of environment, so this namespace exists in both
  // dev (Vite proxies unchanged) and prod (this same Express instance
  // handles it directly) — same-origin either way, which is what makes the
  // SameSite=Lax session cookie actually attach.
  const api = express.Router();
  api.use(authRouter);
  api.use(importsRouter);
  api.use(requireSession);
  api.use(actorsRouter);
  api.use(conceptsRouter);
  api.use(asksRouter);
  api.use(introsRouter);
  api.use(meRouter);
  api.use(searchRouter);
  app.use("/api", api);

  // Built frontend assets (Dockerfile copies web/dist here). Static files
  // first so a real asset (e.g. /assets/index-abc.js) is served directly;
  // anything else non-/api falls back to index.html so client-side routing
  // survives a refresh on a deep link like /settings.
  app.use(express.static(PUBLIC_DIR));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
