/**
 * The authorization layer for the graph.
 *
 * Every query that leaves this codebase is built by composing a caller-derived
 * visibility predicate into the Cypher. The UI hides what a scope forbids, but
 * this file is the actual gate: a raw API call with a student token gets the
 * same filtering the student UI gets.
 *
 * Two predicates matter:
 *   nodeVisibility(v)  - may the caller see this node at all?
 *   edgeVisibility(r)  - may the caller traverse/see this relationship?
 *
 * Both reference reserved params ($__me, $__role, $__subrole, ...) injected by
 * scopedParams(). Tool authors never write those params by hand.
 */

import type { Scope } from "@/lib/auth/roles";

/** Discoverable by any authenticated caller. The interest graph lives here by design. */
export const PUBLIC_LABELS = [
  "Person",
  "Department",
  "Course",
  "Offering",
  "Term",
  "Lab",
  "Club",
  "Event",
  "Interest",
  "Paper",
  "Position",
] as const;

/** Never visible without an explicit grant below. */
export const RESTRICTED_LABELS = [
  "Application",
  "FinanceRecord",
  "HRRecord",
  "Goal",
  "Assignment",
] as const;

export const ALL_LABELS = [...PUBLIC_LABELS, ...RESTRICTED_LABELS] as const;
export type NodeLabel = (typeof ALL_LABELS)[number];

/** Edges that carry no private information — the discovery substrate. */
export const PUBLIC_EDGES = [
  "TEACHES",
  "MEMBER_OF",
  "PI_OF",
  "AUTHORED",
  "WORKS_IN",
  "OF_COURSE",
  "IN_TERM",
  "PREREQ_OF",
  "AFFILIATED_WITH",
  "HAS_OPENING",
  "HOSTS",
  "FROM_LAB",
  "SUBFIELD_OF",
  "INTERESTED_IN",
  "COVERS",
  "FOCUSES_ON",
  "CENTERED_ON",
  "ON",
  "ABOUT",
] as const;

export const RESTRICTED_EDGES = [
  "ENROLLED_IN",
  "TAS",
  "ADVISES",
  "OWNS",
  "HAS",
  "SUBMITTED_BY",
  "REVIEWED_BY",
  "HAS_FINANCE",
  "HAS_HR",
] as const;

export const ALL_EDGES = [...PUBLIC_EDGES, ...RESTRICTED_EDGES] as const;
export type EdgeType = (typeof ALL_EDGES)[number];

export function isKnownLabel(x: string): x is NodeLabel {
  return (ALL_LABELS as readonly string[]).includes(x);
}

export function isKnownEdge(x: string): x is EdgeType {
  return (ALL_EDGES as readonly string[]).includes(x);
}

/**
 * Cypher boolean over node variable `v`. Safe to AND into any WHERE clause.
 */
export function nodeVisibility(v: string): string {
  return `(
    any(l IN labels(${v}) WHERE l IN $__publicLabels)
    OR (${v}:Goal AND (
         EXISTS { MATCH (:Person {id: $__me})-[:OWNS]->(${v}) }
      OR EXISTS { MATCH (:Person {id: $__me})-[:ADVISES]->(:Person)-[:OWNS]->(${v}) }
      OR ($__subrole = 'deans_office' AND EXISTS { MATCH (:Department)-[:OWNS]->(${v}) })
    ))
    OR (${v}:Assignment AND
         EXISTS { MATCH (:Person {id: $__me})-[:ENROLLED_IN|TAS|TEACHES]->(:Offering)-[:HAS]->(${v}) }
    )
    OR (${v}:Application AND (
         $__subrole = 'admissions'
      OR EXISTS { MATCH (${v})-[:REVIEWED_BY]->(:Person {id: $__me}) }
      OR EXISTS { MATCH (${v})-[:SUBMITTED_BY]->(:Person {id: $__me}) }
    ))
    OR (${v}:FinanceRecord AND $__subrole = 'finance')
    OR (${v}:HRRecord AND $__subrole = 'hr')
  )`;
}

/**
 * Cypher boolean over relationship variable `r`. Endpoint nodes must be checked
 * separately with nodeVisibility — this only governs the edge itself.
 */
export function edgeVisibility(r: string): string {
  const s = `startNode(${r})`;
  const e = `endNode(${r})`;
  return `(
    type(${r}) IN $__publicEdges
    OR (type(${r}) IN ['ENROLLED_IN', 'TAS'] AND (
         ${s}.id = $__me
      OR $__subrole = 'registrar'
      OR EXISTS { MATCH (:Person {id: $__me})-[:TEACHES]->(o) WHERE o = ${e} }
    ))
    OR (type(${r}) = 'OWNS' AND (
         ${s}.id = $__me
      OR EXISTS { MATCH (:Person {id: $__me})-[:ADVISES]->(x) WHERE x = ${s} }
      OR ($__subrole = 'deans_office' AND 'Department' IN labels(${s}))
    ))
    OR (type(${r}) = 'ADVISES' AND (${s}.id = $__me OR ${e}.id = $__me))
    OR (type(${r}) = 'HAS' AND
         EXISTS { MATCH (:Person {id: $__me})-[:ENROLLED_IN|TAS|TEACHES]->(o) WHERE o = ${s} }
    )
    OR (type(${r}) IN ['SUBMITTED_BY', 'REVIEWED_BY'] AND (
         $__subrole = 'admissions' OR ${e}.id = $__me
    ))
    OR (type(${r}) = 'HAS_FINANCE' AND $__subrole = 'finance')
    OR (type(${r}) = 'HAS_HR' AND $__subrole = 'hr')
  )`;
}

/** Reserved params every scoped query needs. Merged into caller params. */
export function scopedParams(
  scope: Scope,
  params: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...params,
    __me: scope.personId,
    __role: scope.role,
    __subrole: scope.subrole ?? "",
    __publicLabels: [...PUBLIC_LABELS],
    __publicEdges: [...PUBLIC_EDGES],
  };
}

/**
 * Label allowlist for a caller. Used to reject a request *before* it runs when
 * a caller asks for labels they can provably never see, so the API answers 403
 * rather than silently returning an empty list.
 */
export function readableLabels(scope: Scope): NodeLabel[] {
  const out: NodeLabel[] = [...PUBLIC_LABELS];
  out.push("Goal", "Assignment"); // instance-filtered, not label-filtered
  if (scope.subrole === "admissions" || scope.role === "student") out.push("Application");
  if (scope.subrole === "finance") out.push("FinanceRecord");
  if (scope.subrole === "hr") out.push("HRRecord");
  return out;
}

/** Property-level redaction for what does get returned. */
const SENSITIVE_PROPS: Partial<Record<string, string[]>> = {
  Person: ["email", "phone"],
  Application: ["ssnLast4"],
};

export function redact(
  scope: Scope,
  labels: string[],
  props: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...props };
  for (const label of labels) {
    const sensitive = SENSITIVE_PROPS[label];
    if (!sensitive) continue;
    const isSelf = label === "Person" && props.id === scope.personId;
    const privileged = scope.role !== "student" || isSelf;
    if (!privileged) for (const key of sensitive) delete out[key];
  }
  return out;
}
