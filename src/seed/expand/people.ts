import type pg from "pg";
import { hashPassword } from "../../auth/credentials.js";
import { deriveCredential, resolveUsernameCollisions } from "../../auth/derive.js";
import { enqueue } from "../../queue.js";
import { normalizeSurface } from "../../services/normalize.js";
import { ZIPF_S } from "../generate.js";
import { deterministicUuid, type Rng } from "../rng.js";
import { mangleSurface } from "../variants.js";
import { names } from "./data.js";
import type { Club, Ctx, Dept, Lab } from "./orgs.js";
import type { ExpConcept, Vocab } from "./vocab.js";

const NS = "expand";
const MS_PER_DAY = 24 * 3600 * 1000;

// Countries that get extra weight when sampling a name, so the population
// resembles a large international campus rather than a flat 63-way split.
const HEAVY = new Set(["US", "GB", "IN", "CN", "MX", "BR", "DE", "FR", "ES", "IT", "KR", "JP", "RU", "TR", "PH", "CA", "AU"]);

interface Interest { concept: ExpConcept; stance: "established" | "exploring" | "aspiring"; strength: number; since: string | null; raw: string; variant: string }
interface PlannedPerson {
  index: number;
  id: string;
  name: string;
  kind: "student" | "faculty" | "staff" | "alum";
  deptIndex: number;
  discoverable: boolean;
  hasAccount: boolean;
  contacts: { kind: "email" | "website" | "office"; value: string }[];
  interests: Interest[];
  edges: { dst: string; dstType: "actor" | "context"; relation: string; from: string | null; to: string | null }[];
}

export interface PeopleOptions { count: number; seed: number; csoBroad: ExpConcept[] }

function zipf<T>(rng: Rng, pool: T[], exclude: Set<T>, s = ZIPF_S): T | null {
  if (!pool.length) return null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const item = pool[rng.zipfIndex(pool.length, s)];
    if (!exclude.has(item)) return item;
  }
  return null;
}

function stanceSince(rng: Rng): string {
  const days = rng.bool(0.15) ? rng.intRange(370, 540) : rng.intRange(0, Math.round(365 * 1.5));
  return new Date(Date.now() - days * MS_PER_DAY).toISOString().slice(0, 10);
}

