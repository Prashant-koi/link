/**
 * The agent loop: NL query -> tool calls -> scoped graph results -> grounded
 * answer + a renderable subgraph. Streamed as SSE events.
 *
 * Every tool call is executed here, server-side, with the caller's Scope. The
 * model never receives a database handle, a Cypher string, or an id it was not
 * already shown by a scoped tool — and even then, ids are re-checked in
 * assertVisible() before use.
 */

import { GRAPH_TOOLS, type ToolName } from "@/lib/graph/tools";
import { ScopeError, type Subgraph } from "@/lib/graph/types";
import type { Scope } from "@/lib/auth/roles";
import { chat, isLLMConfigured, streamChat, type ChatMessage } from "./client";
import { SYSTEM_PROMPT, TOOL_SCHEMAS } from "./toolSchemas";
import { planWithoutLLM, narrate } from "./fallback";

export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "tool"; name: string; args: unknown }
  | { type: "tool_result"; name: string; summary: string }
  | { type: "token"; text: string }
  | { type: "subgraph"; data: Subgraph }
  | { type: "action"; kind: string; data: unknown }
  | { type: "error"; text: string }
  | { type: "done" };

const MAX_STEPS = 4;

function mergeSubgraph(into: Subgraph, from: unknown): void {
  const sub = extractSubgraph(from);
  if (!sub) return;
  const ids = new Set(into.nodes.map((n) => n.id));
  for (const n of sub.nodes) if (!ids.has(n.id)) { into.nodes.push(n); ids.add(n.id); }
  const keys = new Set(into.links.map((l) => `${l.source}|${l.type}|${l.target}`));
  for (const l of sub.links) {
    const k = `${l.source}|${l.type}|${l.target}`;
    if (!keys.has(k)) { into.links.push(l); keys.add(k); }
  }
}

function extractSubgraph(x: unknown): Subgraph | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (Array.isArray(o.nodes) && Array.isArray(o.links)) return o as unknown as Subgraph;
  if (o.subgraph) return extractSubgraph(o.subgraph);
  if (Array.isArray(x)) {
    const merged: Subgraph = { nodes: [], links: [] };
    for (const item of x) mergeSubgraph(merged, item);
    return merged;
  }
  return null;
}

/** Tool-result text handed back to the model — trimmed so context stays small. */
function condense(name: string, result: unknown): string {
  const sub = extractSubgraph(result);
  if (name === "find_paths" && Array.isArray(result)) {
    return result.map((p: { narrative: string }) => p.narrative).join("\n") || "no path found";
  }
  if (name === "recommend_for_person") {
    const r = result as { ranked: { node: { id: string; name: string; label: string }; score: number; shared: string[] }[] };
    if (!r.ranked?.length) return "nothing matched";
    return r.ranked
      .slice(0, 12)
      .map((x) => `${x.node.label} ${x.node.name} (id=${x.node.id}, shared: ${x.shared.join(", ")}, score ${x.score})`)
      .join("\n");
  }
  if (sub) {
    if (!sub.nodes.length) return "no results in your scope";
    return sub.nodes
      .slice(0, 25)
      .map((n) => {
        const extras = [n.props.title, n.props.startsAt, n.props.level, n.props.open === true ? "open" : null]
          .filter(Boolean)
          .join(", ");
        return `${n.label} ${n.name} (id=${n.id})${extras ? ` [${extras}]` : ""}`;
      })
      .join("\n");
  }
  return JSON.stringify(result).slice(0, 1200);
}

async function callTool(ctx: Scope, name: string, args: Record<string, unknown>) {
  const fn = GRAPH_TOOLS[name as ToolName];
  if (!fn) throw new Error(`unknown tool ${name}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (fn as any)(ctx, args);
}

export async function* runAgent(ctx: Scope, query: string): AsyncGenerator<AgentEvent> {
  const subgraph: Subgraph = { nodes: [], links: [] };

  if (!isLLMConfigured()) {
    /* No GPU host yet: a deterministic planner drives the same scoped tools. */
    yield { type: "status", text: "local planner (LLM_BASE_URL not set)" };
    const plan = planWithoutLLM(ctx, query);
    const results: { name: string; result: unknown }[] = [];
    for (const step of plan) {
      yield { type: "tool", name: step.name, args: step.args };
      try {
        const result = await callTool(ctx, step.name, step.args);
        mergeSubgraph(subgraph, result);
        results.push({ name: step.name, result });
        yield { type: "tool_result", name: step.name, summary: condense(step.name, result) };
        if (step.name === "draft_intro_email") yield { type: "action", kind: "email", data: result };
        if (step.name === "generate_checklist") yield { type: "action", kind: "checklist", data: result };
      } catch (e) {
        const msg = e instanceof ScopeError ? e.message : (e as Error).message;
        yield { type: "tool_result", name: step.name, summary: `blocked: ${msg}` };
      }
    }
    for (const chunk of narrate(ctx, query, results)) yield { type: "token", text: chunk };
    yield { type: "subgraph", data: subgraph };
    yield { type: "done" };
    return;
  }

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `${SYSTEM_PROMPT}

The current user is ${ctx.name} (id=${ctx.personId}), role=${ctx.role}${
        ctx.subrole ? `/${ctx.subrole}` : ""
      }. When a tool takes person_id and the user means themselves, pass ${ctx.personId}.`,
    },
    { role: "user", content: query },
  ];

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      yield { type: "status", text: step === 0 ? "planning" : "refining" };
      const reply = await chat(messages, TOOL_SCHEMAS);
      if (!reply) throw new Error("empty response from LLM");
      messages.push(reply);

      const calls = reply.tool_calls ?? [];
      if (calls.length === 0) break;

      for (const call of calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          /* malformed args from the model; run with none and let the tool complain */
        }
        yield { type: "tool", name: call.function.name, args };

        let summary: string;
        try {
          const result = await callTool(ctx, call.function.name, args);
          mergeSubgraph(subgraph, result);
          summary = condense(call.function.name, result);
          if (call.function.name === "draft_intro_email") yield { type: "action", kind: "email", data: result };
          if (call.function.name === "generate_checklist") yield { type: "action", kind: "checklist", data: result };
          if (call.function.name === "add_to_calendar") yield { type: "action", kind: "calendar", data: result };
        } catch (e) {
          summary = e instanceof ScopeError ? `blocked by access scope: ${e.message}` : `error: ${(e as Error).message}`;
        }

        yield { type: "tool_result", name: call.function.name, summary };
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: summary,
        });
      }
    }

    yield { type: "subgraph", data: subgraph };
    messages.push({
      role: "user",
      content: "Now answer me directly, in at most six sentences, using only what the tools returned.",
    });
    for await (const token of streamChat(messages)) yield { type: "token", text: token };
    yield { type: "done" };
  } catch (e) {
    yield { type: "error", text: (e as Error).message };
    yield { type: "subgraph", data: subgraph };
    yield { type: "done" };
  }
}
