"use client";

import { useCallback, useRef, useState } from "react";
import { GraphView } from "@/components/graph/GraphView";
import { askAgent } from "@/lib/client/agentStream";
import { useOS } from "@/lib/client/store";
import type { AgentEvent } from "@/lib/ai/agent";
import type { Subgraph } from "@/lib/graph/types";
import { ActionCard } from "@/components/apps/ActionCard";

const SUGGESTIONS: Record<string, string[]> = {
  student: [
    "find a research group in computational biology with openings for undergrads",
    "where do I fit in?",
    "how am I connected to the Systems Lab?",
    "what seminars this month match my interests?",
  ],
  faculty: ["who in my department works on security?", "where do I fit in?", "which students share my interests?"],
  staff: ["show me the applicant pipeline", "which labs have open undergraduate positions?", "where do I fit in?"],
};

export function Compass({ seedQuery }: { seedQuery?: string }) {
  const { scope, open } = useOS();
  const [query, setQuery] = useState(seedQuery ?? "");
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<AgentEvent[]>([]);
  const [answer, setAnswer] = useState("");
  const [graph, setGraph] = useState<Subgraph>({ nodes: [], links: [] });
  const [actions, setActions] = useState<{ kind: string; data: unknown }[]>([]);
  const abort = useRef<AbortController | null>(null);

  const run = useCallback(
    async (q: string) => {
      if (!q.trim() || running) return;
      abort.current?.abort();
      abort.current = new AbortController();
      setRunning(true);
      setLog([]);
      setAnswer("");
      setActions([]);
      setGraph({ nodes: [], links: [] });

      await askAgent(
        q,
        (e) => {
          if (e.type === "token") setAnswer((a) => a + e.text);
          else if (e.type === "subgraph") setGraph(e.data);
          else if (e.type === "action") setActions((a) => [...a, { kind: e.kind, data: e.data }]);
          else setLog((l) => [...l, e]);
        },
        abort.current.signal,
      );
      setRunning(false);
    },
    [running],
  );

  const suggestions = SUGGESTIONS[scope?.role ?? "student"] ?? SUGGESTIONS.student;

  return (
    <div className="flex h-full flex-col">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(query);
        }}
        className="flex gap-2 border-b border-white/10 p-3"
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask the university anything…"
          className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none placeholder:text-slate-500 focus:border-sky-400/60"
        />
        <button
          type="submit"
          disabled={running}
          className="rounded-lg bg-sky-500/80 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-400 disabled:opacity-40"
        >
          {running ? "…" : "Ask"}
        </button>
      </form>

      {!answer && !running && (
        <div className="flex flex-wrap gap-2 border-b border-white/10 p-3">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => {
                setQuery(s);
                void run(s);
              }}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300 transition hover:border-sky-400/50 hover:text-white"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-5">
        <div className="col-span-3 border-r border-white/10">
          <GraphView data={graph} onNodeClick={(id) => open("node", "Node", { id })} />
        </div>
        <div className="col-span-2 flex min-h-0 flex-col overflow-auto p-3 text-sm">
          {log.length > 0 && (
            <div className="mb-3 space-y-1 rounded-lg border border-white/10 bg-black/25 p-2 font-mono text-[10px] text-slate-400">
              {log.map((e, i) => (
                <div key={i}>
                  {e.type === "tool" && <span className="text-sky-300">→ {e.name}({JSON.stringify(e.args).slice(0, 70)})</span>}
                  {e.type === "tool_result" && <span className="text-emerald-300/80">← {e.summary.split("\n")[0].slice(0, 70)}</span>}
                  {e.type === "status" && <span>· {e.text}</span>}
                  {e.type === "error" && <span className="text-rose-300">! {e.text}</span>}
                </div>
              ))}
            </div>
          )}
          <div className="whitespace-pre-wrap leading-relaxed text-slate-200">
            {answer || (running ? "traversing…" : "")}
          </div>
          {actions.map((a, i) => (
            <ActionCard key={i} kind={a.kind} data={a.data} />
          ))}
        </div>
      </div>
    </div>
  );
}
