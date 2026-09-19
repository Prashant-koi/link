/**
 * The RBAC leak tests. These are the tests the spec says to write in Phase 1
 * and keep green: a student must never reach Applications, Finance or HR —
 * not through the UI, not through the AI tools, not through a direct call.
 *
 * Requires a seeded database: npm run db:up && npm run seed
 */
import { afterAll, describe, expect, it } from "vitest";
import { closeDriver, read } from "@/lib/graph/driver";
import {
  assertVisible,
  find_paths,
  nodes_by_interest,
  recommend_for_person,
  search_nodes,
  traverse,
} from "@/lib/graph/tools";
import { admissionsPipeline, courseFolders, deanDashboard, financeLedger, hrRoster } from "@/lib/graph/apps";
import { ScopeError } from "@/lib/graph/types";
import { HERO, findPerson, scopeOf } from "./helpers";

afterAll(async () => {
  await closeDriver();
});

describe("restricted labels are unreachable by a student", () => {
  it("search_nodes rejects a request for restricted labels", async () => {
    const student = await scopeOf(HERO);
    await expect(search_nodes(student, { query_terms: "", labels: ["FinanceRecord"] })).rejects.toBeInstanceOf(ScopeError);
    await expect(search_nodes(student, { query_terms: "", labels: ["HRRecord"] })).rejects.toBeInstanceOf(ScopeError);
  });

  it("an unfiltered search never returns a restricted node", async () => {
    const student = await scopeOf(HERO);
    const out = await search_nodes(student, { query_terms: "", limit: 60 });
    const leaked = out.nodes.filter((n) =>
      n.labels.some((l) => ["FinanceRecord", "HRRecord"].includes(l)),
    );
    expect(leaked).toEqual([]);
  });

  it("a student cannot resolve another person's finance record by id", async () => {
    const student = await scopeOf(HERO);
    const [{ id }] = await read<{ id: string }>(`MATCH (f:FinanceRecord) RETURN f.id AS id LIMIT 1`);
    await expect(assertVisible(student, id)).rejects.toBeInstanceOf(ScopeError);
  });

  it("a student cannot reach an HR record even by id", async () => {
    const student = await scopeOf(HERO);
    const [{ id }] = await read<{ id: string }>(`MATCH (h:HRRecord) RETURN h.id AS id LIMIT 1`);
    await expect(assertVisible(student, id)).rejects.toBeInstanceOf(ScopeError);
  });

  it("a student cannot traverse into a restricted neighbourhood", async () => {
    const student = await scopeOf(HERO);
    const out = await traverse(student, { from_node_id: HERO, depth: 3, limit: 200 });
    const leaked = out.nodes.filter((n) =>
      n.labels.some((l) => ["FinanceRecord", "HRRecord", "Application"].includes(l)),
    );
    expect(leaked).toEqual([]);
  });

  it("find_paths cannot be used to fish for a restricted target", async () => {
    const student = await scopeOf(HERO);
    await expect(find_paths(student, { from_node_id: HERO, to_label: "HRRecord" })).rejects.toBeInstanceOf(ScopeError);
  });

  it("the app routes' query layer refuses restricted apps for a student", async () => {
    const student = await scopeOf(HERO);
    await expect(admissionsPipeline(student)).rejects.toBeInstanceOf(ScopeError);
    await expect(financeLedger(student)).rejects.toBeInstanceOf(ScopeError);
    await expect(hrRoster(student)).rejects.toBeInstanceOf(ScopeError);
    await expect(deanDashboard(student)).rejects.toBeInstanceOf(ScopeError);
  });
});

