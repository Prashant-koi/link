// A demo dataset shaped exactly like the real API responses.
//
// The full stack needs Postgres and Ollama, which is too much to stand up just
// to look at the home page. This feeds the same client surface so every page —
// auth included — works untouched.
//
// The vocabulary is the repo's own: names from src/seed/names.ts, the eight
// branches from db/seed-data/cso-subset.json, and Nina Farouk as the viewer,
// matching the checked-in snapshot. Generated rather than hand-written, from a
// fixed seed, so it is identical on every load.

import type {
  ActorSummary,
  AspirationMatch,
  AskSummary,
  BridgeSuggestion,
  ConceptChip,
  ConnectionSuggestion,
  CourseOffering,
  EventSuggestion,
  ImportSummary,
  InterestRow,
  Reason,
} from "../types/api";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = [
  "Alex", "Priya", "Jordan", "Wei", "Sam", "Noor", "Diego", "Ines", "Marcus", "Yuki",
  "Fatima", "Liam", "Chen", "Aisha", "Omar", "Nadia", "Kwame", "Elena", "Hiro", "Zoe",
  "Rafael", "Mei", "Tariq", "Sofia", "Aditya", "Grace", "Kofi", "Lena", "Theo", "Amara",
];

const LAST = [
  "Shah", "Reyes", "Webb", "Novak", "Okafor", "Kim", "Silva", "Haddad", "Chen", "Ibrahim",
  "Larsen", "Petrov", "Diaz", "Nakamura", "Osei", "Fischer", "Rahman", "Costa", "Volkov",
  "Nguyen", "Adeyemi", "Moreau", "Sato", "Kowalski", "Amari", "Blackwood", "Singh", "Torres",
];

/** The eight CSO branches the seeder uses. The first five carry concept ids —
 *  mirroring the backend's cap of five on topConcepts. */
const BRANCHES = [
  { id: "c-ml", label: "machine learning", rarity: 0.42 },
  { id: "c-cv", label: "computer vision", rarity: 0.61 },
  { id: "c-rob", label: "robotics", rarity: 0.74 },
  { id: "c-crypt", label: "cryptography", rarity: 0.81 },
  { id: "c-hci", label: "human computer interaction", rarity: 0.55 },
  { id: "c-net", label: "computer networks", rarity: 0.48 },
  { id: "c-se", label: "software engineering", rarity: 0.31 },
  { id: "c-db", label: "database systems", rarity: 0.58 },
];

const VIEWER_ID = "d39fa1b9-e8dd-9268-4d0d-f83e28c1177c";
const CS = { id: "unit-cs", name: "Computer Science" };

function chip(index: number, shownAs?: string): ConceptChip {
  const b = BRANCHES[index];
  return { conceptId: b.id, label: b.label, shownAs: shownAs ?? b.label, rarity: b.rarity };
}

export const viewer: ActorSummary = {
  id: VIEWER_ID,
  kind: "person",
  personKind: "student",
  displayName: "Nina Farouk",
  homeUnit: CS,
  topConcepts: [chip(0), chip(1), chip(2), chip(3), chip(4)],
  contact: { hasAccount: true, methods: [{ kind: "email", value: "nina.farouk@example.edu" }] },
};

function sharedConceptReason(index: number): Reason {
  const b = BRANCHES[index];
  return {
    kind: "shared_concept",
    summary: `Both interested in ${b.label}`,
    evidence: [{ kind: "concept", id: b.id, label: b.label }],
  };
}

function sharedContextReason(title: string, from: string): Reason {
  return {
    kind: "shared_context",
    summary: `Both connected to ${title}`,
    evidence: [{ kind: "context", id: `ctx-${title}`, label: title, period: { from } }],
  };
}

/**
 * Membership patterns: which of the viewer's five interests each person
 * shares.
 *
 * Shaped to look like real interest data rather than a combinatorial stress
 * test. People who share two interests tend to share *related* ones — vision
 * with machine learning, robotics with vision — so overlaps cluster instead
 * of covering all ten possible pairs uniformly. Singletons dominate, as they
 * do in the seeded graph.
 *
 * `0b00101` and the triple are kept deliberately: they are combinations five
 * circles on a ring cannot draw, and the canvas marking them as approximate
 * rather than misplacing them is worth showing.
 */
const PATTERNS = [
  0b00001, 0b00010, 0b00100, 0b01000, 0b10000,
  0b00011, 0b00110, 0b01100, 0b11000, 0b10001,
  0b00001, 0b00100, 0b10000, 0b00101, 0b00000,
];

