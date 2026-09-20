import type pg from "pg";
import { normalizeSurface } from "../../services/normalize.js";
import { cip, hobbies } from "./data.js";
import { Rng, stableUuid } from "../rng.js";

// Concepts for everything outside computer science: CIP instructional programs
// (real titles and definitions) and hobbies (sports, music genres, art
// movements). New concepts are added to the same `concept` table the CSO subset
// lives in; a label that already exists (as a concept or an alias) is reused,
// never duplicated.

export interface ExpConcept {
  id: string;
  label: string;
  definition: string;
  depth: number;
  kind: "family" | "series" | "program" | "hobby";
  family?: string;
  series?: string;
  hobby?: "sport" | "music" | "art" | "activity";
  altLabels: string[];
  existing: boolean; // already in the database (reused, not inserted)
}

// Families that are covered by the CSO subset, non-academic, or vocational:
// not used as interest fields for a campus population.
const SKIP_FAMILIES = new Set(["11", "21", "28", "29", "32", "33", "34", "35", "36", "37", "46", "47", "48", "49", "53", "55", "60", "61"]);

const HEAD_SPORTS = ["Soccer", "Basketball", "Tennis", "Swimming", "Running", "Cycling", "Hiking", "Rock climbing", "Yoga", "Martial arts", "Weightlifting", "Pilates", "Volleyball", "Baseball", "Softball", "Rowing", "Table tennis", "Badminton", "Skiing", "Snowboarding", "Skateboarding", "Surfing", "Judo", "Karate", "Boxing", "Wrestling", "Fencing", "Golf", "Cricket", "Rugby", "American football", "Ice hockey", "Gymnastics", "Triathlon", "Sailing", "Kayaking", "Archery", "Lacrosse", "Squash", "Pickleball", "Bouldering", "Chess", "Dance", "Frisbee", "Ultimate", "Water polo", "Cross country", "Track and field", "Skating", "Diving", "Snowshoeing", "Mountaineering"];
const HEAD_GENRES = ["Jazz", "Hip hop", "Rock", "Pop", "Classical music", "Electronic music", "Folk", "Country music", "Blues", "Reggae", "Heavy metal", "Punk rock", "Indie rock", "R&B", "Soul", "Funk", "House", "Techno", "Ambient", "K-pop", "Opera", "Gospel", "Bluegrass", "Salsa", "Latin music"];

// Everyday hobbies that are not sports, music or art movements. A short hand-written
// list (documented in SOURCES.md), since no open dataset covers them well.
const HEAD_ACTIVITIES = ["Cooking", "Baking", "Video games", "Reading", "Board games", "Gardening", "Painting", "Drawing", "Knitting", "Creative writing", "Podcasting", "Travel", "Volunteering", "Meditation", "Fishing", "Camping", "Birdwatching", "Woodworking", "3D printing", "Filmmaking", "Poetry", "Journaling", "Thrifting", "Anime", "Cosplay", "Coffee brewing", "Karaoke", "Stargazing", "Baking sourdough", "Calligraphy", "Origami", "Pottery"];
const HEAD_ART = ["Impressionism", "Surrealism", "Cubism", "Pop Art", "Minimalism", "Modernism", "Expressionism", "Baroque", "Renaissance", "Realism", "Art Nouveau", "Art Deco", "Abstract Expressionism", "Romanticism", "Dadaism"];

const SPORT_TAIL = 110, GENRE_TAIL = 50, ART_TAIL = 20;
const BAD = /\b(or|and|hybrid|mixed|other|variants?)\b/i;

