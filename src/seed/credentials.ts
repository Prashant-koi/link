import type pg from "pg";
import { hashPassword } from "../auth/credentials.js";
import { deriveCredential, resolveUsernameCollisions } from "../auth/derive.js";
import type { Rng } from "./rng.js";
import type { Person } from "./generate.js";

export interface SeededCredential {
  actorId: string;
  displayName: string;
  username: string;
  password: string; // plaintext, for the seeder's own report only — never stored
}

function randomFallbackPassword(rng: Rng): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 12; i++) out += chars[rng.int(chars.length)];
  return out;
}

// Stage 4b, between generating actors and writing actor_concept: pure
// string manipulation and hashing, no model calls anywhere (auth handoff,
// "Seeder integration" — reproducibility across seed runs depends on that).
export async function generateCredentials(
  client: pg.PoolClient,
  rng: Rng,
  people: Person[],
): Promise<SeededCredential[]> {
  let fallbackIndex = 0;
  const derivedList = people.map((p) => {
    const candidatePassword = randomFallbackPassword(rng); // consumed from the rng either way, so the sequence stays deterministic regardless of who ends up needing it
    const result = deriveCredential(p.displayName, fallbackIndex, candidatePassword);
    if (result.fallback) fallbackIndex++;
    return { person: p, cred: result };
  });

  const finalUsernames = resolveUsernameCollisions(derivedList.map((d) => d.cred.username));

  const results: SeededCredential[] = [];
  for (let i = 0; i < derivedList.length; i++) {
    const { person, cred } = derivedList[i];
    const username = finalUsernames[i];
    const passwordHash = await hashPassword(cred.password);

    await client.query(
      `INSERT INTO credential (actor_id, username, password_hash, derived)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (actor_id) DO UPDATE SET username = $2, password_hash = $3`,
      [person.id, username, passwordHash],
    );

    results.push({ actorId: person.id, displayName: person.displayName, username, password: cred.password });
  }

  return results;
}
