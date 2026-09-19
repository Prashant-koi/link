// UI-facing view models — see backend services handoff, section 9. The UI
// never receives the graph; it receives these, with visibility already
// applied, explanations already attached, and ranking already done.

export type ActorSummary = {
  id: string;
  kind: "person" | "club" | "lab" | "department" | "company";
  personKind?: "student" | "faculty" | "staff" | "alum";
  displayName: string;
  homeUnit?: { id: string; name: string };
  topConcepts: ConceptChip[]; // already idf-ordered, already capped
  contact: ContactBlock; // frontend handoff §5 — not in the original §9 spec
};

// Frontend handoff, section 5: the person-detail contact block. Visibility
// is applied server-side — an empty `methods` array on a discoverable actor
// means no contact route was published, not that one was hidden.
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

// Frontend handoff, section 7: aspiration search. Stance is orthogonal to
// actor_concept.strength — a strong aspiration and a weak expertise are
// both coherent.
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
