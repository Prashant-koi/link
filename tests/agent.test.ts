/**
 * Smoke harness for the AI tool layer (spec §3 "a small eval/smoke harness").
 * Runs the agent loop end to end. With LLM_BASE_URL unset it exercises the
 * deterministic planner against the real scoped tools; with vLLM configured it
 * exercises the model's tool calls. Either way the assertions are about what
 * the *graph* returned, which is what we actually care about.
 */
import { afterAll, describe, expect, it } from "vitest";
import { runAgent, type AgentEvent } from "@/lib/ai/agent";
import { closeDriver } from "@/lib/graph/driver";
import { HERO, findPerson, scopeOf } from "./helpers";
import type { Scope } from "@/lib/auth/roles";

afterAll(async () => {
  await closeDriver();
});

async function ask(scope: Scope, query: string) {
  const events: AgentEvent[] = [];
  for await (const e of runAgent(scope, query)) events.push(e);
  const subgraph = events.find((e) => e.type === "subgraph");
  return {
    events,
    text: events.filter((e) => e.type === "token").map((e) => (e as { text: string }).text).join(""),
    tools: events.filter((e) => e.type === "tool").map((e) => (e as { name: string }).name),
    nodes: subgraph && subgraph.type === "subgraph" ? subgraph.data.nodes : [],
  };
}

describe("the hero student's demo query", () => {
  it("finds computational biology labs with undergraduate openings", async () => {
    const student = await scopeOf(HERO);
    const out = await ask(student, "find a research group in computational biology with openings for undergrads");

    const labs = out.nodes.filter((n) => n.label === "Lab");
    expect(labs.length).toBeGreaterThan(0);
    expect(labs.some((l) => /Computational Biology|Genome/i.test(l.name))).toBe(true);
    expect(out.nodes.some((n) => ["FinanceRecord", "HRRecord", "Application"].includes(n.label))).toBe(false);
  }, 60_000);

  it("answers 'where do I fit' from the interest graph", async () => {
    const student = await scopeOf(HERO);
    const out = await ask(student, "where do I fit in?");
    expect(out.nodes.length).toBeGreaterThan(1);
    expect(out.tools.length).toBeGreaterThan(0);
  }, 60_000);
});

describe("the same query, a different world", () => {
  it("never leaks restricted nodes to a finance user asking a student question", async () => {
    const finance = await scopeOf(await findPerson("p.subrole = 'finance'"));
    const out = await ask(finance, "find a research group in computational biology with openings for undergrads");
    expect(out.nodes.some((n) => n.label === "HRRecord")).toBe(false);
    expect(out.nodes.some((n) => n.label === "Application")).toBe(false);
  }, 60_000);

  it("a student asking about the applicant pipeline gets nothing", async () => {
    const student = await scopeOf(HERO);
    const out = await ask(student, "show me the admissions applicant pipeline");
    expect(out.nodes.some((n) => n.label === "Application")).toBe(false);
  }, 60_000);
});

describe("discovery reaches what the question actually asked for", () => {
  it("'labs with undergrad openings' returns the openings, not just the labs", async () => {
    const student = await scopeOf(HERO);
    const out = await ask(student, "find a research group in computational biology with openings for undergrads");
    const positions = out.nodes.filter((n) => n.label === "Position");
    expect(positions.length).toBeGreaterThan(0);
    expect(positions.some((p) => /undergrad|summer/i.test(p.name))).toBe(true);
  }, 60_000);
});
