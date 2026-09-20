// Copied verbatim from the backend's src/types.ts (backend services handoff
// §9, plus frontend handoff §5/§7 additions). Do not restate or reshape —
// if a page needs a field that isn't here, that's a backend gap, not
// something to work around here.

export type ActorSummary = {
  id: string;
  kind: "person" | "club" | "lab" | "department" | "company";
  personKind?: "student" | "faculty" | "staff" | "alum";
  displayName: string;
  homeUnit?: { id: string; name: string };
  topConcepts: ConceptChip[]; // already idf-ordered, already capped
  contact: ContactBlock;
};

export type ContactMethodKind = "email" | "phone" | "website" | "office";

export type ContactBlock = {
  hasAccount: boolean;
  methods: { kind: ContactMethodKind; value: string; label?: string }[];
};

export type ConceptChip = {
  conceptId: string;
  label: string; // canonical pref_label
  shownAs: string; // the actor's own raw_text, if it differed
  rarity: number; // normalised idf, 0..1 — lets the UI emphasise without maths
};

export type ConnectionSuggestion = {
  actor: ActorSummary;
  score: number;
  reasons: Reason[]; // ordered by contribution, capped at 3
};

export type Reason = {
  kind: "shared_concept" | "shared_context" | "path";
  summary: string; // always present, template-generated
  prose?: string; // model-written, present only if cached
  evidence: EvidenceRef[];
};

export type EvidenceRef = {
  kind: "concept" | "context" | "edge";
  id: string;
  label: string;
  period?: { from: string; to?: string }; // null `to` means current
};

export type IntroState = "none" | "suggested" | "requested" | "accepted" | "declined";

export type AskSummary = {
  id: string;
  author: ActorSummary;
  text: string; // as written
  requires: ConceptChip[]; // resolved from the text
  openUntil?: string;
};

export type Cursor<T> = { items: T[]; nextCursor?: string };

export type Stance = "established" | "exploring" | "aspiring";
export type MatchKind = "mentor" | "peer" | "fellow_explorer";

export type AspirationMatch = {
  actor: ActorSummary;
  matchKind: MatchKind;
  concept: ConceptChip;
  theirStance: Stance;
  score: number;
  reasons: Reason[];
};

// Backend gap surfaced by Settings (§6): not part of the original §9 spec.
export type Visibility = "public" | "institution" | "private";

export type InterestRow = {
  id: string;
  rawText: string;
  conceptLabel: string | null;
  stance: Stance;
  visibility: Visibility;
  resolved: boolean;
};

// Live onboarding imports — mirrors the backend's src/types.ts additions.
export type ImportKind = "resume" | "linkedin" | "github" | "courses";
export type ImportStatus = "pending" | "running" | "done" | "failed";

export type ImportSummary = {
  id: string;
  kind: ImportKind;
  origin?: string;
  status: ImportStatus;
  detail?: string;
  createdAt: string;
  completedAt?: string;
  conceptsFound: number;
  conceptsResolved: number;
  contextsLinked: number;
};

export type CourseOffering = {
  code: string;
  title: string;
  term: string;
  description: string;
  startsOn: string;
  endsOn: string;
};
