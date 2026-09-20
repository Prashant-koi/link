import type pg from "pg";
import { deterministicUuid, type Rng } from "../rng.js";
import type { ExpConcept, Vocab } from "./vocab.js";

// New departments, labs, clubs and the contexts (courses, events, papers,
// projects, teams) that tie people together. Everything is named from the open
// vocabularies; nothing here is a real campus entity.

export interface Dept {
  id: string;
  name: string;
  pool: ExpConcept[]; // the interests people in this department draw from
  courseIds: string[];
  paperIds: string[];
  eventIds: string[];
}
export interface Lab { id: string; name: string; dept: number; concepts: ExpConcept[] }
export interface Club { id: string; name: string; concepts: ExpConcept[] }
export interface Ctx { id: string; kind: "course" | "event" | "paper" | "project" | "team"; title: string; startsOn: string; endsOn: string | null }

const NS = "expand";

interface DeptSpec { name: string; families: string[]; series?: RegExp }

// Which CIP families (optionally narrowed by series title) make up each department.
const SPECS: DeptSpec[] = [
  { name: "Agricultural Sciences", families: ["01"] },
  { name: "Environmental Science and Conservation", families: ["03"] },
  { name: "Architecture and Urban Planning", families: ["04"] },
  { name: "Cultural and Area Studies", families: ["05"] },
  { name: "Communication and Journalism", families: ["09", "10"] },
  { name: "Education", families: ["13"] },
  { name: "Civil and Environmental Engineering", families: ["14"], series: /civil|environmental|structural|geological|surveying/i },
  { name: "Chemical and Biomedical Engineering", families: ["14"], series: /chemical|biomedical|bioengineering|materials|polymer/i },
  { name: "Aerospace and Industrial Engineering", families: ["14", "15"], series: /aerospace|industrial|systems|nuclear|ocean|marine|manufactur|engineering technolog/i },
  { name: "Languages and Linguistics", families: ["16"] },
  { name: "Human Sciences and Nutrition", families: ["19", "12"] },
  { name: "Law and Legal Studies", families: ["22"] },
  { name: "English and Literature", families: ["23", "24"] },
  { name: "Library and Information Studies", families: ["25", "30"] },
  { name: "Biology", families: ["26"] },
  { name: "Public Health and Health Professions", families: ["51"] },
  { name: "Psychology", families: ["42"] },
  { name: "Economics", families: ["45"], series: /econom/i },
  { name: "Sociology and Anthropology", families: ["45"], series: /sociolog|anthropolog|geograph|political|criminolog|international|urban/i },
  { name: "History", families: ["54", "05"], series: /histor|classic|archaeolog|area|ethnic|american|european|asian|african/i },
  { name: "Philosophy and Religious Studies", families: ["38", "39"] },
  { name: "Music, Theatre and Dance", families: ["50"], series: /music|drama|theat|dance|film|cinema/i },
  { name: "Visual and Media Arts", families: ["50"], series: /art|design|photograph|craft|studio|fine/i },
  { name: "Business and Management", families: ["52"] },
  { name: "Kinesiology and Recreation", families: ["31", "51"], series: /kinesi|exercise|athletic|physical|recreation|sport|leisure|rehab|parks|fitness/i },
  { name: "Public Administration and Policy", families: ["44", "43"] },
  { name: "Chemistry", families: ["40", "26", "14"], series: /chemi|biochem|molecular|pharm|toxic|material|polymer/i },
  { name: "Earth and Atmospheric Sciences", families: ["40", "41"], series: /geolog|earth|atmospher|ocean|astro|planet|hydro|science technolog/i },
  { name: "Economics and Political Science", families: ["45"], series: /econom|politic|international|public|government/i },
];

function poolFor(spec: DeptSpec, vocab: Vocab): ExpConcept[] {
  const out: ExpConcept[] = [];
  const seen = new Set<string>();
  // Broad topics (CIP series, e.g. "Economics", "Civil Engineering") first, then
  // the specific programs under them.
  for (const fam of spec.families) {
    for (const s of vocab.seriesByFamily.get(fam) ?? []) {
      if (spec.series && !spec.series.test(s.label)) continue;
      if (!seen.has(s.id)) {
        seen.add(s.id);
        out.push(s);
      }
    }
  }
  for (const fam of spec.families) {
    for (const p of vocab.programsByFamily.get(fam) ?? []) {
      if (spec.series && !spec.series.test(seriesTitle(p, vocab))) continue;
      if (!seen.has(p.id)) {
        seen.add(p.id);
        out.push(p);
      }
    }
  }
  return out;
}

const seriesTitleCache = new Map<string, string>();
function seriesTitle(p: ExpConcept, vocab: Vocab): string {
  if (!p.series) return "";
  if (!seriesTitleCache.size) {
    for (const list of vocab.seriesByFamily.values()) for (const s of list) if (s.series) seriesTitleCache.set(s.series, s.label);
  }
  return seriesTitleCache.get(p.series) ?? "";
}

