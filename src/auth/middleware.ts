import type { NextFunction, Request, Response } from "express";
import { readSessionIdFromCookies, resolveSession } from "./session.js";

declare module "express-serve-static-core" {
  interface Request {
    actorId?: string;
  }
}

// One layer in front of everything except /auth/* and static assets — auth
// handoff, "Endpoints". Actor identity comes from the session, never from
// the request; this is what makes that rule enforceable.
export async function requireSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const sessionId = readSessionIdFromCookies(req.headers.cookie);
  if (!sessionId) {
    res.status(401).end();
    return;
  }
  const session = await resolveSession(sessionId);
  if (!session) {
    res.status(401).end();
    return;
  }
  req.actorId = session.actorId;
  next();
}

// The literal path segment "me" resolves to the session actor — auth
// handoff, "Endpoints": "{me} in GET /actors/{me}/suggestions resolves
// from req.actorId ... substituted server-side."
export function resolveMeParam(req: Request, param: string): string {
  return param === "me" ? req.actorId! : param;
}
