import { pool } from "../db.js";
import { embed, runStructuredPrompt } from "../modelRuntime.js";
import { getActivePrompt } from "../promptRegistry.js";
import type { ActorSummary, MatchKind, Reason, Stance } from "../types.js";
import { matchKindFor, stanceDecay } from "./aspirations.js";
import { normalizeSurface } from "./normalize.js";
import { getMaxIdf, normalizeRarity } from "./idf.js";
import { getActorSummary } from "./viewModels.js";

// Meaning-based search. Phase 1 (instant, no LLM) turns the query into weighted
// concepts — exact/fuzzy/token matches, nearest concepts by embedding, then the
// concept hierarchy (a search for "physics" reaches Astrophysics, Biophysics…) —
// and finds people and groups that hold them. Phase 2 (`refine`) asks the local
// model to read the query against those candidates: it splits multi-part queries
// into facets, picks the candidates that really fit, and fixes typos. The model
// can only choose from candidates, so it cannot invent topics.

export interface Topic {
  conceptId: string;
  label: string;
  weight: number; // 0..1, how strongly this topic stands for the query
  kind: "match" | "narrower" | "broader" | "related" | "similar";
  via?: string; // the topic it was reached from ("part of Physics")
}
export interface MatchedTopic {
  conceptId: string;
  label: string;
  note: string;
}
export interface SmartPerson {
  actor: ActorSummary;
  matchKind: MatchKind;
  score: number;
  reasons: Reason[];
  matched: MatchedTopic[];
  facetsMatched: number;
}
export interface SmartGroup {
  actor: ActorSummary;
  groupKind: "club" | "lab" | "department";
  score: number;
  matched: MatchedTopic[];
  members: number;
}
export interface SmartResult {
  query: string;
  correctedQuery: string | null;
  interpretation: string | null;
  refined: boolean;
  facets: { name: string; topics: Topic[] }[];
  people: SmartPerson[];
  totalPeople: number;
  groups: SmartGroup[];
  nameMatches: ActorSummary[];
  /** Parts of the query the model recognised but that nobody has (yet). */
  unmatchedFacets: string[];
  timingsMs: Record<string, number>;
}

interface Seed {
  conceptId: string;
  label: string;
  definition: string;
  strength: number;
  via: "exact" | "fuzzy" | "token" | "semantic";
}

const STOP = new Set("the and for who what how with about that this into from someone people person knows know does doing want wants looking find best good some any are can you our their who's plays play like into".split(" "));
const PER_KIND = 12;
const GROUPS = 10;
const MAX_CONCEPTS = 400;
const STRONG = 0.55; // seeds at least this strong are expanded through the hierarchy

// Edit distance, so "phisics" counts as a typo of "physics" but "photography" does not
// count as a typo of "cryptography" (they share a long ending, not a spelling).
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
const isTypoOf = (alias: string, typed: string) => editDistance(alias, typed) <= Math.max(1, Math.floor(typed.length * 0.2));