function dateWithin(rng: Rng, days: number): Date {
  return new Date(Date.now() - rng.int(days * 24 * 3600 * 1000));
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function buildOrgs(
  client: pg.PoolClient,
  rng: Rng,
  seed: number,
  vocab: Vocab,
): Promise<{ depts: Dept[]; labs: Lab[]; clubs: Club[]; contexts: Ctx[]; general: Ctx[] }> {
  const existingNames = new Set((await client.query<{ n: string }>(`SELECT lower(display_name) AS n FROM actor WHERE kind <> 'person'`)).rows.map((r) => r.n));
  const depts: Dept[] = [];
  const labs: Lab[] = [];
  const contexts: Ctx[] = [];
  let ctxIndex = 0;
  const ctx = (kind: Ctx["kind"], title: string, startsOn: string, endsOn: string | null): Ctx => {
    const c: Ctx = { id: deterministicUuid(seed, `${NS}:context:${kind}`, ctxIndex++), kind, title, startsOn, endsOn };
    contexts.push(c);
    return c;
  };

  SPECS.forEach((spec, i) => {
    const pool = poolFor(spec, vocab);
    if (pool.length < 8) return; // too thin to be a discipline of its own
    const name = existingNames.has(spec.name.toLowerCase()) ? `${spec.name} (Studies)` : spec.name;
    const dept: Dept = { id: deterministicUuid(seed, `${NS}:org:department`, i), name, pool: [...rng.shuffle(pool.filter((c) => c.kind === "series")), ...rng.shuffle(pool.filter((c) => c.kind !== "series"))], courseIds: [], paperIds: [], eventIds: [] };
    depts.push(dept);

    // Courses named after the department's own programs.
    for (const p of dept.pool.slice(0, 3)) {
      const start = dateWithin(rng, 3 * 365);
      const c = ctx("course", `Introduction to ${p.label}`, iso(start), rng.bool(0.2) ? null : iso(new Date(start.getTime() + 90 * 86400000)));
      dept.courseIds.push(c.id);
    }
    const ev = dateWithin(rng, 2 * 365);
    dept.eventIds.push(ctx("event", `${name} Colloquium ${ev.getFullYear()}`, iso(ev), iso(ev)).id);
    const paper = dept.pool[rng.int(dept.pool.length)];
    dept.paperIds.push(ctx("paper", `Notes on ${paper.label}`, iso(dateWithin(rng, 3 * 365)), null).id);
    if (rng.bool(0.6)) ctx("project", `${dept.pool[rng.int(dept.pool.length)].label} Capstone Project`, iso(dateWithin(rng, 365)), null);

    // Two labs per department, from the department's biggest program series.
    const bySeries = new Map<string, ExpConcept[]>();
    for (const p of dept.pool) if (p.series) bySeries.set(p.series, [...(bySeries.get(p.series) ?? []), p]);
    const topSeries = [...bySeries.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 2);
    for (const [series, progs] of topSeries) {
      const title = seriesTitle(progs[0], vocab) || name;
      const labName = title.length <= 40 ? `${title} Lab` : `${title.slice(0, 40).replace(/[\s,;]+\S*$/, "")} Research Group`;
      if (existingNames.has(labName.toLowerCase()) || labs.some((l) => l.name === labName)) continue;
      labs.push({
        id: deterministicUuid(seed, `${NS}:org:lab`, labs.length),
        name: labName,
        dept: depts.length - 1,
        concepts: rng.sample(progs, Math.min(progs.length, rng.intRange(3, 5))),
      });
      void series;
    }
  });

  // ---- Clubs ----------------------------------------------------------------
  const clubs: Club[] = [];
  const clubName = (base: string, suffix: string) => (/club|society|association|team|ensemble|crew|company|network|circle|union/i.test(base) ? base : `${base} ${suffix}`);
  const addClub = (name: string, concepts: ExpConcept[]) => {
    if (!concepts.length || existingNames.has(name.toLowerCase()) || clubs.some((c) => c.name === name)) return;
    clubs.push({ id: deterministicUuid(seed, `${NS}:org:club`, clubs.length), name, concepts });
  };
  const nice: Record<string, string> = { "Rock climbing": "Climbing Club", Climbing: "Climbing Club", Bouldering: "Bouldering Club", Frisbee: "Ultimate Frisbee Club", Ultimate: "Ultimate Frisbee Club", "Track and field": "Track & Field Club", "Hip hop": "Hip Hop Collective", "Heavy metal": "Metal Society", "Punk rock": "Punk Society", "K-pop": "K-Pop Dance Crew", Classical: "Classical Music Society", Jazz: "Jazz Ensemble", "American football": "Football Club", "Ice hockey": "Ice Hockey Club" };
  for (const s of vocab.sports.slice(0, 40)) addClub(nice[s.label] ?? clubName(s.label, "Club"), [s]);
  for (const m of vocab.music.slice(0, 14)) addClub(nice[m.label] ?? clubName(m.label, "Society"), [m]);
  for (const a of vocab.art.slice(0, 8)) addClub(`${a.label} Art Circle`, [a]);
  for (const h of vocab.activities.slice(0, 22)) addClub(clubName(h.label, "Club"), [h]);

  // General-interest clubs, each tied to whatever concepts match in the vocabulary.
  const all = vocab.concepts;
  const find = (re: RegExp, limit = 3) => all.filter((c) => c.kind !== "family" && re.test(c.label)).slice(0, limit);
  const GENERAL: [string, RegExp][] = [
    ["Chess Club", /^chess$/i], ["Debate Society", /rhetoric|speech|debate/i], ["Model United Nations", /international relations|diplomacy|political science/i],
    ["Film Society", /film|cinema/i], ["Photography Club", /photograph/i], ["Culinary Club", /culinary|food|nutrition|cooking/i],
    ["Sustainability Network", /sustainab|environmental|conservation|ecolog/i], ["Entrepreneurship Club", /entrepreneur|business admin|marketing/i],
    ["Investing Club", /financ|invest|econom/i], ["Theatre Company", /drama|theat|acting|directing/i], ["Creative Writing Circle", /creative writing|poetry|fiction/i],
    ["Astronomy Club", /astronom|astrophys|planetar/i], ["Language Exchange", /language|linguistic/i], ["Pre-Med Society", /medic|biolog|anatom|physiolog/i],
    ["Pre-Law Society", /^law|legal|jurisprud/i], ["Psychology Club", /psycholog|cognit|behavio/i], ["History Society", /^history|histor/i],
    ["Philosophy Circle", /philosoph|ethic|logic/i], ["Urban Design Collective", /urban|architect|planning|landscape/i], ["Public Health Alliance", /public health|epidemiolog|nutrition/i],
    ["Education Outreach", /education|teaching|pedagog|tutor/i], ["Journalism & Media Club", /journalis|broadcast|media|communicat/i], ["Fashion & Textiles Club", /fashion|textile|apparel|costume/i],
    ["Environmental Action Group", /climate|environmental|forestry|wildlife|marine/i], ["Robotics Makers", /robot|mechatron|automation/i], ["Volunteer Corps", /social work|community|human services|nonprofit/i],
    ["Anthropology Reading Group", /anthropolog|ethnograph|archaeolog/i], ["Geology Field Club", /geolog|earth|mineral|paleont/i], ["Nutrition & Wellness Club", /nutrition|dietetic|wellness|fitness/i],
    ["Gardening Society", /horticult|agricultur|plant|garden/i], ["Pottery & Ceramics Studio", /ceramic|pottery|craft|sculpt/i], ["Data & Society Club", /statistic|data|sociolog/i],
    ["Mental Health Peer Network", /counsel|psychotherap|mental|clinical/i], ["Board Game Society", /^game|board|strategy/i], ["Dance Ensemble", /^dance|choreograph|ballet/i],
  ];
  for (const [name, re] of GENERAL) addClub(name, find(re));

  // General (non-department) events and team contexts.
  const general: Ctx[] = [];
  for (const title of ["Career Fair", "Club Fair", "Maker Faire", "Open Mic Night", "Intramural Finals", "Art Walk", "Science Fair", "Language Café", "Volunteer Day", "Startup Weekend", "Film Festival", "Wellness Week"]) {
    const d = dateWithin(rng, 2 * 365);
    general.push(ctx("event", `${title} ${d.getFullYear()}`, iso(d), iso(d)));
  }
  for (const c of clubs.filter((_, i) => i % 5 === 0)) {
    const d = dateWithin(rng, 365);
    ctx("team", `${c.name} Competition Team`, iso(d), null);
  }

  return { depts, labs, clubs, contexts, general };
}

export async function saveOrgs(client: pg.PoolClient, o: Awaited<ReturnType<typeof buildOrgs>>): Promise<void> {
  const actor = async (id: string, kind: string, name: string) =>
    client.query(`INSERT INTO actor (id, kind, display_name, discoverable, has_account) VALUES ($1, $2, $3, true, false) ON CONFLICT (id) DO NOTHING`, [id, kind, name]);
  for (const d of o.depts) await actor(d.id, "department", d.name);
  for (const l of o.labs) await actor(l.id, "lab", l.name);
  for (const c of o.clubs) await actor(c.id, "club", c.name);
  for (const c of o.contexts) {
    await client.query(`INSERT INTO context (id, kind, title, starts_on, ends_on) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`, [c.id, c.kind, c.title, c.startsOn, c.endsOn]);
  }
}
