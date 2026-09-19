import { scopeFromRequest, unauthorized } from "@/lib/auth/session";
import { ScopeError } from "./types";
import type { Scope } from "@/lib/auth/roles";

/** Wraps a scoped handler: auth, scope derivation, ScopeError -> 403. */
export function scoped<T>(fn: (ctx: Scope, body: Record<string, unknown>, req: Request) => Promise<T>) {
  return async (req: Request): Promise<Response> => {
    const ctx = await scopeFromRequest(req);
    if (!ctx) return unauthorized();

    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        body = {};
      }
    } else {
      body = Object.fromEntries(new URL(req.url).searchParams.entries());
    }

    try {
      return Response.json(await fn(ctx, body, req));
    } catch (e) {
      if (e instanceof ScopeError) return Response.json({ error: e.message }, { status: 403 });
      console.error("[graph]", e);
      return Response.json({ error: (e as Error).message }, { status: 500 });
    }
  };
}
