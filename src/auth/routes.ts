import { Router } from "express";
import { config } from "../config.js";
import { getActorSummary } from "../services/viewModels.js";
import { compareAgainstDummyHash, findCredentialByUsername, touchLastLogin, verifyPassword } from "./credentials.js";
import {
  clearSessionCookieHeader,
  createSession,
  isRateLimited,
  readSessionIdFromCookies,
  recordLoginAttempt,
  resolveSession,
  revokeSession,
  sessionCookieHeader,
} from "./session.js";

export const authRouter = Router();

const GENERIC_LOGIN_ERROR = "That username or password didn't match";

authRouter.post("/auth/login", async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    return res.status(400).json({ error: "username and password are required" });
  }
  const normalizedUsername = username.toLowerCase();

  if (isRateLimited(normalizedUsername)) {
    return res.status(429).json({ error: "too many attempts, try again later" });
  }
  recordLoginAttempt(normalizedUsername);

  const credential = await findCredentialByUsername(normalizedUsername);
  if (!credential) {
    await compareAgainstDummyHash(password); // timing parity with a real user lookup
    return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
  }

  // Real mode never authenticates a demo-derived password — the account
  // needs an explicit reset first (auth handoff, "Mode gate").
  if (config.auth.mode === "real" && credential.derived) {
    return res.status(401).json({ error: "This account needs a password reset." });
  }

  const valid = await verifyPassword(password, credential.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
  }

  const sessionId = await createSession(credential.actorId, req.headers["user-agent"]);
  await touchLastLogin(credential.actorId);

  const actor = await getActorSummary(credential.actorId);
  res.setHeader("Set-Cookie", sessionCookieHeader(sessionId));
  res.json({ actor, authMode: config.auth.mode });
});

authRouter.post("/auth/logout", async (req, res) => {
  const sessionId = readSessionIdFromCookies(req.headers.cookie);
  if (sessionId) await revokeSession(sessionId);
  res.setHeader("Set-Cookie", clearSessionCookieHeader());
  res.status(204).end();
});

authRouter.get("/auth/me", async (req, res) => {
  const sessionId = readSessionIdFromCookies(req.headers.cookie);
  const session = sessionId ? await resolveSession(sessionId) : null;
  // authMode rides along even on a 401: the login page needs to know
  // whether to render the demo banner before anyone has authenticated —
  // auth handoff, "it is visible at runtime."
  if (!session) return res.status(401).json({ authMode: config.auth.mode });

  const actor = await getActorSummary(session.actorId);
  res.json({ actor, authMode: config.auth.mode });
});