export async function buildPeople(
  client: pg.PoolClient,
  rng: Rng,
  vocab: Vocab,
  depts: Dept[],
  labs: Lab[],
  clubs: Club[],
  contexts: Map<string, Ctx>,
  general: Ctx[],
  opts: PeopleOptions,
): Promise<PlannedPerson[]> {
  const ids = Array.from({ length: opts.count }, (_, i) => deterministicUuid(opts.seed, `${NS}:person`, i));
  // Names already taken by anyone who is NOT one of these people, so a re-run
  // reproduces the same names for the same indices.
  const taken = new Set(
    (await client.query<{ n: string }>(`SELECT lower(display_name) AS n FROM actor WHERE kind = 'person' AND id <> ALL($1::uuid[])`, [ids])).rows.map((r) => r.n),
  );

  const countries = Object.keys(names.forenames).filter((c) => names.surnames[c]?.length);
  const weighted = countries.flatMap((c) => (HEAVY.has(c) ? [c, c, c] : [c]));
  const clubsByConcept = new Map<string, Club[]>();
  for (const club of clubs) for (const c of club.concepts) clubsByConcept.set(c.id, [...(clubsByConcept.get(c.id) ?? []), club]);
  const labsByDept = new Map<number, Lab[]>();
  for (const lab of labs) labsByDept.set(lab.dept, [...(labsByDept.get(lab.dept) ?? []), lab]);

  const out: PlannedPerson[] = [];
  for (let i = 0; i < opts.count; i++) {
    // ---- identity ----
    let name = "";
    for (let attempt = 0; attempt < 30 && !name; attempt++) {
      const country = rng.pick(weighted);
      const gender = rng.bool(0.5) ? "M" : "F";
      const firsts = names.forenames[country].filter((f) => f[1] === gender);
      const first = (firsts.length ? rng.pick(firsts) : rng.pick(names.forenames[country]))[0];
      const last = rng.pick(names.surnames[country]);
      const candidate = `${first} ${last}`;
      if (!taken.has(candidate.toLowerCase())) name = candidate;
    }
    if (!name) name = `Person ${i}`;
    taken.add(name.toLowerCase());

    const roll = rng.float();
    const kind: PlannedPerson["kind"] = roll < 0.7 ? "student" : roll < 0.83 ? "faculty" : roll < 0.88 ? "staff" : "alum";
    const deptIndex = i % depts.length;
    const dept = depts[deptIndex];
    const discoverable = !rng.bool(0.05);
    const hasAccount = rng.bool(0.55);

    const contacts: PlannedPerson["contacts"] = [];
    if (!hasAccount && rng.bool(35 / 45)) {
      const options = kind === "faculty" ? (["website", "office"] as const) : (["email", "website"] as const);
      for (const k of rng.sample(options, rng.intRange(1, 2))) {
        const slug = name.toLowerCase().replace(/[^a-z]+/g, k === "email" ? "." : "");
        contacts.push({
          kind: k,
          value: k === "email" ? `${slug}@example.edu` : k === "website" ? `https://${slug}.example.edu` : `Building ${rng.intRange(1, 9)}, Room ${rng.intRange(100, 399)}`,
        });
      }
    }

    // ---- interests ----
    const interests: Interest[] = [];
    const used = new Set<ExpConcept>();
    const other = () => depts[(deptIndex + 1 + rng.int(depts.length - 1)) % depts.length];
    const add = (concept: ExpConcept | null, stance: Interest["stance"]) => {
      if (!concept) return;
      used.add(concept);
      const { text, kind: variant } = mangleSurface(rng, { label: concept.label, acronym: null }, concept.altLabels);
      const strength = stance === "established" ? 0.7 + rng.float() * 0.3 : stance === "exploring" ? 0.4 + rng.float() * 0.3 : 0.1 + rng.float() * 0.3;
      interests.push({ concept, stance, strength, since: stance === "established" ? null : stanceSince(rng), raw: text, variant });
    };
    for (let slot = 0, n = rng.intRange(4, 8); slot < n; slot++) {
      const r = rng.float();
      const stance = r < 0.7 ? "established" : r < 0.9 ? "exploring" : "aspiring";
      // Established interests come mostly from the person's own field; the rest
      // roam, which is what creates the cross-discipline connections.
      const own = stance === "established" ? rng.bool(0.8) : rng.bool(0.4);
      add(zipf(rng, own ? dept.pool : other().pool, used), stance);
    }
    for (let h = 0, n = rng.intRange(1, 3); h < n; h++) {
      const kindRoll = rng.float();
      const list = kindRoll < 0.45 ? vocab.sports : kindRoll < 0.65 ? vocab.music : kindRoll < 0.75 ? vocab.art : vocab.activities;
      add(zipf(rng, list, used, 1.15), rng.bool(0.75) ? "established" : "exploring"); // steeper: most people pick the popular ones
    }
    if (opts.csoBroad.length && rng.bool(0.12)) {
      for (let c = 0, n = rng.intRange(1, 2); c < n; c++) add(zipf(rng, opts.csoBroad, used), rng.bool(0.6) ? "exploring" : "established");
    }

    // ---- edges ----
    const edges: PlannedPerson["edges"] = [];
    const joined = new Set<string>();
    const join = (club: Club | undefined) => {
      if (club && !joined.has(club.id) && joined.size < 3) {
        joined.add(club.id);
        edges.push({ dst: club.id, dstType: "actor", relation: "member_of", from: null, to: null });
      }
    };
    for (const it of interests) {
      const cs = clubsByConcept.get(it.concept.id);
      if (cs && rng.bool(0.55)) join(rng.pick(cs));
    }
    const dl = labsByDept.get(deptIndex) ?? [];
    if (dl.length && rng.bool(kind === "faculty" ? 0.9 : kind === "student" ? 0.25 : 0.1)) {
      edges.push({ dst: rng.pick(dl).id, dstType: "actor", relation: "member_of", from: null, to: null });
    }
    const ctxEdge = (id: string, relation: string) => {
      const c = contexts.get(id)!;
      edges.push({ dst: id, dstType: "context", relation, from: c.startsOn, to: c.endsOn });
    };
    if (kind === "faculty") {
      if (dept.courseIds.length) ctxEdge(rng.pick(dept.courseIds), "taught");
    } else if (kind === "student") {
      for (const id of rng.sample(dept.courseIds, Math.min(dept.courseIds.length, rng.intRange(2, 3)))) ctxEdge(id, "enrolled_in");
    }
    if (rng.bool(0.5) && dept.eventIds.length) ctxEdge(rng.pick(dept.eventIds), "attended");
    if (rng.bool(0.5) && general.length) ctxEdge(rng.pick(general).id, "attended");
    if (dept.paperIds.length && rng.bool(kind === "faculty" ? 0.9 : 0.1)) ctxEdge(rng.pick(dept.paperIds), "authored");

    out.push({ index: i, id: ids[i], name, kind, deptIndex, discoverable, hasAccount, contacts, interests, edges });
  }
  return out;
}

