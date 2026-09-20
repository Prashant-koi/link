import { createHmac, timingSafeEqual } from "node:crypto";
import { pool } from "../db.js";
import { config } from "../config.js";

const COOKIE_NAME = "link_sid";
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000; // 7 days — longer than the hackathon, no sliding expiry

// Server-side sessions with a signed cookie holding the session id, not
// JWTs — a session row can be revoked with one UPDATE; a JWT can't be
// killed mid-demo without rotating the signing key and logging everyone
// out (auth handoff, "Sessions").
function sign(value: string): string {
  const mac = createHmac("sha256", config.auth.sessionSecret).update(value).digest("base64url");
  return `${value}.${mac}`;
}

function unsign(signed: string): string | null {
  const idx = signed.lastIndexOf(".");
  if (idx < 0) return null;
  const value = signed.slice(0, idx);
  const mac = signed.slice(idx + 1);
  const expected = createHmac("sha256", config.auth.sessionSecret).update(value).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return value;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function sessionCookieHeader(sessionId: string): string {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(sign(sessionId))}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (config.nodeEnv === "production") parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookieHeader(): string {
  const parts = [`${COOKIE_NAME}=`, "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=0"];
  if (config.nodeEnv === "production") parts.push("Secure");
  return parts.join("; ");
}

export function readSessionIdFromCookies(cookieHeader: string | undefined): string | null {
  const cookies = parseCookies(cookieHeader);
  const raw = cookies[COOKIE_NAME];
  if (!raw) return null;
  return unsign(raw);
}

export async function createSession(actorId: string, userAgent: string | undefined): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO session (actor_id, expires_at, user_agent)
     VALUES ($1, now() + interval '7 days', $2)
     RETURNING id`,
    [actorId, userAgent ?? null],
  );
  return rows[0].id;
}

export async function resolveSession(sessionId: string): Promise<{ actorId: string } | null> {
  const { rows } = await pool.query<{ actor_id: string }>(
    `SELECT actor_id FROM session WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [sessionId],
  );
  return rows.length > 0 ? { actorId: rows[0].actor_id } : null;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await pool.query(`UPDATE session SET revoked_at = now() WHERE id = $1`, [sessionId]);
}

// Ten attempts per username per fifteen minutes, in-memory — per-process,
// resets on restart. The point is a loop can't grind through the seeded
// user list unattended, not to survive a restart (auth handoff, "Sessions").
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const attemptsByUsername = new Map<string, number[]>();

export function isRateLimited(username: string): boolean {
  const now = Date.now();
  const attempts = (attemptsByUsername.get(username) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  attemptsByUsername.set(username, attempts);
  return attempts.length >= RATE_LIMIT_MAX;
}

export function recordLoginAttempt(username: string): void {
  const attempts = attemptsByUsername.get(username) ?? [];
  attempts.push(Date.now());
  attemptsByUsername.set(username, attempts);
}
