/**
 * The graph tool surface.
 *
 * Rules, enforced by convention and by the tests in /tests:
 *   1. Every exported tool takes `ctx: Scope` as its first argument.
 *   2. No tool runs Cypher without composing nodeVisibility()/edgeVisibility().
 *   3. Node ids arriving from a client or from the model are re-checked with
 *      assertVisible() before they are used as a traversal anchor.
 *
 * The LLM calls these functions. It never sees Cypher and never writes it.
 */

import { read, write } from "./driver";
import {
  edgeVisibility,
  isKnownEdge,
  isKnownLabel,
  nodeVisibility,
  readableLabels,
  redact,
  scopedParams,
  type EdgeType,
  type NodeLabel,
} from "./policy";
import { ScopeError, type GraphLink, type GraphNode, type GraphPath, type Subgraph } from "./types";
import { can, type Scope } from "@/lib/auth/roles";

/* -------------------------------------------------------------------------- */
/* shaping helpers                                                            */
/* -------------------------------------------------------------------------- */

type RawNode = {
  identity: unknown;
  elementId: string;
  labels: string[];
  properties: Record<string, unknown>;
};
type RawRel = {
  type: string;
  properties: Record<string, unknown>;
  startNodeElementId: string;
  endNodeElementId: string;
};

const LABEL_PRIORITY = [
  "Person",
  "Lab",
  "Club",
  "Course",
  "Offering",
  "Event",
  "Position",
  "Paper",
  "Interest",
  "Goal",
  "Department",
  "Application",
  "Assignment",
  "Term",
  "FinanceRecord",
  "HRRecord",
];

function primaryLabel(labels: string[]): string {
  for (const l of LABEL_PRIORITY) if (labels.includes(l)) return l;
  return labels[0] ?? "Node";
}

function displayName(props: Record<string, unknown>, label: string): string {
  return (
    (props.name as string) ??
    (props.title as string) ??
    (props.code as string) ??
    `${label} ${String(props.id ?? "")}`
  );
}

function toNode(ctx: Scope, raw: RawNode): GraphNode {
  const label = primaryLabel(raw.labels);
  const props = redact(ctx, raw.labels, raw.properties);
  return {
    id: String(props.id ?? ""),
    labels: raw.labels,
    label,
    name: displayName(props, label),
    props,
  };
}

function dedupe(nodes: GraphNode[]): GraphNode[] {
  const seen = new Map<string, GraphNode>();
  for (const n of nodes) if (n.id && !seen.has(n.id)) seen.set(n.id, n);
  return [...seen.values()];
}

function dedupeLinks(links: GraphLink[]): GraphLink[] {
  const seen = new Map<string, GraphLink>();
  for (const l of links) seen.set(`${l.source}|${l.type}|${l.target}`, l);
  return [...seen.values()];
}

/* -------------------------------------------------------------------------- */
/* guards                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Throws unless the caller is allowed to see this node. Never trust an id that
 * came from the model or the browser — an id is a capability otherwise.
 */
export async function assertVisible(ctx: Scope, id: string): Promise<GraphNode> {
  const rows = await read<{ n: RawNode }>(
    `MATCH (n {id: $id}) WHERE ${nodeVisibility("n")} RETURN n LIMIT 1`,
    scopedParams(ctx, { id }),
  );
  if (rows.length === 0) throw new ScopeError(`node ${id} is not visible to you`);
  return toNode(ctx, rows[0].n);
}

function sanitizeLabels(ctx: Scope, labels?: string[]): NodeLabel[] {
  const allowed = readableLabels(ctx);
  if (!labels || labels.length === 0) return allowed;
  const requested = labels.filter(isKnownLabel);
  const permitted = requested.filter((l) => allowed.includes(l));
  if (requested.length > 0 && permitted.length === 0) {
    throw new ScopeError(`none of [${requested.join(", ")}] are readable in your scope`);
  }
  return permitted;
}

function sanitizeEdges(edgeTypes?: string[]): EdgeType[] | null {
  if (!edgeTypes || edgeTypes.length === 0) return null;
  const known = edgeTypes.filter(isKnownEdge);
  return known.length > 0 ? known : null;
}

/* -------------------------------------------------------------------------- */
/* read tools                                                                 */
/* -------------------------------------------------------------------------- */

export interface SearchArgs {
  query_terms: string;
  labels?: string[];
  limit?: number;
}

