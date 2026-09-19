import { cookies } from "next/headers";
import { verifyToken } from "./jwt";
import { scopeFor, type Scope } from "./roles";

export const SESSION_COOKIE = "studentos_token";

/**
 * Derive the caller's scope from the request. The scope is computed from the
 * signed token only — never from a header, body field or query param the
 * client controls.
 */
export async function scopeFromRequest(req: Request): Promise<Scope | null> {
  let token: string | undefined;

  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    token = auth.slice(7).trim();
  }

  if (!token) {
    const jar = await cookies();
    token = jar.get(SESSION_COOKIE)?.value;
  }

  if (!token) return null;

  try {
    return scopeFor(await verifyToken(token));
  } catch {
    return null;
  }
}

export function unauthorized(message = "not authenticated") {
  return Response.json({ error: message }, { status: 401 });
}

export function forbidden(message = "outside your access scope") {
  return Response.json({ error: message }, { status: 403 });
}
