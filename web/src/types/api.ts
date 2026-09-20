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

// Meaning-based search (GET /search/smart) — mirrors the backend's SmartResult.
export type SmartTopic = {
  conceptId: string;
  label: string;
  weight: number;
  kind: "match" | "narrower" | "broader" | "related" | "similar";
  via?: string;
};
export type SmartMatched = { conceptId: string; label: string; note: string };
export type SmartPerson = {
  actor: ActorSummary;
  matchKind: MatchKind;
  score: number;
  reasons: Reason[];
  matched: SmartMatched[];
  facetsMatched: number;
};
export type SmartGroup = {
  actor: ActorSummary;
  groupKind: "club" | "lab" | "department";
  score: number;
  matched: SmartMatched[];
  members: number;
};
export type SmartSearchResult = {
  query: string;
  correctedQuery: string | null;
  interpretation: string | null;
  refined: boolean;
  facets: { name: string; topics: SmartTopic[] }[];
  people: SmartPerson[];
  totalPeople: number;
  groups: SmartGroup[];
  nameMatches: ActorSummary[];
  unmatchedFacets: string[];
  timingsMs: Record<string, number>;
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
  conceptId: string | null;
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

// ---- Not served by any endpoint yet ---------------------------------------
// The home canvas needs these two, and neither exists behind the API today.
// They are declared here anyway so the shape is settled and the client has one
// place to return an empty result from: against the real backend both come
// back empty, and nothing fabricated ever reaches the screen. The fixture feed
// populates them. See the backend follow-up for what has to be built.
//
// Bridges need a person-to-person relation, which the `edge` table's CHECK
// list does not currently allow, plus the already-typed `Reason.kind: "path"`
// to actually be produced by the scorer.
export type BridgeSuggestion = {
  actor: ActorSummary;
  /** The suggested actor this person stands between you and. */
  targetId: string;
  /** What the three of you have in common, phrased for display. */
  via: string;
};

// Events exist as `context.kind = 'event'` rows with attendance edges, but
// `context.kind` is never selected by any read query and there is no route,
// so today they are unreachable.
export type EventSummary = {
  id: string;
  title: string;
  startsOn: string;
  venue?: string;
  topConcepts: ConceptChip[];
};

export type EventSuggestion = {
  event: EventSummary;
  score: number;
  reasons: Reason[];
};