function tidy(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function pickHobbies(all: string[], head: string[], tail: number, rng: Rng): string[] {
  const usable = all.filter((s) => !BAD.test(s));
  const byLower = new Map(usable.map((s) => [s.toLowerCase(), s]));
  const chosen: string[] = [];
  // Head entries are authoritative: they are kept even if the open list lacks them.
  for (const h of head) {
    const hit = byLower.get(h.toLowerCase()) ?? h;
    if (!chosen.includes(hit)) chosen.push(hit);
  }
  const rest = rng.shuffle(usable.filter((s) => !chosen.includes(s))).slice(0, tail);
  return [...chosen, ...rest]; // head first, so rank order doubles as popularity order
}

export interface Vocab {
  concepts: ExpConcept[];
  programsByFamily: Map<string, ExpConcept[]>;
  seriesByFamily: Map<string, ExpConcept[]>;
  programsBySeries: Map<string, ExpConcept[]>;
  sports: ExpConcept[];
  music: ExpConcept[];
  art: ExpConcept[];
  activities: ExpConcept[];
  relations: { src: string; dst: string }[]; // src is the broader concept
}

export async function buildVocab(client: pg.PoolClient, rng: Rng): Promise<Vocab> {
  // What the database already knows, by normalised label or alias.
  const known = new Map<string, { id: string; label: string; definition: string }>();
  const { rows } = await client.query<{ norm: string; id: string; label: string; definition: string }>(
    `SELECT a.surface_norm AS norm, c.id, c.pref_label AS label, c.definition FROM concept_alias a JOIN concept c ON c.id = a.concept_id`,
  );
  for (const r of rows) known.set(r.norm, r);
  const conceptRows = await client.query<{ id: string; label: string; definition: string }>(`SELECT id, pref_label AS label, definition FROM concept`);
  for (const r of conceptRows.rows) known.set(normalizeSurface(r.label), r);

  const concepts: ExpConcept[] = [];
  const byNorm = new Map<string, ExpConcept>();
  const add = (c: Omit<ExpConcept, "id" | "existing" | "altLabels"> & { altLabels?: string[] }): ExpConcept | null => {
    const norm = normalizeSurface(c.label);
    if (!norm) return null;
    const dup = byNorm.get(norm);
    if (dup) return dup;
    const hit = known.get(norm);
    const concept: ExpConcept = hit
      ? { ...c, id: hit.id, label: hit.label, definition: hit.definition, existing: true, altLabels: c.altLabels ?? [] }
      : { ...c, id: stableUuid("concept", c.label), existing: false, altLabels: c.altLabels ?? [] };
    byNorm.set(norm, concept);
    concepts.push(concept);
    return concept;
  };

  const relations: Vocab["relations"] = [];
  const programsByFamily = new Map<string, ExpConcept[]>();
  const seriesByFamily = new Map<string, ExpConcept[]>();
  const programsBySeries = new Map<string, ExpConcept[]>();
  const push = <K>(m: Map<K, ExpConcept[]>, k: K, v: ExpConcept) => m.set(k, [...(m.get(k) ?? []), v]);

  const familyConcept = new Map<string, ExpConcept>();
  for (const f of cip.families) {
    if (SKIP_FAMILIES.has(f.code)) continue;
    const c = add({ label: tidy(f.title), definition: f.definition, depth: 1, kind: "family", family: f.code });
    if (c) familyConcept.set(f.code, c);
  }
  const seriesConcept = new Map<string, ExpConcept>();
  for (const s of cip.series) {
    if (SKIP_FAMILIES.has(s.family)) continue;
    const c = add({ label: tidy(s.title), definition: s.definition, depth: 2, kind: "series", family: s.family, series: s.code });
    if (c) {
      seriesConcept.set(s.code, c);
      push(seriesByFamily, s.family, c);
      const fam = familyConcept.get(s.family);
      if (fam && fam.id !== c.id) relations.push({ src: fam.id, dst: c.id });
    }
  }
  for (const p of cip.programs) {
    if (SKIP_FAMILIES.has(p.family)) continue;
    const label = tidy(p.title);
    const c = add({ label, definition: p.definition, depth: 3, kind: "program", family: p.family, series: p.series });
    if (!c) continue;
    push(programsByFamily, p.family, c);
    push(programsBySeries, p.series, c);
    const parent = seriesConcept.get(p.series);
    if (parent && parent.id !== c.id) relations.push({ src: parent.id, dst: c.id });
  }

  // Hobbies. Head entries (popular ones) come first and stay in rank order.
  const hobbyOf = (list: string[], kind: "sport" | "music" | "art" | "activity", noun: string) =>
    list.map((label) => add({ label, definition: `${label} is ${noun}.`, depth: 2, kind: "hobby", hobby: kind })).filter((c): c is ExpConcept => !!c);
  const sports = hobbyOf(pickHobbies(hobbies.sports, HEAD_SPORTS, SPORT_TAIL, rng), "sport", "a sport or recreational physical activity");
  const music = hobbyOf(pickHobbies(hobbies.genres, HEAD_GENRES, GENRE_TAIL, rng), "music", "a genre or style of music");
  const art = hobbyOf(pickHobbies(hobbies.art, HEAD_ART, ART_TAIL, rng), "art", "an art movement or style in the visual arts");

  const activities = hobbyOf(pickHobbies([], HEAD_ACTIVITIES, 0, rng), "activity", "a hobby or leisure activity");

  // Umbrella concepts so "sport" or "music genre" also lands somewhere sensible.
  for (const [label, def, kids] of [
    ["Sport", "Organised or recreational physical activity practised for competition, health or enjoyment.", sports],
    ["Music genre", "A category of music grouped by shared style, form and tradition.", music],
    ["Art movement", "A tendency or style in art with a shared philosophy, practised over a period of time.", art],
    ["Hobby", "An activity done regularly for enjoyment during leisure time.", activities],
  ] as const) {
    const umbrella = add({ label, definition: def, depth: 1, kind: "hobby" });
    if (umbrella) for (const k of kids) if (k.id !== umbrella.id) relations.push({ src: umbrella.id, dst: k.id });
  }

  return { concepts, programsByFamily, seriesByFamily, programsBySeries, sports, music, art, activities, relations };
}

/** Write the new concepts, their aliases and relations. Idempotent. */
export async function saveVocab(client: pg.PoolClient, vocab: Vocab): Promise<{ created: number; aliases: number }> {
  let created = 0;
  let aliases = 0;
  for (const c of vocab.concepts) {
    if (c.existing) continue;
    const r = await client.query(
      `INSERT INTO concept (id, pref_label, definition, depth) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
      [c.id, c.label, c.definition, c.depth],
    );
    created += r.rowCount ?? 0;
    const surfaces = new Set([c.label, ...c.altLabels]);
    for (const s of surfaces) {
      const a = await client.query(
        `INSERT INTO concept_alias (surface, surface_norm, concept_id, source, confidence) VALUES ($1, $2, $3, 'seed', 1.0) ON CONFLICT (surface_norm) DO NOTHING`,
        [s, normalizeSurface(s), c.id],
      );
      aliases += a.rowCount ?? 0;
    }
  }
  for (const r of vocab.relations) {
    await client.query(
      `INSERT INTO concept_relation (src_id, dst_id, kind, weight) VALUES ($1, $2, 'broader', 1.0) ON CONFLICT (src_id, dst_id, kind) DO NOTHING`,
      [r.src, r.dst],
    );
  }
  return { created, aliases };
}
