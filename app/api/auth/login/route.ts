import { cookies } from "next/headers";
import { read } from "@/lib/graph/driver";
import { signToken } from "@/lib/auth/jwt";
import { scopeFor, type Role, type Subrole } from "@/lib/auth/roles";
import { SESSION_COOKIE } from "@/lib/auth/session";

export async function POST(req: Request) {
  const { personId } = (await req.json()) as { personId?: string };
  if (!personId) return Response.json({ error: "personId required" }, { status: 400 });

  const rows = await read<{ id: string; name: string; role: string; subrole: string | null }>(
    `MATCH (p:Person {id: $personId}) RETURN p.id AS id, p.name AS name, p.role AS role, p.subrole AS subrole`,
    { personId },
  );
  if (rows.length === 0) return Response.json({ error: "no such person" }, { status: 404 });

  const p = {
    personId: rows[0].id,
    name: rows[0].name,
    role: rows[0].role as Role,
    subrole: (rows[0].subrole ?? null) as Subrole,
  };
  const token = await signToken(p);

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  return Response.json({ token, scope: scopeFor(p) });
}