describe("staff scopes are separated from each other", () => {
  it("finance staff see finance but not HR or admissions", async () => {
    const finance = await scopeOf(await findPerson("p.subrole = 'finance'"));
    expect((await financeLedger(finance)).length).toBeGreaterThan(0);
    await expect(hrRoster(finance)).rejects.toBeInstanceOf(ScopeError);
    await expect(admissionsPipeline(finance)).rejects.toBeInstanceOf(ScopeError);
  });

  it("HR staff see HR but not finance", async () => {
    const hr = await scopeOf(await findPerson("p.subrole = 'hr'"));
    expect((await hrRoster(hr)).length).toBeGreaterThan(0);
    await expect(financeLedger(hr)).rejects.toBeInstanceOf(ScopeError);
  });

  it("admissions staff see the applicant pipeline; nobody else does", async () => {
    const admissions = await scopeOf(await findPerson("p.subrole = 'admissions'"));
    expect((await admissionsPipeline(admissions)).length).toBeGreaterThan(0);

    const dean = await scopeOf(await findPerson("p.subrole = 'deans_office'"));
    await expect(admissionsPipeline(dean)).rejects.toBeInstanceOf(ScopeError);

    const [{ id }] = await read<{ id: string }>(`MATCH (a:Application) RETURN a.id AS id LIMIT 1`);
    await expect(assertVisible(dean, id)).rejects.toBeInstanceOf(ScopeError);
    await expect(assertVisible(await scopeOf(HERO), id)).rejects.toBeInstanceOf(ScopeError);
  });

  it("the dean sees department goals and dashboards, not private records", async () => {
    const dean = await scopeOf(await findPerson("p.subrole = 'deans_office'"));
    const dash = await deanDashboard(dean);
    expect(dash.departments.length).toBeGreaterThan(0);
    expect(dash.deptGoals.length).toBeGreaterThan(0);
    await expect(financeLedger(dean)).rejects.toBeInstanceOf(ScopeError);
    await expect(hrRoster(dean)).rejects.toBeInstanceOf(ScopeError);
  });
});

describe("owned layer stays owned", () => {
  it("a student cannot read another student's goals", async () => {
    const student = await scopeOf(HERO);
    const others = await read<{ id: string }>(
      `MATCH (p:Person)-[:OWNS]->(g:Goal) WHERE p.id <> $me RETURN g.id AS id LIMIT 1`,
      { me: HERO },
    );
    if (others.length) {
      await expect(assertVisible(student, others[0].id)).rejects.toBeInstanceOf(ScopeError);
    }
  });

  it("a student sees their own goals", async () => {
    const student = await scopeOf(HERO);
    const mine = await read<{ id: string }>(
      `MATCH (:Person {id: $me})-[:OWNS]->(g:Goal) RETURN g.id AS id LIMIT 1`,
      { me: HERO },
    );
    expect(mine.length).toBeGreaterThan(0);
    await expect(assertVisible(student, mine[0].id)).resolves.toBeTruthy();
  });

  it("a professor sees their own roster but not another professor's", async () => {
    const profs = await read<{ id: string; off: string }>(
      `MATCH (p:Person)-[:TEACHES]->(o:Offering) WHERE p.subrole IN ['prof','assoc_prof']
       RETURN p.id AS id, o.id AS off`,
    );
    const mine = profs[0];
    const theirs = profs.find((p) => p.id !== mine.id)!;
    const prof = await scopeOf(mine.id);

    const own = await traverse(prof, { from_node_id: mine.off, edge_types: ["ENROLLED_IN"], depth: 1, limit: 100 });
    expect(own.links.some((l) => l.type === "ENROLLED_IN")).toBe(true);

    const other = await traverse(prof, { from_node_id: theirs.off, edge_types: ["ENROLLED_IN"], depth: 1, limit: 100 });
    expect(other.links.filter((l) => l.type === "ENROLLED_IN")).toEqual([]);
  });

  it("a student's course folders contain only their own enrollments", async () => {
    const student = await scopeOf(HERO);
    const folders = await courseFolders(student);
    expect(folders.length).toBeGreaterThan(0);
    expect(folders.every((f) => f.role === "enrolled")).toBe(true);
  });
});

describe("the same query returns a different world per role", () => {
  it("interest discovery is public; restricted labels stay out of it", async () => {
    const student = await scopeOf(HERO);
    const finance = await scopeOf(await findPerson("p.subrole = 'finance'"));

    const asStudent = await nodes_by_interest(student, {
      interest_names: ["Computational Biology"],
      target_labels: ["Lab", "Position", "Person"],
    });
    expect(asStudent.nodes.some((n) => n.label === "Lab")).toBe(true);

    const asFinance = await nodes_by_interest(finance, {
      interest_names: ["Computational Biology"],
      target_labels: ["Lab", "Position", "Person"],
    });
    /* the public layer is shared — the difference is what else each can reach */
    expect(asFinance.nodes.some((n) => n.label === "Lab")).toBe(true);

    const financeOnly = await financeLedger(finance);
    expect(financeOnly.length).toBeGreaterThan(0);
    await expect(financeLedger(student)).rejects.toBeInstanceOf(ScopeError);
  });

  it("recommendations for the hero student find labs and openings", async () => {
    const student = await scopeOf(HERO);
    const rec = await recommend_for_person(student, { person_id: HERO });
    expect(rec.ranked.length).toBeGreaterThan(0);
    expect(rec.interests).toContain("Computational Biology");
    expect(rec.ranked.some((r) => r.node.label === "Lab")).toBe(true);
  });
});
