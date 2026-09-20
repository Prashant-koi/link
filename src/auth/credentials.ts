import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { config } from "../config.js";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, config.auth.bcryptCost);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// Precomputed once, compared against on an unknown username so a login
// attempt costs the same hash-compare whether the username exists or not —
// auth handoff, "Sessions": "removes the timing difference between 'no
// such user' and 'wrong password'".
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing-parity", config.auth.bcryptCost);
export async function compareAgainstDummyHash(plain: string): Promise<void> {
  await bcrypt.compare(plain, DUMMY_HASH);
}

export interface CredentialRow {
  actorId: string;
  username: string;
  passwordHash: string;
  derived: boolean;
}

export async function findCredentialByUsername(username: string): Promise<CredentialRow | null> {
  const { rows } = await pool.query(
    `SELECT actor_id, username, password_hash, derived FROM credential WHERE username = $1`,
    [username.toLowerCase()],
  );
  if (rows.length === 0) return null;
  return { actorId: rows[0].actor_id, username: rows[0].username, passwordHash: rows[0].password_hash, derived: rows[0].derived };
}

export async function touchLastLogin(actorId: string): Promise<void> {
  await pool.query(`UPDATE credential SET last_login_at = now() WHERE actor_id = $1`, [actorId]);
}