const CONTEXTS = [
  "Advanced Computer Science",
  "Topics in Cognitive Science",
  "Hack Night 2024",
  "Research Showcase 2025",
  "Foundations of Statistics",
];

function buildPeople(): ConnectionSuggestion[] {
  const rand = mulberry32(42);
  const out: ConnectionSuggestion[] = [];

  for (let i = 0; i < 26; i++) {
    const first = FIRST[Math.floor(rand() * FIRST.length)];
    const last = LAST[Math.floor(rand() * LAST.length)];
    const membership = PATTERNS[i % PATTERNS.length];
    const matched: number[] = [];
    for (let b = 0; b < 5; b++) if (membership & (1 << b)) matched.push(b);

    const reasons: Reason[] = matched.slice(0, 2).map(sharedConceptReason);
    if (reasons.length < 3 && rand() > 0.45) {
      reasons.push(sharedContextReason(CONTEXTS[Math.floor(rand() * CONTEXTS.length)], "2024-09-01"));
    }
    // Someone with no shared interest still shows up through a context, which
    // is exactly the case that has to sit outside every field.
    if (reasons.length === 0) {
      reasons.push(sharedContextReason(CONTEXTS[i % CONTEXTS.length], "2023-01-15"));
    }

    const extra = Math.floor(rand() * 3) + 5; // a concept of their own, beyond the viewer's five
    const topConcepts = matched.map((m) => chip(m));
    if (topConcepts.length < 4) topConcepts.push(chip(extra % BRANCHES.length));

    out.push({
      actor: {
        id: `p-${i}`,
        kind: "person",
        personKind: rand() > 0.78 ? "faculty" : "student",
        displayName: `${first} ${last}`,
        homeUnit: CS,
        topConcepts,
        contact:
          rand() > 0.5
            ? { hasAccount: true, methods: [] }
            : { hasAccount: false, methods: [{ kind: "email", value: `${first.toLowerCase()}@example.edu` }] },
      },
      // Unbounded and viewer-relative, like the real thing.
      score: 12.4 - i * 0.38 + rand() * 0.4,
      reasons: reasons.slice(0, 3),
    });
  }
  return out;
}

function buildSocieties(): ConnectionSuggestion[] {
  const defs: { id: string; name: string; kind: ActorSummary["kind"]; fields: number[] }[] = [
    { id: "s-ai", name: "AI Club", kind: "club", fields: [0, 1] },
    { id: "s-rob", name: "Robotics Club", kind: "club", fields: [2] },
    { id: "s-sec", name: "Cybersecurity Club", kind: "club", fields: [3] },
    { id: "s-ds", name: "Data Science Club", kind: "club", fields: [0, 4] },
    { id: "s-hcc", name: "Human-Centered Computing Lab", kind: "lab", fields: [4, 1] },
    { id: "s-crypt", name: "Applied Cryptography Lab", kind: "lab", fields: [3, 0] },
    { id: "s-auto", name: "Autonomous Systems Lab", kind: "lab", fields: [2, 1] },
  ];

  return defs.map((d, i) => ({
    actor: {
      id: d.id,
      kind: d.kind,
      displayName: d.name,
      homeUnit: CS,
      topConcepts: d.fields.map((f) => chip(f)),
      contact: { hasAccount: false, methods: [{ kind: "website", value: `https://example.edu/${d.id}` }] },
    },
    score: 9.1 - i * 0.6,
    reasons: d.fields.map(sharedConceptReason),
  }));
}

function buildEvents(): EventSuggestion[] {
  const defs: { id: string; title: string; on: string; venue: string; fields: number[] }[] = [
    { id: "e-1", title: "Hack Night 2026", on: "2026-10-02", venue: "Huxley 308", fields: [0, 4] },
    { id: "e-2", title: "Robotics Demo Day", on: "2026-10-09", venue: "Main Quad", fields: [2, 1] },
    { id: "e-3", title: "Applied Cryptography Symposium", on: "2026-10-15", venue: "Blackett LT1", fields: [3] },
    { id: "e-4", title: "Vision & Perception Workshop", on: "2026-10-21", venue: "Huxley 145", fields: [1, 2] },
    { id: "e-5", title: "Research Showcase 2026", on: "2026-11-04", venue: "Great Hall", fields: [0, 1, 4] },
    { id: "e-6", title: "Interfaces Reading Group", on: "2026-11-11", venue: "Library 4F", fields: [4] },
    { id: "e-7", title: "Open Source Sprint", on: "2026-11-18", venue: "Huxley 219", fields: [0] },
  ];

  return defs.map((d, i) => ({
    event: {
      id: d.id,
      title: d.title,
      startsOn: d.on,
      venue: d.venue,
      topConcepts: d.fields.map((f) => chip(f)),
    },
    score: 8.6 - i * 0.5,
    reasons: d.fields.slice(0, 2).map(sharedConceptReason),
  }));
}

