// Turns API responses into everything the canvas needs, so no component does
// derivation inline.

import type {
  ActorSummary,
  BridgeSuggestion,
  ConceptChip,
  ConnectionSuggestion,
  EventSuggestion,
  EventSummary,
  InterestRow,
  Reason,
} from "../types/api";

export type Audience = "people" | "societies" | "events";

export const MAX_LISTED_INTERESTS = 8;
export const MAX_FIELDS = 5;

export interface RankedInterest {
  /** Stable key: the concept id where there is one, else the interest row id. */
  key: string;
  conceptId: string | null;
  label: string;
  shownAs: string;
  rarity: number;
  /**
   * Only interests carrying a concept id can be matched against people, and
   * so only those can become a field on the canvas. The API caps
   * `topConcepts` at five and returns the full interest list without concept
   * ids, which is where this limitation comes from — see the backend
   * follow-up in the plan.
   */
  mappable: boolean;
  /**
   * Which of the five field hues this interest wears, 0-based. Assigned from
   * the interest's position in the API's own ordering and never from the
   * viewer's ranking, so re-ranking moves a field around the ring without
   * changing its colour. Colour follows the thing, not its current position.
   */
  colorIndex: number;
}

export interface CanvasNode {
  id: string;
  /** Display name, or the event title. */
  label: string;
  /** One line under the name — a shared interest, or an event's date. */
  sublabel?: string;
  /** Present for people and societies; absent for events. */
  actor?: ActorSummary;
  event?: EventSummary;
  reasons: Reason[];
  rank: number;
  /** Bitmask over the active fields. */
  membership: number;
  /** Labels of the interests this node actually shares, for the aria text. */
  matchedLabels: string[];
  /**
   * True when the only concept evidence is a one-hop "related interests"
   * reason. Those carry the *other* person's concept id, never yours, so they
   * cannot be attributed to one of your fields — such a node sits outside the
   * fields rather than being guessed into one.
   */
  relatedOnly: boolean;
  radius: number;
}

export interface BridgeNode {
  id: string;
  actor: ActorSummary;
  /** The suggestion this person bridges you to. */
  targetId: string;
  /** What the three of you have in common, already phrased for display. */
  via: string;
}

export interface HomeModel {
  interests: RankedInterest[];
  fields: RankedInterest[];
  people: CanvasNode[];
  societies: CanvasNode[];
  events: CanvasNode[];
  bridges: BridgeNode[];
}

const SOCIETY_KINDS = new Set(["club", "lab", "department", "company"]);

/**
 * Merge the two interest sources. `topConcepts` carries concept ids but is
 * capped at five; the interests list is complete but has no ids. Taking ids
 * from the first and the tail from the second is what gets eight rows on
 * screen while keeping the five that can actually be matched honest.
 */
export function buildInterests(actor: ActorSummary | null, rows: InterestRow[]): RankedInterest[] {
  const out: RankedInterest[] = [];
  const seen = new Set<string>();

  for (const chip of actor?.topConcepts ?? []) {
    out.push({
      key: chip.conceptId,
      conceptId: chip.conceptId,
      label: chip.label,
      shownAs: chip.shownAs || chip.label,
      rarity: chip.rarity,
      mappable: true,
      colorIndex: out.length % MAX_FIELDS,
    });
    seen.add(normalise(chip.label));
    seen.add(normalise(chip.shownAs));
  }

  for (const row of rows) {
    if (out.length >= MAX_LISTED_INTERESTS) break;
    const label = row.conceptLabel ?? row.rawText;
    if (seen.has(normalise(label))) continue;
    seen.add(normalise(label));
    out.push({
      key: `row:${row.id}`,
      conceptId: null,
      label,
      shownAs: row.rawText,
      rarity: 0,
      mappable: false,
      colorIndex: out.length % MAX_FIELDS,
    });
  }

  return out.slice(0, MAX_LISTED_INTERESTS);
}

