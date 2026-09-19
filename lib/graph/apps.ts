/**
 * Queries behind the supporting apps. Same rule as tools.ts: every query
 * composes the visibility predicates, so an app route is not a side door.
 */

import { read } from "./driver";
import { nodeVisibility, scopedParams } from "./policy";
import { ScopeError } from "./types";
import { can, type Scope } from "@/lib/auth/roles";

export interface CourseFolder {
  term: string;
  termId: string;
  offeringId: string;
  code: string;
  title: string;
  role: "enrolled" | "teaching" | "ta";
  instructor: string | null;
  meets: string | null;
  assignments: { id: string; title: string; dueAt: string }[];
}

/** Term -> Course -> {Assignments, Deadlines}. One app among many. */
export async function courseFolders(ctx: Scope): Promise<CourseFolder[]> {
  const rows = await read<{
    term: string; termId: string; offeringId: string; code: string; title: string;
    rel: string; instructor: string | null; meets: string | null;
    assignments: { id: string; title: string; dueAt: string }[];
  }>(
    `
    MATCH (me:Person {id: $__me})-[r:ENROLLED_IN|TEACHES|TAS]->(o:Offering)
    MATCH (o)-[:OF_COURSE]->(c:Course), (o)-[:IN_TERM]->(t:Term)
    OPTIONAL MATCH (instr:Person)-[:TEACHES]->(o)
    OPTIONAL MATCH (o)-[:HAS]->(a:Assignment)
    WHERE ${nodeVisibility("c")}
    WITH t, o, c, type(r) AS rel, instr, collect(DISTINCT {id: a.id, title: a.title, dueAt: a.dueAt}) AS assignments
    RETURN t.name AS term, t.id AS termId, o.id AS offeringId, c.code AS code, c.title AS title,
           rel, instr.name AS instructor, o.meets AS meets,
           [x IN assignments WHERE x.id IS NOT NULL] AS assignments
    ORDER BY t.starts DESC, c.code
    `,
    scopedParams(ctx),
  );

  return rows.map((r) => ({
    ...r,
    role: r.rel === "ENROLLED_IN" ? "enrolled" : r.rel === "TEACHES" ? "teaching" : "ta",
    assignments: (r.assignments ?? []).sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
  }));
}

export interface CalendarItem {
  id: string;
  kind: "assignment" | "event";
  title: string;
  at: string;
  course?: string;
  offeringId?: string;
  location?: string;
  source: string;
}

/** Global calendar: every deadline the caller can see, plus events they can see. */
export async function calendar(
  ctx: Scope,
  opts: { offeringId?: string; query?: string } = {},
): Promise<CalendarItem[]> {
  const deadlines = await read<{
    id: string; title: string; at: string; course: string; offeringId: string;
  }>(
    `
    MATCH (me:Person {id: $__me})-[:ENROLLED_IN|TEACHES|TAS]->(o:Offering)-[:HAS]->(a:Assignment)
    MATCH (o)-[:OF_COURSE]->(c:Course)
    WHERE ${nodeVisibility("a")}
      AND ($offeringId IS NULL OR o.id = $offeringId)
    RETURN a.id AS id, a.title AS title, a.dueAt AS at, c.code AS course, o.id AS offeringId
    ORDER BY a.dueAt
    `,
    scopedParams(ctx, { offeringId: opts.offeringId ?? null }),
  );

  const events = await read<{ id: string; title: string; at: string; location: string; host: string }>(
    `
    MATCH (host)-[:HOSTS]->(e:Event)
    WHERE ${nodeVisibility("e")}
    OPTIONAL MATCH (me:Person {id: $__me})-[att:ATTENDING]->(e)
    RETURN e.id AS id, e.name AS title, e.startsAt AS at, e.location AS location,
           host.name AS host, att IS NOT NULL AS attending
    ORDER BY e.startsAt
    `,
    scopedParams(ctx),
  );

  const items: CalendarItem[] = [
    ...deadlines.map((d) => ({
      id: d.id,
      kind: "assignment" as const,
      title: `${d.course} — ${d.title}`,
      at: d.at,
      course: d.course,
      offeringId: d.offeringId,
      source: "coursework",
    })),
    ...(opts.offeringId
      ? []
      : events.map((e) => ({
          id: e.id,
          kind: "event" as const,
          title: e.title,
          at: e.at,
          location: e.location,
          source: e.host,
        }))),
  ];

  const q = opts.query?.toLowerCase().trim();
  const filtered = q
    ? items.filter((i) => `${i.title} ${i.course ?? ""} ${i.source}`.toLowerCase().includes(q))
    : items;

  return filtered.sort((a, b) => a.at.localeCompare(b.at));
}