export async function savePeople(
  client: pg.PoolClient,
  seed: number,
  people: PlannedPerson[],
  depts: Dept[],
): Promise<{ inserted: number; interests: number; queued: number; logins: { username: string; password: string }[] }> {
  const existing = new Set((await client.query<{ id: string }>(`SELECT id FROM actor WHERE id = ANY($1::uuid[])`, [people.map((p) => p.id)])).rows.map((r) => r.id));
  const fresh = people.filter((p) => !existing.has(p.id));

  // Aliases in memory: one lookup per interest instead of a query.
  const aliasOf = new Map((await client.query<{ n: string; id: string }>(`SELECT surface_norm AS n, concept_id AS id FROM concept_alias`)).rows.map((r) => [r.n, r.id]));
  const usernames = (await client.query<{ username: string }>(`SELECT username FROM credential`)).rows.map((r) => r.username);
  const derived = fresh.map((p, i) => deriveCredential(p.name, i, `pw${seed}x${i}zq`));
  const finalUsernames = resolveUsernameCollisions([...usernames, ...derived.map((d) => d.username)]).slice(usernames.length);

  let interests = 0;
  let queued = 0;
  let seen = 0; // interests processed, to alternate which noisy variants go through the pipeline
  const logins: { username: string; password: string }[] = [];

  for (let i = 0; i < fresh.length; i++) {
    const p = fresh[i];
    await client.query(
      `INSERT INTO actor (id, kind, person_kind, display_name, home_unit, discoverable, has_account) VALUES ($1, 'person', $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [p.id, p.kind, p.name, depts[p.deptIndex].id, p.discoverable, p.hasAccount],
    );
    for (let m = 0; m < p.contacts.length; m++) {
      await client.query(`INSERT INTO actor_contact_method (actor_id, kind, value, sort_order) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [p.id, p.contacts[m].kind, p.contacts[m].value, m]);
    }

    for (let slot = 0; slot < p.interests.length; slot++) {
      const it = p.interests[slot];
      const norm = normalizeSurface(it.raw);
      const known = aliasOf.get(norm);
      // Hard cases go through the real model pipeline; the rest are resolved
      // here (and their surface remembered as an alias), so most seeding is
      // instant and offline.
      const needsPipeline =
        it.variant === "typo" ||
        (it.variant === "qualified" && seen % 3 === 0) ||
        (it.variant === "mangle" && seen % 10 === 0) ||
        (known !== undefined && known !== it.concept.id);
      seen++;
      const id = deterministicUuid(seed, `${NS}:actor_concept:${p.index}`, slot);
      if (needsPipeline) {
        await client.query(
          `INSERT INTO actor_concept (id, actor_id, raw_text, strength, source, stance, stance_since) VALUES ($1, $2, $3, $4, 'user', $5, $6) ON CONFLICT (id) DO NOTHING`,
          [id, p.id, it.raw, it.strength, it.stance, it.since],
        );
        await enqueue(client, "resolve_concept", { target: "actor_concept", targetId: id, rawText: it.raw });
        queued++;
      } else {
        if (known === undefined && norm) {
          await client.query(`INSERT INTO concept_alias (surface, surface_norm, concept_id, source, confidence) VALUES ($1, $2, $3, 'seed', 1.0) ON CONFLICT (surface_norm) DO NOTHING`, [it.raw, norm, it.concept.id]);
          aliasOf.set(norm, it.concept.id);
        }
        await client.query(
          `INSERT INTO actor_concept (id, actor_id, concept_id, raw_text, strength, source, stance, stance_since, resolved_at)
           VALUES ($1, $2, $3, $4, $5, 'user', $6, $7, now()) ON CONFLICT (id) DO NOTHING`,
          [id, p.id, it.concept.id, it.raw, it.strength, it.stance, it.since],
        );
      }
      interests++;
    }

    for (const e of p.edges) {
      await client.query(
        `INSERT INTO edge (src_id, src_type, dst_id, dst_type, relation, weight, valid_from, valid_to) VALUES ($1, 'actor', $2, $3, $4, 1.0, $5, $6)`,
        [p.id, e.dst, e.dstType, e.relation, e.from, e.to],
      );
    }

    const cred = derived[i];
    await client.query(
      `INSERT INTO credential (actor_id, username, password_hash, derived) VALUES ($1, $2, $3, true) ON CONFLICT (actor_id) DO NOTHING`,
      [p.id, finalUsernames[i], await hashPassword(cred.password)],
    );
    logins.push({ username: finalUsernames[i], password: cred.password });
  }
  return { inserted: fresh.length, interests, queued, logins };
}

export type { PlannedPerson };