/** Keyword search across names/titles/descriptions, scoped. */
export async function search_nodes(ctx: Scope, args: SearchArgs): Promise<Subgraph> {
  const labels = sanitizeLabels(ctx, args.labels);
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 60);
  const terms = args.query_terms
    .toLowerCase()
    .split(/[^a-z0-9+#]+/i)
    .filter((t) => t.length > 2);

  const rows = await read<{ n: RawNode }>(
    `
    MATCH (n)
    WHERE any(l IN labels(n) WHERE l IN $labels)
      AND ${nodeVisibility("n")}
      AND ($terms = [] OR any(t IN $terms WHERE
            toLower(coalesce(n.name, '')) CONTAINS t
         OR toLower(coalesce(n.title, '')) CONTAINS t
         OR toLower(coalesce(n.code, '')) CONTAINS t
         OR toLower(coalesce(n.summary, '')) CONTAINS t
         OR toLower(coalesce(n.description, '')) CONTAINS t))
    WITH n, size([t IN $terms WHERE
            toLower(coalesce(n.name, '')) CONTAINS t
         OR toLower(coalesce(n.title, '')) CONTAINS t
         OR toLower(coalesce(n.code, '')) CONTAINS t
         OR toLower(coalesce(n.summary, '')) CONTAINS t
         OR toLower(coalesce(n.description, '')) CONTAINS t]) AS hits
    RETURN n ORDER BY hits DESC, coalesce(n.name, n.title, n.code) LIMIT toInteger($limit)
    `,
    scopedParams(ctx, { labels, terms, limit }),
  );

  return { nodes: dedupe(rows.map((r) => toNode(ctx, r.n))), links: [] };
}

export interface TraverseArgs {
  from_node_id: string;
  edge_types?: string[];
  depth?: number;
  limit?: number;
}

/** Walk out from a node, edge by edge, with every hop scope-checked. */
export async function traverse(ctx: Scope, args: TraverseArgs): Promise<Subgraph> {
  await assertVisible(ctx, args.from_node_id);
  const depth = Math.min(Math.max(args.depth ?? 1, 1), 3);
  const limit = Math.min(Math.max(args.limit ?? 60, 1), 200);
  const edges = sanitizeEdges(args.edge_types);
  const relPattern = edges ? `:${edges.join("|")}` : "";

  const rows = await read<{ path: { segments: { start: RawNode; relationship: RawRel; end: RawNode }[] } }>(
    `
    MATCH path = (start {id: $from})-[${relPattern}*1..${depth}]-(other)
    WHERE ${nodeVisibility("start")}
      AND all(n IN nodes(path) WHERE ${nodeVisibility("n")})
      AND all(r IN relationships(path) WHERE ${edgeVisibility("r")})
    RETURN path LIMIT toInteger($limit)
    `,
    scopedParams(ctx, { from: args.from_node_id, limit }),
  );

  return pathsToSubgraph(ctx, rows.map((r) => r.path));
}

function pathsToSubgraph(
  ctx: Scope,
  paths: { segments: { start: RawNode; relationship: RawRel; end: RawNode }[] }[],
): Subgraph {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  for (const path of paths) {
    for (const seg of path.segments) {
      const a = toNode(ctx, seg.start);
      const b = toNode(ctx, seg.end);
      nodes.push(a, b);
      links.push({ source: a.id, target: b.id, type: seg.relationship.type });
    }
  }
  return { nodes: dedupe(nodes), links: dedupeLinks(links) };
}

export interface FindPathsArgs {
  from_node_id: string;
  to_node_id?: string;
  to_label?: string;
  max_depth?: number;
  limit?: number;
  /** Hub labels to route around. Everyone shares a Department, so a path through
      one is technically true and tells you nothing. */
  avoid_labels?: string[];
}

/** "How am I connected to X" — the beat at 1:15 of the demo. */
export async function find_paths(ctx: Scope, args: FindPathsArgs): Promise<GraphPath[]> {
  await assertVisible(ctx, args.from_node_id);
  if (args.to_node_id) await assertVisible(ctx, args.to_node_id);
  if (!args.to_node_id && !args.to_label) {
    throw new Error("find_paths needs either to_node_id or to_label");
  }
  const depth = Math.min(Math.max(args.max_depth ?? 4, 1), 5);
  const limit = Math.min(Math.max(args.limit ?? 3, 1), 10);
  const avoid = (args.avoid_labels ?? ["Department", "Term"]).filter(
    (l) => l !== args.to_label,
  );
  const targetMatch = args.to_node_id
    ? `(target {id: $to})`
    : `(target:${sanitizeLabels(ctx, [args.to_label!])[0]})`;

  const rows = await read<{
    path: { segments: { start: RawNode; relationship: RawRel; end: RawNode }[] };
  }>(
    `
    MATCH path = shortestPath((start {id: $from})-[*1..${depth}]-${targetMatch})
    WHERE start.id <> target.id
      AND none(n IN nodes(path)[1..-1] WHERE any(l IN labels(n) WHERE l IN $avoid))
      AND all(n IN nodes(path) WHERE ${nodeVisibility("n")})
      AND all(r IN relationships(path) WHERE ${edgeVisibility("r")})
    RETURN path ORDER BY length(path) ASC LIMIT toInteger($limit)
    `,
    scopedParams(ctx, { from: args.from_node_id, to: args.to_node_id ?? null, limit, avoid }),
  );

  return rows.map((r) => {
    const sub = pathsToSubgraph(ctx, [r.path]);
    const ordered = r.path.segments.flatMap((s, i) =>
      i === 0 ? [toNode(ctx, s.start), toNode(ctx, s.end)] : [toNode(ctx, s.end)],
    );
    /* Render each hop in the direction the edge actually points, so the story
       reads true: an offering does not teach a professor. */
    const narrative = r.path.segments
      .map((s, i) => {
        const a = displayName(s.start.properties, primaryLabel(s.start.labels));
        const b = displayName(s.end.properties, primaryLabel(s.end.labels));
        const verb = s.relationship.type.toLowerCase().replace(/_/g, " ");
        const forward = s.relationship.startNodeElementId === s.start.elementId;
        const hop = forward ? `— ${verb} →` : `← ${verb} —`;
        return i === 0 ? `${a} ${hop} ${b}` : `${hop} ${b}`;
      })
      .join(" ");
    return { nodes: ordered, links: sub.links, narrative };
  });
}

export interface InterestArgs {
  interest_names: string[];
  target_labels?: string[];
  expand_subfields?: boolean;
  limit?: number;
}

/**
 * The core discovery primitive. Everything points at Interest nodes, so this is
 * how "where do I fit" gets *inferred* rather than hand-authored.
 */
export async function nodes_by_interest(ctx: Scope, args: InterestArgs): Promise<Subgraph> {
  const labels = sanitizeLabels(ctx, args.target_labels);
  const limit = Math.min(Math.max(args.limit ?? 40, 1), 120);
  const expand = args.expand_subfields ?? true;
  const names = args.interest_names.map((n) => n.toLowerCase());

  const rows = await read<{ n: RawNode; i: RawNode; rel: string; overlap: number }>(
    `
    MATCH (seed:Interest)
    WHERE toLower(seed.name) IN $names
    ${expand ? "OPTIONAL MATCH (sub:Interest)-[:SUBFIELD_OF*1..2]->(seed)" : "WITH seed, null AS sub"}
    WITH collect(DISTINCT seed) + collect(DISTINCT sub) AS raw
    UNWIND raw AS i
    WITH DISTINCT i WHERE i IS NOT NULL
    MATCH (n)-[r:COVERS|FOCUSES_ON|CENTERED_ON|INTERESTED_IN|ON|ABOUT]->(i)
    WHERE any(l IN labels(n) WHERE l IN $labels)
      AND ${nodeVisibility("n")}
      AND ${edgeVisibility("r")}
    WITH n, i, type(r) AS rel, count(DISTINCT i) AS overlap
    RETURN n, i, rel, overlap
    ORDER BY overlap DESC
    LIMIT toInteger($limit)
    `,
    scopedParams(ctx, { names, labels, limit }),
  );

  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  for (const row of rows) {
    const n = toNode(ctx, row.n);
    const i = toNode(ctx, row.i);
    nodes.push(n, i);
    links.push({ source: n.id, target: i.id, type: row.rel });
  }

  /* Positions carry no interest edges of their own — they hang off a Lab. Same
     for the PI of a matching lab. Reach them through the lab so that "labs with
     undergrad openings" actually answers the question asked. */
  if (labels.includes("Position") || labels.includes("Person")) {
    const indirect = await read<{ lab: RawNode; n: RawNode; rel: string }>(
      `
      MATCH (seed:Interest) WHERE toLower(seed.name) IN $names
      ${expand ? "OPTIONAL MATCH (sub:Interest)-[:SUBFIELD_OF*1..2]->(seed)" : "WITH seed, null AS sub"}
      WITH collect(DISTINCT seed) + collect(DISTINCT sub) AS raw
      UNWIND raw AS i
      WITH DISTINCT i WHERE i IS NOT NULL
      MATCH (lab:Lab)-[:FOCUSES_ON]->(i)
      MATCH (lab)-[r:HAS_OPENING|PI_OF]-(n)
      WHERE any(l IN labels(n) WHERE l IN $labels)
        AND (NOT n:Position OR coalesce(n.open, true) = true)
        AND ${nodeVisibility("lab")}
        AND ${nodeVisibility("n")}
        AND ${edgeVisibility("r")}
      RETURN DISTINCT lab, n, type(r) AS rel
      LIMIT toInteger($limit)
      `,
      scopedParams(ctx, { names, labels, limit }),
    );
    for (const row of indirect) {
      const lab = toNode(ctx, row.lab);
      const n = toNode(ctx, row.n);
      nodes.push(lab, n);
      links.push(
        row.rel === "PI_OF"
          ? { source: n.id, target: lab.id, type: "PI_OF" }
          : { source: lab.id, target: n.id, type: "HAS_OPENING" },
      );
    }
  }

  return { nodes: dedupe(nodes), links: dedupeLinks(links) };
}

export interface RecommendResult {
  subgraph: Subgraph;
  ranked: { node: GraphNode; score: number; shared: string[] }[];
  interests: string[];
}

/**
 * "Where do I fit." Runs entirely off the interest graph: the person's own
 * INTERESTED_IN edges plus the interests their goals are ABOUT, expanded down
 * the SUBFIELD_OF DAG, ranked by shared-interest overlap x strength.
 */
export async function recommend_for_person(
  ctx: Scope,
  args: { person_id?: string; target_labels?: string[]; limit?: number },
): Promise<RecommendResult> {
  const personId = args.person_id ?? ctx.personId;
  const person = await assertVisible(ctx, personId);
  const labels = sanitizeLabels(ctx, args.target_labels ?? ["Lab", "Club", "Course", "Event", "Person", "Position"]);
  const limit = Math.min(Math.max(args.limit ?? 25, 1), 80);

  const rows = await read<{
    n: RawNode;
    score: number;
    shared: string[];
  }>(
    `
    MATCH (me:Person {id: $personId})
    OPTIONAL MATCH (me)-[li:INTERESTED_IN]->(direct:Interest)
    OPTIONAL MATCH (me)-[:OWNS]->(g:Goal)-[:ABOUT]->(viaGoal:Interest)
    WITH me,
         collect(DISTINCT {i: direct, w: coalesce(li.strength, 0.5)}) +
         collect(DISTINCT {i: viaGoal, w: 1.0}) AS seeds
    UNWIND seeds AS seed
    WITH me, seed.i AS si, seed.w AS sw WHERE si IS NOT NULL
    OPTIONAL MATCH (child:Interest)-[:SUBFIELD_OF*1..2]->(si)
    WITH me,
         collect(DISTINCT {i: si, w: sw}) +
         collect(DISTINCT {i: child, w: sw * 0.6}) AS weighted
    UNWIND weighted AS wi
    WITH me, wi WHERE wi.i IS NOT NULL
    WITH me, wi.i AS interest, max(wi.w) AS weight
    MATCH (n)-[r:COVERS|FOCUSES_ON|CENTERED_ON|INTERESTED_IN|ON]->(interest)
    WHERE n.id <> me.id
      AND any(l IN labels(n) WHERE l IN $labels)
      AND ${nodeVisibility("n")}
      AND ${edgeVisibility("r")}
    WITH n, sum(weight) AS score, collect(DISTINCT interest.name) AS shared
    RETURN n, score, shared
    ORDER BY score DESC, size(shared) DESC
    LIMIT toInteger($limit)
    `,
    scopedParams(ctx, { personId, labels, limit }),
  );

  const ranked = rows.map((r) => ({
    node: toNode(ctx, r.n),
    score: Math.round((r.score ?? 0) * 100) / 100,
    shared: r.shared ?? [],
  }));

  const nodes = dedupe([person, ...ranked.map((r) => r.node)]);
  const links = ranked.map((r) => ({ source: person.id, target: r.node.id, type: "SHARES_INTEREST" }));
  const interests = [...new Set(ranked.flatMap((r) => r.shared))];

  return { subgraph: { nodes, links: dedupeLinks(links) }, ranked, interests };
}

/** Neighbourhood pull for the LLM to summarize, and for node detail windows. */
export async function summarize_neighborhood(
  ctx: Scope,
  args: { node_id: string; limit?: number },
): Promise<{ center: GraphNode; subgraph: Subgraph; facts: string[] }> {
  const center = await assertVisible(ctx, args.node_id);
  const sub = await traverse(ctx, {
    from_node_id: args.node_id,
    depth: 1,
    limit: args.limit ?? 40,
  });
  const facts = sub.links.map((l) => {
    const a = sub.nodes.find((n) => n.id === l.source);
    const b = sub.nodes.find((n) => n.id === l.target);
    return `${a?.name ?? l.source} ${l.type.toLowerCase().replace(/_/g, " ")} ${b?.name ?? l.target}`;
  });
  return { center, subgraph: sub, facts };
}

/* -------------------------------------------------------------------------- */
/* agentic actions (capability-gated, confirmed in the UI)                    */
/* -------------------------------------------------------------------------- */

function listify(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export async function draft_intro_email(
  ctx: Scope,
  args: { person_id: string; context?: string },
): Promise<{ to: string; subject: string; body: string; requiresConfirmation: true }> {
  if (!can(ctx, "draft_intro_email")) throw new ScopeError("you cannot draft intro emails");
  const target = await assertVisible(ctx, args.person_id);
  const shared = await read<{ names: string[] }>(
    `
    MATCH (me:Person {id: $__me})-[:INTERESTED_IN]->(i:Interest)<-[:INTERESTED_IN|FOCUSES_ON]-(t {id: $target})
    RETURN collect(DISTINCT i.name) AS names
    `,
    scopedParams(ctx, { target: args.person_id }),
  );
  const overlap = shared[0]?.names ?? [];

  return {
    to: (target.props.email as string) ?? `${target.id}@university.edu`,
    subject: `Undergraduate research interest${overlap.length ? ` — ${overlap[0]}` : ""}`,
    body: [
      `Dear ${target.name},`,
      "",
      `I'm ${ctx.name}, a ${ctx.role} here.${
        overlap.length ? ` I've been focusing on ${listify(overlap)}, which overlaps with your work.` : ""
      }${args.context ? ` ${args.context}` : ""}`,
      "",
      "Would you have twenty minutes in the next couple of weeks to talk about whether there's a way for me to contribute?",
      "",
      `Thank you,`,
      ctx.name,
    ].join("\n"),
    requiresConfirmation: true,
  };
}

export async function add_to_calendar(
  ctx: Scope,
  args: { event_id: string },
): Promise<{ ok: boolean; event: GraphNode }> {
  if (!can(ctx, "add_to_calendar")) throw new ScopeError("you cannot modify a calendar");
  const event = await assertVisible(ctx, args.event_id);
  await write(
    `
    MATCH (me:Person {id: $__me}), (e:Event {id: $eventId})
    MERGE (me)-[r:ATTENDING]->(e)
    SET r.addedAt = datetime()
    RETURN r
    `,
    scopedParams(ctx, { eventId: args.event_id }),
  );
  return { ok: true, event };
}

export async function generate_checklist(
  ctx: Scope,
  args: { goal_id?: string; application_id?: string },
): Promise<{ title: string; items: string[] }> {
  if (!can(ctx, "generate_checklist")) throw new ScopeError("you cannot generate checklists");
  const id = args.goal_id ?? args.application_id;
  if (!id) throw new Error("generate_checklist needs goal_id or application_id");
  const node = await assertVisible(ctx, id);

  if (node.labels.includes("Goal")) {
    const rows = await read<{ n: RawNode }>(
      `
      MATCH (g:Goal {id: $id})-[:ABOUT]->(i:Interest)<-[:COVERS|FOCUSES_ON|HAS_OPENING]-(n)
      WHERE ${nodeVisibility("n")}
      RETURN n LIMIT 8
      `,
      scopedParams(ctx, { id }),
    );
    return {
      title: `Next steps toward: ${node.name}`,
      items: rows.map((r) => {
        const n = toNode(ctx, r.n);
        return n.labels.includes("Course")
          ? `Register for ${n.name}`
          : `Reach out about ${n.name}`;
      }),
    };
  }

  return {
    title: `Application checklist: ${node.name}`,
    items: [
      "Confirm transcript received",
      "Assign a reviewer",
      "Schedule interview slot",
      "Record decision",
    ],
  };
}

/** Everything the dock and the agent loop are allowed to reach. */
export const GRAPH_TOOLS = {
  search_nodes,
  traverse,
  find_paths,
  nodes_by_interest,
  recommend_for_person,
  summarize_neighborhood,
  draft_intro_email,
  add_to_calendar,
  generate_checklist,
} as const;

export type ToolName = keyof typeof GRAPH_TOOLS;
