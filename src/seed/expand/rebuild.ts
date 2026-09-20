import type pg from "pg";
import { deterministicUuid } from "../rng.js";

// Removes exactly what this expansion created, so it can be regenerated after
// the recipe changes. Nothing is guessed: every row it makes has an id derived
// from a namespaced deterministic hash, so the candidate ids are recomputed and
// only those are deleted. Base-seed rows (different namespaces) and the concept
// vocabulary are left alone.
/** Ids the expansion may have used for orgs (department, lab, club). */
export function expansionOrgIds(seed: number): string[] {
  const range = (ns: string, n: number) => Array.from({ length: n }, (_, i) => deterministicUuid(seed, ns, i));
  return [...range("expand:org:department", 200), ...range("expand:org:lab", 800), ...range("expand:org:club", 800)];
}

export async function rebuildCleanup(client: pg.PoolClient, seed: number): Promise<Record<string, number>> {
  const range = (ns: string, n: number) => Array.from({ length: n }, (_, i) => deterministicUuid(seed, ns, i));
  const people = range("expand:person", 6000);
  const orgs = [...range("expand:org:department", 200), ...range("expand:org:lab", 800), ...range("expand:org:club", 800)];
  const contexts = ["course", "event", "paper", "project", "team"].flatMap((k) => range(`expand:context:${k}`, 4000));
  const actors = [...people, ...orgs];
  const count: Record<string, number> = {};
  const run = async (label: string, sql: string, params: unknown[]) => {
    count[label] = (await client.query(sql, params)).rowCount ?? 0;
  };
  await run("jobs", `DELETE FROM job WHERE kind = 'resolve_concept' AND (payload->>'targetId')::uuid IN (SELECT id FROM actor_concept WHERE actor_id = ANY($1::uuid[]))`, [actors]);
  await run("actor_concepts", `DELETE FROM actor_concept WHERE actor_id = ANY($1::uuid[])`, [actors]);
  await run("edges", `DELETE FROM edge WHERE src_id = ANY($1::uuid[]) OR dst_id = ANY($1::uuid[]) OR dst_id = ANY($2::uuid[])`, [actors, contexts]);
  await run("contact_methods", `DELETE FROM actor_contact_method WHERE actor_id = ANY($1::uuid[])`, [actors]);
  await run("sessions", `DELETE FROM session WHERE actor_id = ANY($1::uuid[])`, [actors]);
  await run("credentials", `DELETE FROM credential WHERE actor_id = ANY($1::uuid[])`, [actors]);
  await run("actors", `DELETE FROM actor WHERE id = ANY($1::uuid[])`, [actors]);
  await run("contexts", `DELETE FROM context WHERE id = ANY($1::uuid[])`, [contexts]);
  return count;
}
