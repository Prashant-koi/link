import "dotenv/config";
import { read } from "@/lib/graph/driver";
import { scopeFor, type Role, type Subrole, type Scope } from "@/lib/auth/roles";

/** Build a real Scope for a seeded person — the same object the API derives from a JWT. */
export async function scopeOf(personId: string): Promise<Scope> {
  const rows = await read<{ name: string; role: string; subrole: string | null }>(
    `MATCH (p:Person {id: $id}) RETURN p.name AS name, p.role AS role, p.subrole AS subrole`,
    { id: personId },
  );
  if (!rows.length) throw new Error(`seed missing person ${personId} — run: npm run seed`);
  return scopeFor({
    personId,
    name: rows[0].name,
    role: rows[0].role as Role,
    subrole: (rows[0].subrole ?? null) as Subrole,
  });
}

export async function findPerson(where: string): Promise<string> {
  const rows = await read<{ id: string }>(`MATCH (p:Person) WHERE ${where} RETURN p.id AS id LIMIT 1`);
  if (!rows.length) throw new Error(`no seeded person matching: ${where}`);
  return rows[0].id;
}

export const HERO = "stu-1";