const toVector = (v: number[]) => `[${v.join(",")}]`;
const tokensOf = (q: string) => (q.toLowerCase().match(/[a-z0-9][a-z0-9+#.\-]{2,}/g) ?? []).filter((t) => !STOP.has(t));
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

async function retrieveSeeds(q: string): Promise<Seed[]> {
  const seeds = new Map<string, Seed>();
  const put = (row: { id: string; label: string; definition: string }, strength: number, via: Seed["via"]) => {
    const cur = seeds.get(row.id);
    if (!cur || strength > cur.strength) seeds.set(row.id, { conceptId: row.id, label: row.label, definition: row.definition, strength, via });
  };
  const norm = normalizeSurface(q);
  if (!norm) return [];

  // Exact alias (normalisation already folds case, punctuation and a trailing plural).
  const exact = await pool.query(
    `SELECT c.id, c.pref_label AS label, c.definition FROM concept_alias a JOIN concept c ON c.id = a.concept_id WHERE a.surface_norm = $1`,
    [norm],
  );
  for (const r of exact.rows) put(r, 1.0, "exact");

  // Fuzzy: catches typos ("phisics"). Only when nothing matched exactly, and only near-misses
  // by edit distance — trigram overlap alone matches unrelated words with a shared ending.
  let corrected: string | null = null;
  if (exact.rows.length === 0) {
    const fuzzy = await pool.query(
      `SELECT c.id, c.pref_label AS label, c.definition, a.surface_norm, similarity(a.surface_norm, $1) AS sim
       FROM concept_alias a JOIN concept c ON c.id = a.concept_id
       WHERE a.surface_norm % $1 ORDER BY sim DESC LIMIT 12`,
      [norm],
    );
    for (const r of fuzzy.rows) {
      if (!isTypoOf(r.surface_norm as string, norm)) continue;
      put(r, clamp(0.5 + 0.5 * Number(r.sim), 0.6, 0.9), "fuzzy");
      corrected ??= r.label as string;
    }
  }

  // Words. A single word that is the whole query is a real lead; in a multi-word query a
  // concept must contain every word (a lone shared word like "planning" is noise).
  const tokens = tokensOf(q);
  const words = tokens.filter((t) => t.length >= 3).slice(0, 4);
  if (tokens.length <= 1 && words.length === 1 && words[0].length >= 4) {
    const rows = await pool.query(
      `SELECT id, pref_label AS label, definition FROM concept WHERE pref_label ILIKE $1 ORDER BY length(pref_label) LIMIT 8`,
      [`%${words[0].replace(/[%_\\]/g, "\\$&")}%`],
    );
    for (const r of rows.rows) put(r, 0.65, "token");
  } else if (words.length >= 2) {
    // Several words: a concept containing all of them is a strong lead...
    const all = await pool.query(
      `SELECT id, pref_label AS label, definition FROM concept WHERE pref_label ILIKE ALL($1::text[]) ORDER BY length(pref_label) LIMIT 8`,
      [words.map((w) => `%${w.replace(/[%_\\]/g, "\\$&")}%`)],
    );
    for (const r of all.rows) put(r, 0.7, "token");
    // ...and each word is also looked up on its own (exact name = decent lead, a mere
    // substring = weak), because a multi-part query ("kubernetes and chess") is really
    // several searches; phase 2 decides which of these actually fit.
    const perWord = await pool.query(
      `SELECT c.id, c.pref_label AS label, c.definition FROM concept_alias a JOIN concept c ON c.id = a.concept_id WHERE a.surface_norm = ANY($1::text[])`,
      [words.map((w) => normalizeSurface(w))],
    );
    for (const r of perWord.rows) put(r, 0.7, "token");
    for (const w of words.filter((w) => w.length >= 5).slice(0, 3)) {
      const part = await pool.query(
        `SELECT id, pref_label AS label, definition FROM concept WHERE pref_label ILIKE $1 ORDER BY length(pref_label) LIMIT 4`,
        [`%${w.replace(/[%_\\]/g, "\\$&")}%`],
      );
      for (const r of part.rows) put(r, 0.35, "token");
    }
  }

  // Meaning: nearest concepts by embedding. Skipped quietly if the model is down.
  try {
    const perWordQueries = words.length >= 2 ? words.slice(0, 3) : [];
    const queries = [q, ...(corrected ? [corrected] : []), ...perWordQueries];
    const vectors = await embed(queries, "query");
    for (let i = 0; i < vectors.length; i++) {
      const factor = i === 0 ? 1 : corrected && i === 1 ? 0.9 : 0.85;
      const near = await pool.query(
        `SELECT id, pref_label AS label, definition, 1 - (embedding <=> $1::vector) AS sim
         FROM concept WHERE embedding IS NOT NULL ORDER BY embedding <=> $1::vector LIMIT 25`,
        [toVector(vectors[i])],
      );
      for (const r of near.rows) {
        const sim = Number(r.sim);
        if (sim >= (factor === 0.85 ? 0.68 : 0.6)) put(r, clamp((sim - 0.5) / 0.4, 0.2, 0.85) * factor, "semantic");
      }
    }
  } catch {
    // fuzzy + token seeds still work
  }
  return [...seeds.values()];
}

/** Seeds plus what the hierarchy adds: narrower topics (strong), broader and related (weak). */
async function expand(seeds: Seed[]): Promise<Map<string, Topic>> {
  const topics = new Map<string, Topic>();
  const put = (t: Topic) => {
    const cur = topics.get(t.conceptId);
    if (!cur || t.weight > cur.weight) topics.set(t.conceptId, t);
  };
  for (const s of seeds) put({ conceptId: s.conceptId, label: s.label, weight: s.strength, kind: s.via === "semantic" ? "similar" : "match" });

  const strong = seeds.filter((s) => s.strength >= STRONG);
  if (strong.length === 0) return topics;
  const ids = strong.map((s) => s.conceptId);
  const w = strong.map((s) => s.strength);
  const labelOf = new Map(strong.map((s) => [s.conceptId, s.label]));

  const down = await pool.query(
    `WITH RECURSIVE seeds(id, w) AS (SELECT * FROM unnest($1::uuid[], $2::float8[])),
     walk(id, w, depth, root) AS (
       SELECT id, w, 0, id FROM seeds
       UNION ALL
       SELECT r.dst_id, walk.w * 0.8, walk.depth + 1, walk.root
       FROM walk JOIN concept_relation r ON r.src_id = walk.id AND r.kind = 'broader' WHERE walk.depth < 3
     )
     SELECT DISTINCT ON (walk.id) walk.id, walk.w, walk.root, c.pref_label AS label
     FROM walk JOIN concept c ON c.id = walk.id WHERE walk.depth > 0 ORDER BY walk.id, walk.w DESC LIMIT $3`,
    [ids, w, MAX_CONCEPTS],
  );
  for (const r of down.rows) put({ conceptId: r.id, label: r.label, weight: Number(r.w), kind: "narrower", via: labelOf.get(r.root) });

  const around = await pool.query(
    `SELECT DISTINCT ON (x.id) x.id, x.label, x.w, x.kind, x.root FROM (
       SELECT r.src_id AS id, c.pref_label AS label, s.w * 0.35 AS w, 'broader' AS kind, s.id AS root
         FROM unnest($1::uuid[], $2::float8[]) AS s(id, w)
         JOIN concept_relation r ON r.dst_id = s.id AND r.kind = 'broader' JOIN concept c ON c.id = r.src_id
       UNION ALL
       SELECT CASE WHEN r.src_id = s.id THEN r.dst_id ELSE r.src_id END, c.pref_label, s.w * 0.4, 'related', s.id
         FROM unnest($1::uuid[], $2::float8[]) AS s(id, w)
         JOIN concept_relation r ON r.kind = 'related' AND (r.src_id = s.id OR r.dst_id = s.id)
         JOIN concept c ON c.id = CASE WHEN r.src_id = s.id THEN r.dst_id ELSE r.src_id END
     ) x ORDER BY x.id, x.w DESC LIMIT 120`,
    [ids, w],
  );
  for (const r of around.rows) put({ conceptId: r.id, label: r.label, weight: Number(r.w), kind: r.kind, via: labelOf.get(r.root) });
  return topics;
}

const NOTE: Record<Topic["kind"], (t: Topic) => string> = {
  match: () => "",
  similar: () => " — close to your search",
  narrower: (t) => (t.via ? ` — part of ${t.via}` : " — a narrower topic"),
  broader: (t) => (t.via ? ` — the wider field of ${t.via}` : " — a wider topic"),
  related: (t) => (t.via ? ` — related to ${t.via}` : " — a related topic"),
};

interface FacetSet {
  name: string;
  topics: Map<string, Topic>;
}
interface Scored {
  actorId: string;
  kind: string;
  score: number;
  best: { stance: Stance; topic: Topic }[];
  facetsMatched: number;
}

async function rank(facets: FacetSet[], meId: string): Promise<{ people: Scored[]; groups: Scored[] }> {
  const allIds = [...new Set(facets.flatMap((f) => [...f.topics.keys()]))];
  if (allIds.length === 0) return { people: [], groups: [] };
  const { rows } = await pool.query(
    `SELECT ac.actor_id, a.kind, ac.concept_id, ac.stance, ac.stance_since, ac.strength, idf.idf
     FROM actor_concept ac
     JOIN actor a ON a.id = ac.actor_id
     JOIN concept_idf idf ON idf.concept_id = ac.concept_id
     WHERE ac.concept_id = ANY($1::uuid[]) AND a.discoverable = true AND ac.visibility <> 'private' AND ac.actor_id <> $2`,
    [allIds, meId],
  );

  // Rarity still helps (a rare match says more) but must not drown breadth: a query
  // for "sports" should not be topped by whoever does the most obscure one.
  const maxIdf = await getMaxIdf();
  const rarity = (idf: number) => 0.45 + 0.55 * normalizeRarity(Number(idf), maxIdf);

  const byActor = new Map<string, typeof rows>();
  for (const r of rows) byActor.set(r.actor_id, [...(byActor.get(r.actor_id) ?? []), r]);

  const out: Scored[] = [];
  for (const [actorId, list] of byActor) {
    let total = 0;
    let matched = 0;
    const best: Scored["best"] = [];
    for (const f of facets) {
      const contributions = list
        .filter((r) => f.topics.has(r.concept_id))
        .map((r) => {
          const topic = f.topics.get(r.concept_id)!;
          const value = topic.weight * rarity(r.idf) * (r.strength ?? 1) * stanceDecay(r.stance, r.stance_since);
          return { value, stance: r.stance as Stance, topic };
        })
        .sort((a, b) => b.value - a.value);
      if (contributions.length === 0) continue;
      matched++;
      // Strongest match counts fully; further matches add with diminishing weight.
      total += contributions.reduce((sum, c, k) => sum + c.value * Math.pow(0.6, k), 0);
      best.push(...contributions.slice(0, 2).map((c) => ({ stance: c.stance, topic: c.topic, value: c.value })));
    }
    if (matched === 0) continue;
    // Someone who covers every part of a multi-part query beats a partial match.
    const score = facets.length > 1 && matched === facets.length ? total * 1.6 : total * (facets.length > 1 ? matched / facets.length : 1);
    best.sort((a, b) => (b as unknown as { value: number }).value - (a as unknown as { value: number }).value);
    out.push({ actorId, kind: list[0].kind, score, best, facetsMatched: matched });
  }
  out.sort((a, b) => b.score - a.score);
  return { people: out.filter((s) => s.kind === "person"), groups: out.filter((s) => s.kind !== "person") };
}

async function inChunks<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

async function assemble(query: string, facets: FacetSet[], meId: string, extra: Partial<SmartResult>): Promise<SmartResult> {
  const t0 = Date.now();
  const { people, groups } = await rank(facets, meId);
  const t1 = Date.now();

  // Cap each section so a broad query stays readable; totals are still reported.
  const kindCount: Record<MatchKind, number> = { mentor: 0, peer: 0, fellow_explorer: 0 };
  const shown = people.filter((p) => {
    const kind = matchKindFor(p.best[0].stance);
    return kindCount[kind]++ < PER_KIND;
  });

  const summaries = await inChunks(shown, 8, (p) => getActorSummary(p.actorId));
  const peopleOut: SmartPerson[] = [];
  shown.forEach((p, i) => {
    const actor = summaries[i];
    if (!actor) return;
    const seen = new Set<string>();
    const top = p.best.filter((b) => (seen.has(b.topic.conceptId) ? false : (seen.add(b.topic.conceptId), true))).slice(0, 3);
    peopleOut.push({
      actor,
      matchKind: matchKindFor(p.best[0].stance),
      score: p.score,
      matched: top.map((b) => ({ conceptId: b.topic.conceptId, label: b.topic.label, note: NOTE[b.topic.kind](b.topic).replace(/^ — /, "") })),
      reasons: top.map((b) => ({
        kind: "shared_concept" as const,
        summary: `${actor.displayName} is ${b.stance} in ${b.topic.label}${NOTE[b.topic.kind](b.topic)}`,
        evidence: [{ kind: "concept" as const, id: b.topic.conceptId, label: b.topic.label }],
      })),
      facetsMatched: p.facetsMatched,
    });
  });

  const groupRows = groups.slice(0, GROUPS);
  const groupSummaries = await inChunks(groupRows, 8, (g) => getActorSummary(g.actorId));
  const memberCounts = groupRows.length
    ? (await pool.query(`SELECT dst_id, count(*) AS n FROM edge WHERE relation = 'member_of' AND dst_id = ANY($1::uuid[]) GROUP BY dst_id`, [groupRows.map((g) => g.actorId)])).rows
    : [];
  const members = new Map(memberCounts.map((r) => [r.dst_id as string, Number(r.n)]));
  const groupsOut: SmartGroup[] = [];
  groupRows.forEach((g, i) => {
    const actor = groupSummaries[i];
    if (!actor) return;
    groupsOut.push({
      actor,
      groupKind: g.kind as SmartGroup["groupKind"],
      score: g.score,
      members: members.get(g.actorId) ?? 0,
      matched: g.best.slice(0, 3).map((b) => ({ conceptId: b.topic.conceptId, label: b.topic.label, note: NOTE[b.topic.kind](b.topic).replace(/^ — /, "") })),
    });
  });

  // Somebody's actual name, when the query looks like one.
  let nameMatches: ActorSummary[] = [];
  const nameTokens = query.trim();
  if (nameTokens.length >= 3 && nameTokens.length <= 40 && !/[?]/.test(nameTokens)) {
    const rows = await pool.query(
      `SELECT id FROM actor WHERE discoverable = true AND kind = 'person' AND id <> $2 AND display_name ILIKE $1 ORDER BY display_name LIMIT 5`,
      [`%${nameTokens.replace(/[%_\\]/g, "\\$&")}%`, meId],
    );
    nameMatches = (await inChunks(rows.rows, 5, (r) => getActorSummary(r.id))).filter((a): a is ActorSummary => !!a);
  }

  const outFacets = facets.map((f) => ({
    name: f.name,
    topics: [...f.topics.values()].sort((a, b) => b.weight - a.weight).slice(0, 14),
  }));
  return {
    query,
    correctedQuery: null,
    interpretation: null,
    refined: false,
    facets: outFacets,
    people: peopleOut,
    totalPeople: people.length,
    groups: groupsOut,
    nameMatches,
    unmatchedFacets: [],
    timingsMs: { rank: t1 - t0, assemble: Date.now() - t1 },
    ...extra,
  };
}

/** Phase 1: instant, no LLM. */
export async function smartSearch(meId: string, rawQuery: string): Promise<SmartResult> {
  const query = rawQuery.trim().slice(0, 200);
  if (!query) return emptyResult("");
  const t0 = Date.now();
  const seeds = await retrieveSeeds(query);
  const t1 = Date.now();
  const topics = await expand(seeds);
  const t2 = Date.now();
  const result = await assemble(query, [{ name: query, topics }], meId, {});
  result.timingsMs = { seeds: t1 - t0, expand: t2 - t1, ...result.timingsMs, total: Date.now() - t0 };
  return result;
}

const emptyResult = (query: string): SmartResult => ({
  query,
  correctedQuery: null,
  interpretation: null,
  refined: false,
  facets: [],
  people: [],
  totalPeople: 0,
  groups: [],
  nameMatches: [],
  unmatchedFacets: [],
  timingsMs: {},
});

interface Interpretation {
  interpretation: string;
  corrected_query: string | null;
  facets: { name: string; picks: { index: number; relevance: number }[] }[];
}

/** Phase 2: the local model reads the query against phase 1's candidates. Returns null if it cannot help. */
export async function refineSearch(meId: string, rawQuery: string, timeoutMs = 20000): Promise<SmartResult | null> {
  const query = rawQuery.trim().slice(0, 200);
  if (!query) return null;
  const started = Date.now();
  const seeds = await retrieveSeeds(query);
  const topics = await expand(seeds);

  // The candidates the model may choose from: the strongest topics, with definitions.
  const candidates = [...topics.values()].filter((t) => t.kind !== "broader").sort((a, b) => b.weight - a.weight).slice(0, 30);
  if (candidates.length === 0) return null;
  const defs = await pool.query(`SELECT id, definition FROM concept WHERE id = ANY($1::uuid[])`, [candidates.map((c) => c.conceptId)]);
  const def = new Map(defs.rows.map((r) => [r.id as string, (r.definition as string).replace(/\s+/g, " ").slice(0, 110)]));
  const list = candidates.map((c, i) => `[${i}] ${c.label} — ${def.get(c.conceptId) ?? ""}`).join("\n");

  const prompt = await getActivePrompt("search_interpret");
  const call = runStructuredPrompt(prompt, { query, candidate_list: list });
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  let outcome: Interpretation | null;
  try {
    outcome = await Promise.race([call.then((r) => r.parsed as unknown as Interpretation), timeout]);
  } catch (err) {
    // A malformed or failed model reply is not the user's problem: they keep phase 1.
    console.warn("search refine: model reply unusable:", err instanceof Error ? err.message : err);
    return null;
  }
  if (!outcome) return null; // the call keeps running and caches its answer for next time
  const timings = { llm: Date.now() - started };

  const facets: FacetSet[] = [];
  const unmatched: string[] = [];
  for (const f of outcome.facets ?? []) {
    const map = new Map<string, Topic>();
    for (const pick of f.picks ?? []) {
      const c = candidates[pick.index];
      if (!c || !(pick.relevance >= 0.3)) continue;
      map.set(c.conceptId, { ...c, weight: clamp(pick.relevance, 0.3, 1) * (c.kind === "narrower" ? 0.85 : 1), kind: c.kind === "similar" ? "match" : c.kind });
    }
    // A picked topic still brings its narrower topics along (picking "Physics" keeps Astrophysics).
    const picked = [...map.values()].filter((t) => t.weight >= STRONG);
    if (picked.length) {
      const down = await expand(picked.map((t) => ({ conceptId: t.conceptId, label: t.label, definition: "", strength: t.weight, via: "exact" as const })));
      for (const t of down.values()) if (!map.has(t.conceptId) && t.kind === "narrower") map.set(t.conceptId, t);
    }
    if (map.size) facets.push({ name: f.name || query, topics: map });
    else if (f.name) unmatched.push(f.name);
  }

  const corrected = outcome.corrected_query && normalizeSurface(outcome.corrected_query) !== normalizeSurface(query) ? outcome.corrected_query : null;
  if (facets.length === 0) {
    // Nothing in these candidates fit; a corrected spelling gets one more chance.
    if (corrected) {
      const again = await smartSearch(meId, corrected);
      return { ...again, query, correctedQuery: corrected, interpretation: outcome.interpretation || null, refined: true, timingsMs: { ...again.timingsMs, ...timings } };
    }
    return null;
  }
  const extra = { correctedQuery: corrected, interpretation: outcome.interpretation || null, refined: true, unmatchedFacets: unmatched };
  let result = await assemble(query, facets, meId, extra);
  // The model's tidy picks can be narrower than what people actually hold. If they find
  // too few people, bring the instant-phase topics back in at half weight (picks still rank first).
  if (result.totalPeople < 8) {
    const blended = facets.map((f) => {
      const merged = new Map(f.topics);
      for (const t of topics.values()) if (!merged.has(t.conceptId)) merged.set(t.conceptId, { ...t, weight: t.weight * 0.5 });
      return { name: f.name, topics: merged };
    });
    result = await assemble(query, blended, meId, extra);
  }
  result.timingsMs = { ...timings, ...result.timingsMs, total: Date.now() - started };
  return result;
}