function normalise(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Which of the viewer's interests a suggestion actually shares.
 *
 * The test is simply whether a piece of concept evidence names one of *your*
 * concept ids. That is exactly right for a direct shared-concept reason, whose
 * evidence carries your id, and it correctly rejects a one-hop "related
 * interests" reason, whose evidence carries theirs.
 */
function membershipOf(
  suggestion: ConnectionSuggestion,
  fields: RankedInterest[],
): { membership: number; matchedLabels: string[]; relatedOnly: boolean } {
  const mine = new Map<string, number>();
  fields.forEach((f, i) => {
    if (f.conceptId) mine.set(f.conceptId, i);
  });

  let membership = 0;
  const matchedLabels: string[] = [];
  let sawConceptEvidence = false;

  const note = (conceptId: string) => {
    const index = mine.get(conceptId);
    if (index === undefined) return;
    if (membership & (1 << index)) return;
    membership |= 1 << index;
    matchedLabels.push(fields[index].label);
  };

  for (const reason of suggestion.reasons) {
    for (const ev of reason.evidence) {
      if (ev.kind !== "concept") continue;
      sawConceptEvidence = true;
      note(ev.id);
    }
  }

  // Reasons are capped at three, so someone can share a field without it
  // appearing in their top reasons. Their own concept chips fill that gap.
  for (const chip of suggestion.actor.topConcepts) note(chip.conceptId);

  return {
    membership,
    matchedLabels,
    relatedOnly: membership === 0 && sawConceptEvidence,
  };
}

/** Radius from rank, never from score — score is unbounded and one outlier
 *  would flatten everyone else. */
function radiusForRank(rank: number, total: number, scale: number): number {
  const t = total <= 1 ? 0 : rank / (total - 1);
  return (20 - 6 * t) * scale;
}

export function buildNodes(
  suggestions: ConnectionSuggestion[],
  fields: RankedInterest[],
  scale: number,
): CanvasNode[] {
  const ordered = [...suggestions].sort((a, b) => b.score - a.score || (a.actor.id < b.actor.id ? -1 : 1));
  return ordered.map((s, i) => {
    const { membership, matchedLabels, relatedOnly } = membershipOf(s, fields);
    return {
      id: s.actor.id,
      label: s.actor.displayName,
      sublabel: s.actor.topConcepts[0]?.shownAs,
      actor: s.actor,
      reasons: s.reasons,
      rank: i,
      membership,
      matchedLabels,
      relatedOnly,
      radius: radiusForRank(i, ordered.length, scale),
    };
  });
}

/** Events use the same membership machinery, keyed off the event's concepts. */
export function buildEventNodes(
  events: EventSuggestion[],
  fields: RankedInterest[],
  scale: number,
): CanvasNode[] {
  const mine = new Map<string, number>();
  fields.forEach((f, i) => {
    if (f.conceptId) mine.set(f.conceptId, i);
  });

  const ordered = [...events].sort((a, b) => b.score - a.score || (a.event.id < b.event.id ? -1 : 1));
  return ordered.map((e, i) => {
    let membership = 0;
    const matchedLabels: string[] = [];
    for (const chip of e.event.topConcepts) {
      const index = mine.get(chip.conceptId);
      if (index === undefined || membership & (1 << index)) continue;
      membership |= 1 << index;
      matchedLabels.push(fields[index].label);
    }
    return {
      id: e.event.id,
      label: e.event.title,
      sublabel: formatEventDate(e.event.startsOn),
      event: e.event,
      reasons: e.reasons,
      rank: i,
      membership,
      matchedLabels,
      relatedOnly: false,
      radius: radiusForRank(i, ordered.length, scale),
    };
  });
}

function formatEventDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Bridges only make sense against nodes that are actually on screen, so a
 * bridge whose target is not in the current population is dropped rather than
 * floated somewhere meaningless.
 */
export function buildBridges(suggestions: BridgeSuggestion[], visible: CanvasNode[]): BridgeNode[] {
  const onScreen = new Set(visible.map((n) => n.id));
  return suggestions
    .filter((b) => onScreen.has(b.targetId))
    .slice(0, 4)
    .map((b) => ({ id: b.actor.id, actor: b.actor, targetId: b.targetId, via: b.via }));
}

export function splitByKind(suggestions: ConnectionSuggestion[]): {
  people: ConnectionSuggestion[];
  societies: ConnectionSuggestion[];
} {
  const people: ConnectionSuggestion[] = [];
  const societies: ConnectionSuggestion[] = [];
  for (const s of suggestions) {
    if (s.actor.kind === "person") people.push(s);
    else if (SOCIETY_KINDS.has(s.actor.kind)) societies.push(s);
  }
  return { people, societies };
}

export function conceptChipOf(interest: RankedInterest): ConceptChip {
  return {
    conceptId: interest.conceptId ?? interest.key,
    label: interest.label,
    shownAs: interest.shownAs,
    rarity: interest.rarity,
  };
}

// ---- Ranking order ---------------------------------------------------------
// There is no ordering column on an interest anywhere in the schema and no
// endpoint to set one, so the viewer's ranking lives in the browser. Keyed by
// actor id so two accounts on one machine do not collide.

const ORDER_KEY = "link.interestOrder";

export function loadOrder(actorId: string): string[] {
  try {
    const raw = window.localStorage.getItem(`${ORDER_KEY}:${actorId}`);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    // Private browsing, cleared storage, or a corrupt value — the default
    // order is always a valid answer.
    return [];
  }
}

export function saveOrder(actorId: string, keys: string[]): void {
  try {
    window.localStorage.setItem(`${ORDER_KEY}:${actorId}`, JSON.stringify(keys));
  } catch {
    // Ranking is a convenience; failing to persist it must never break the page.
  }
}

/** Apply a saved order, keeping unknown keys in their natural position. */
export function applyOrder(interests: RankedInterest[], order: string[]): RankedInterest[] {
  if (order.length === 0) return interests;
  const rank = new Map(order.map((key, i) => [key, i]));
  return [...interests].sort((a, b) => {
    const ra = rank.get(a.key);
    const rb = rank.get(b.key);
    if (ra === undefined && rb === undefined) return 0;
    if (ra === undefined) return 1;
    if (rb === undefined) return -1;
    return ra - rb;
  });
}

/** The interests that become fields: the highest-ranked mappable ones. */
export function fieldsFrom(interests: RankedInterest[]): RankedInterest[] {
  return interests.filter((i) => i.mappable).slice(0, MAX_FIELDS);
}

/**
 * Choose who is actually on the canvas, given the current ranking.
 *
 * Ranking is meant to steer the whole view, not just relabel the areas — so it
 * decides which people survive as well as where they sit. A match against the
 * top-ranked interest counts for more than a match against the fifth, and
 * someone matching nothing ranks below everyone who matches something. The
 * result is that promoting an interest pulls its people onto the canvas and
 * pushes the previous occupants off.
 *
 * The suggestion score only breaks ties, because it is unbounded and
 * viewer-relative — safe for ordering, meaningless as a magnitude.
 */
export function selectVisible(nodes: CanvasNode[], fieldCount: number, limit: number): CanvasNode[] {
  if (nodes.length === 0) return nodes;

  // Deal round-robin across the fields in rank order, strongest match first
  // within each.
  //
  // Two obvious rules are worse. Sorting by how many interests someone shares
  // promotes the unusual combinations, which are exactly the ones five circles
  // struggle to place, and the map fills with approximations. Sorting by their
  // single best match starves the bottom of the ranking outright — the
  // fifth interest ends up an empty circle even when people match it.
  //
  // Dealing one per field per pass gives every field on screen somebody in it,
  // while the top of the ranking still gets first pick on every pass and so
  // ends up the most populated. Re-ranking reshuffles the deal, which is what
  // makes promoting an interest visibly pull its people in.
  const byField: CanvasNode[][] = [];
  for (let i = 0; i < fieldCount; i++) {
    byField.push(nodes.filter((n) => n.membership & (1 << i)).sort((a, b) => a.rank - b.rank));
  }

  const taken = new Set<string>();
  const chosen: CanvasNode[] = [];
  const cursors = new Array(fieldCount).fill(0);

  for (let guard = 0; chosen.length < limit && guard < nodes.length + fieldCount; guard++) {
    let dealt = false;
    for (let i = 0; i < fieldCount && chosen.length < limit; i++) {
      while (cursors[i] < byField[i].length && taken.has(byField[i][cursors[i]].id)) cursors[i]++;
      if (cursors[i] >= byField[i].length) continue;
      const next = byField[i][cursors[i]++];
      taken.add(next.id);
      chosen.push(next);
      dealt = true;
    }
    if (!dealt) break;
  }

  // Anyone left over — including people who share none of the five — fills the
  // remaining slots in score order.
  for (const node of nodes) {
    if (chosen.length >= limit) break;
    if (!taken.has(node.id)) {
      taken.add(node.id);
      chosen.push(node);
    }
  }

  // Renumber by original strength so sphere size still reads as match quality.
  return chosen
    .sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : 1))
    .map((node, i) => ({ ...node, rank: i }));
}
