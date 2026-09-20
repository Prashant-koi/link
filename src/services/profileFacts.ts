import { createHash } from "node:crypto";
import { pool } from "../db.js";

// The only things the AI is allowed to say about a person. Built from what they
// have made visible (a private interest or edge is never included) and turned into
// a compact text block plus a hash, so cached summaries go stale automatically when
// the profile changes.

export interface ProfileFacts {
  actorId: string;
  name: string;
  firstName: string;
  text: string;
  hash: string;
  thin: boolean; // little to say
  parts: {
    role: string;
    experience: string[];
    exploring: string[];
    wants: string[];
    taking: string[];
    took: string[];
    teaching: string[];
    papers: string[];
    projects: string[];
    groups: string[];
    events: string[];
    imports: string[];
  };
}

const list = (a: string[]) => a.join("; ");

export async function getProfileFacts(actorId: string): Promise<ProfileFacts | null> {
  const a = await pool.query(
    `SELECT a.id, a.display_name, a.person_kind, h.display_name AS dept
     FROM actor a LEFT JOIN actor h ON h.id = a.home_unit
     WHERE a.id = $1 AND a.kind = 'person' AND a.discoverable = true`,
    [actorId],
  );
  if (!a.rows[0]) return null; // unknown or not discoverable: indistinguishable to the caller
  const person = a.rows[0];

  const interests = await pool.query(
    `SELECT c.pref_label AS label, ac.stance, ac.source, ac.stance_since
     FROM actor_concept ac JOIN concept c ON c.id = ac.concept_id
     WHERE ac.actor_id = $1 AND ac.visibility <> 'private'
     ORDER BY ac.strength DESC NULLS LAST, c.pref_label`,
    [actorId],
  );
  const seen = new Set<string>();
  const byStance: Record<string, string[]> = { established: [], exploring: [], aspiring: [] };
  const fromImport = new Set<string>();
  for (const r of interests.rows) {
    if (seen.has(r.label)) continue;
    seen.add(r.label);
    byStance[r.stance]?.push(r.label);
    if (r.source === "linkedin" || r.source === "github") fromImport.add(r.source);
  }

  const edges = await pool.query(
    `SELECT e.relation, e.valid_to, ctx.kind AS ctx_kind, ctx.title, org.display_name AS org_name, org.kind AS org_kind
     FROM edge e
     LEFT JOIN context ctx ON e.dst_type = 'context' AND ctx.id = e.dst_id
     LEFT JOIN actor org ON e.dst_type = 'actor' AND org.id = e.dst_id
     WHERE e.src_id = $1 AND e.visibility <> 'private'`,
    [actorId],
  );
  const now = Date.now();
  const ongoing = (to: string | null) => !to || new Date(to).getTime() > now;
  const taking: string[] = [], took: string[] = [], teaching: string[] = [], papers: string[] = [], projects: string[] = [], groups: string[] = [], events: string[] = [];
  for (const e of edges.rows) {
    if (e.ctx_kind && e.title) {
      if (e.relation === "enrolled_in") (ongoing(e.valid_to) ? taking : took).push(e.title);
      else if (e.relation === "taught") teaching.push(e.title);
      else if (e.relation === "authored") papers.push(e.title);
      else if (e.relation === "attended") events.push(e.title);
      else if (e.ctx_kind === "project" || e.ctx_kind === "team") projects.push(e.title);
    } else if (e.org_name && e.relation === "member_of") {
      groups.push(`${e.org_name} (${e.org_kind})`);
    }
  }

  const parts: ProfileFacts["parts"] = {
    role: [person.person_kind, person.dept ? `in ${person.dept}` : null].filter(Boolean).join(" "),
    experience: byStance.established.slice(0, 10),
    exploring: byStance.exploring.slice(0, 6),
    wants: byStance.aspiring.slice(0, 5),
    taking: taking.slice(0, 4),
    took: took.slice(0, 4),
    teaching: teaching.slice(0, 4),
    papers: papers.slice(0, 4),
    projects: projects.slice(0, 4),
    groups: groups.slice(0, 5),
    events: events.slice(0, 4),
    imports: [...fromImport].map((s) => (s === "github" ? "GitHub" : "LinkedIn")),
  };

  const lines = [`Name: ${person.display_name}`, `Role: ${parts.role || "member"}`];
  const add = (label: string, items: string[]) => items.length && lines.push(`${label}: ${list(items)}`);
  add("Has experience in", parts.experience);
  add("Currently exploring", parts.exploring);
  add("Wants to learn", parts.wants);
  add("Courses taking now", parts.taking);
  add("Courses taken before", parts.took);
  add("Courses teaching", parts.teaching);
  add("Papers authored", parts.papers);
  add("Projects and teams", parts.projects);
  add("Member of", parts.groups);
  add("Events attended", parts.events);
  add("Interests imported from", parts.imports);
  const text = lines.join("\n");
  const known = parts.experience.length + parts.exploring.length + parts.wants.length + parts.papers.length + parts.projects.length;
  return {
    actorId,
    name: person.display_name,
    firstName: String(person.display_name).split(/\s+/)[0],
    text,
    hash: createHash("sha1").update(text).digest("hex"),
    thin: known < 3,
    parts,
  };
}