const people = buildPeople();
const societies = buildSocieties();
const events = buildEvents();

/**
 * Bridges: someone who stands between you and a person you don't yet know.
 * Fixture-only — there is no person-to-person relation in the schema for this
 * to be derived from, so against the real API this list is empty rather than
 * invented. See the backend follow-up.
 */
const bridges: BridgeSuggestion[] = [
  {
    actor: {
      id: "b-1",
      kind: "person",
      personKind: "student",
      displayName: "Priya Shah",
      homeUnit: CS,
      topConcepts: [chip(0), chip(2)],
      contact: { hasAccount: true, methods: [] },
    },
    targetId: people[3]?.actor.id ?? "p-3",
    via: "you both know Priya from Robotics Club",
  },
  {
    actor: {
      id: "b-2",
      kind: "person",
      personKind: "faculty",
      displayName: "Dr Omar Haddad",
      homeUnit: CS,
      topConcepts: [chip(3)],
      contact: { hasAccount: true, methods: [] },
    },
    targetId: people[7]?.actor.id ?? "p-7",
    via: "both supervised by Dr Haddad",
  },
  {
    actor: {
      id: "b-3",
      kind: "person",
      personKind: "student",
      displayName: "Wei Nakamura",
      homeUnit: CS,
      topConcepts: [chip(1), chip(4)],
      contact: { hasAccount: true, methods: [] },
    },
    targetId: people[12]?.actor.id ?? "p-12",
    via: "you were both at Research Showcase 2025",
  },
];

const interests: InterestRow[] = BRANCHES.map((b, i) => ({
  id: `i-${i}`,
  rawText: b.label,
  conceptLabel: b.label,
  stance: i === 5 ? "aspiring" : i === 6 ? "exploring" : "established",
  visibility: "institution",
  resolved: i < 5,
}));

const courses: CourseOffering[] = [
  {
    code: "CS310",
    title: "Advanced Computer Vision",
    term: "Autumn 2026",
    description: "Geometry, learning-based perception, and 3D reconstruction.",
    startsOn: "2026-10-05",
    endsOn: "2026-12-11",
  },
  {
    code: "CS421",
    title: "Applied Cryptography",
    term: "Autumn 2026",
    description: "Protocols, proofs, and the gap between them and deployed systems.",
    startsOn: "2026-10-05",
    endsOn: "2026-12-11",
  },
];

const imports: ImportSummary[] = [
  {
    id: "im-1",
    kind: "github",
    origin: "nina-farouk",
    status: "done",
    createdAt: "2026-09-12T10:04:00Z",
    completedAt: "2026-09-12T10:05:12Z",
    conceptsFound: 14,
    conceptsResolved: 11,
    contextsLinked: 6,
  },
  {
    id: "im-2",
    kind: "resume",
    status: "done",
    createdAt: "2026-09-12T10:09:00Z",
    completedAt: "2026-09-12T10:10:40Z",
    conceptsFound: 9,
    conceptsResolved: 8,
    contextsLinked: 3,
  },
];

/** Everything the fixture client serves, in one place. */
export const fixtures = {
  viewer,
  people,
  societies,
  events,
  bridges,
  interests,
  courses,
  imports,
  asks: [] as AskSummary[],
  aspirations: (q: string): AspirationMatch[] => {
    const match = BRANCHES.findIndex((b) => b.label.includes(q.trim().toLowerCase()));
    if (match < 0) return [];
    const kinds = ["mentor", "peer", "fellow_explorer"] as const;
    return people.slice(0, 6).map((p, i) => ({
      actor: p.actor,
      matchKind: kinds[i % 3],
      concept: chip(match),
      theirStance: (["established", "exploring", "aspiring"] as const)[i % 3],
      score: 6 - i * 0.4,
      reasons: p.reasons,
    }));
  },
};