export async function goals(ctx: Scope) {
  return read(
    `
    MATCH (owner)-[:OWNS]->(g:Goal)
    WHERE ${nodeVisibility("g")}
    OPTIONAL MATCH (g)-[:ABOUT]->(i:Interest)
    RETURN g.id AS id, g.name AS name, g.type AS type, g.horizon AS horizon,
           owner.name AS owner, owner.id AS ownerId, collect(DISTINCT i.name) AS interests
    ORDER BY owner.name, g.name
    `,
    scopedParams(ctx),
  );
}

/* ---------------------------- role-gated apps ---------------------------- */

export async function admissionsPipeline(ctx: Scope) {
  if (!can(ctx, "review_applications")) throw new ScopeError("admissions console is outside your scope");
  return read(
    `
    MATCH (a:Application)
    WHERE ${nodeVisibility("a")}
    OPTIONAL MATCH (a)-[:SUBMITTED_BY]->(p:Person)
    OPTIONAL MATCH (a)-[:REVIEWED_BY]->(r:Person)
    RETURN a.id AS id, a.name AS name, a.stage AS stage, a.program AS program,
           a.gpa AS gpa, a.submittedAt AS submittedAt,
           p.name AS applicant, r.name AS reviewer
    ORDER BY a.submittedAt
    `,
    scopedParams(ctx),
  );
}

export async function financeLedger(ctx: Scope) {
  if (!can(ctx, "view_finance")) throw new ScopeError("finance records are outside your scope");
  return read(
    `
    MATCH (holder)-[:HAS_FINANCE]->(f:FinanceRecord)
    WHERE ${nodeVisibility("f")}
    RETURN f.id AS id, f.name AS name, holder.name AS holder,
           labels(holder)[0] AS holderType,
           f.tuitionBalance AS tuitionBalance, f.aidPackage AS aidPackage,
           f.budget AS budget, f.fiscalYear AS fiscalYear, f.term AS term
    ORDER BY coalesce(f.budget, f.tuitionBalance) DESC
    LIMIT 100
    `,
    scopedParams(ctx),
  );
}

export async function hrRoster(ctx: Scope) {
  if (!can(ctx, "view_hr")) throw new ScopeError("HR records are outside your scope");
  return read(
    `
    MATCH (p:Person)-[:HAS_HR]->(h:HRRecord)
    WHERE ${nodeVisibility("h")}
    OPTIONAL MATCH (p)-[:WORKS_IN]->(d:Department)
    RETURN h.id AS id, p.name AS person, p.role AS role, p.subrole AS subrole,
           d.name AS department, h.employmentType AS employmentType,
           h.salaryBand AS salaryBand, h.startDate AS startDate
    ORDER BY d.name, p.name
    LIMIT 100
    `,
    scopedParams(ctx),
  );
}

export async function deanDashboard(ctx: Scope) {
  if (!can(ctx, "view_institution_dashboards")) throw new ScopeError("institution dashboards are outside your scope");

  const departments = await read(
    `
    MATCH (d:Department {kind: 'academic'})
    OPTIONAL MATCH (p:Person)-[:WORKS_IN]->(d) WHERE p.role = 'faculty'
    OPTIONAL MATCH (l:Lab)-[:AFFILIATED_WITH]->(d)
    OPTIONAL MATCH (c:Course)-[:OFFERED_BY]->(d)
    RETURN d.id AS id, d.name AS name,
           count(DISTINCT p) AS faculty, count(DISTINCT l) AS labs, count(DISTINCT c) AS courses
    ORDER BY d.name
    `,
    scopedParams(ctx),
  );

  const deptGoals = await read(
    `
    MATCH (d:Department)-[:OWNS]->(g:Goal)
    WHERE ${nodeVisibility("g")}
    OPTIONAL MATCH (g)-[:ABOUT]->(i:Interest)
    RETURN d.name AS department, g.name AS goal, g.horizon AS horizon, collect(i.name) AS interests
    ORDER BY d.name
    `,
    scopedParams(ctx),
  );

  const topInterests = await read(
    `
    MATCH (p:Person)-[r:INTERESTED_IN]->(i:Interest)
    RETURN i.name AS interest, count(p) AS people, round(avg(r.strength) * 100) / 100 AS avgStrength
    ORDER BY people DESC LIMIT 10
    `,
    scopedParams(ctx),
  );

  const openings = await read(
    `
    MATCH (l:Lab)-[:HAS_OPENING]->(pos:Position {open: true})
    RETURN l.name AS lab, count(pos) AS openings
    ORDER BY openings DESC
    `,
    scopedParams(ctx),
  );

  return { departments, deptGoals, topInterests, openings };
}