// ---- grounding guard --------------------------------------------------------
// Cheap, deliberately strict: an AI description is dropped (or replaced by a plain
// template) if it contains a number or a capitalised word that is not in the facts,
// or a claim word the facts do not support. A blunt filter is right here — a false
// negative costs a missing blurb, a false positive would state something untrue.

// Non-capturing groups and a global regex: a match array with an unmatched capture group contains `undefined`.
const CLAIMS = /\b(?:published|publications?|ph\.?d|professor|award(?:ed|s)?|won|winner|years? of|founded|founder|employed|works? at|worked at|interned|internship|startup|expert|leading|renowned|prestigious)\b/gi;
const SAFE = new Set(["ai", "ml", "the", "and", "in", "on", "of", "a", "an", "they", "their", "he", "she"]);

export function isGrounded(text: string, facts: string): boolean {
  const haystack = facts.toLowerCase();
  // Gender is not known: gendered pronouns would be a guess.
  if (/\b(he|she|his|hers?|him|himself|herself)\b/i.test(text)) return false;
  for (const num of text.match(/\d+/g) ?? []) if (!haystack.includes(num)) return false;
  for (const claim of text.match(CLAIMS) ?? []) if (!haystack.includes(String(claim).toLowerCase())) return false;
  // Capitalised words that are not the first word of a sentence must appear in the facts.
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const s of sentences) {
    const words = s.split(/\s+/).slice(1);
    for (const raw of words) {
      const w = raw.replace(/[^A-Za-z\-/']/g, "");
      if (w.length >= 3 && /^[A-Z]/.test(w) && !SAFE.has(w.toLowerCase()) && !haystack.includes(w.toLowerCase())) return false;
    }
  }
  return true;
}

/** Plain, always-true description built straight from the facts (used when the model can't be trusted or reached). */
export function templateSummary(f: ProfileFacts): string {
  const p = f.parts;
  const bits: string[] = [];
  bits.push(`${f.name} is ${/^[aeiou]/i.test(p.role) ? "an" : "a"} ${p.role || "member of the community"}.`);
  if (p.experience.length) bits.push(`They have experience in ${p.experience.slice(0, 4).join(", ")}.`);
  if (p.exploring.length) bits.push(`They are currently exploring ${p.exploring.slice(0, 3).join(", ")}.`);
  if (p.wants.length) bits.push(`They want to learn ${p.wants.slice(0, 3).join(", ")}.`);
  if (p.papers.length) bits.push(`Papers: ${p.papers.slice(0, 2).join("; ")}.`);
  if (p.groups.length) bits.push(`They are part of ${p.groups.slice(0, 3).join(", ")}.`);
  if (bits.length === 1) bits.push("Not much else is listed on their profile yet.");
  return bits.join(" ");
}
