"use client";

import { useOS } from "@/lib/client/store";
import { colorFor } from "@/lib/client/api";
import { useFetch, Loading, Panel } from "./ui";
import { GraphView } from "@/components/graph/GraphView";
import type { GraphNode, Subgraph } from "@/lib/graph/types";

interface Rec {
  subgraph: Subgraph;
  interests: string[];
  ranked: { node: GraphNode; score: number; shared: string[] }[];
}

/** "Where do I fit" — the personalized read of the graph, with the paths shown. */
export function Me() {
  const { scope, open } = useOS();
  const { data, error, loading } = useFetch<Rec>("/api/graph/recommend?limit=30");
  const goals = useFetch<{ id: string; name: string; type: string; horizon: string; interests: string[]; ownerId: string }[]>(
    "/api/apps/goals",
  );

  if (loading || error) return <Loading loading={loading} error={error} />;
  if (!data) return null;

  const mine = (goals.data ?? []).filter((g) => g.ownerId === scope?.personId);
  const byLabel = new Map<string, Rec["ranked"]>();
  for (const r of data.ranked) {
    if (!byLabel.has(r.node.label)) byLabel.set(r.node.label, []);
    byLabel.get(r.node.label)!.push(r);
  }

  return (
    <div className="grid h-full grid-cols-2">
      <div className="space-y-3 overflow-auto p-3">
        <div>
          <div className="text-lg font-semibold">{scope?.name}</div>
          <div className="text-xs text-slate-400">
            {scope?.role}
            {scope?.subrole ? ` · ${scope.subrole.replace(/_/g, " ")}` : ""}
          </div>
        </div>

        <Panel title="Interests driving this">
          <div className="flex flex-wrap gap-1.5">
            {data.interests.slice(0, 12).map((i) => (
              <span key={i} className="rounded-full bg-fuchsia-400/15 px-2 py-0.5 text-[11px] text-fuchsia-200">
                {i}
              </span>
            ))}
            {data.interests.length === 0 && <span className="text-xs text-slate-500">No interests recorded yet.</span>}
          </div>
        </Panel>

        {mine.length > 0 && (
          <Panel title="Your goals">
            <ul className="space-y-1.5">
              {mine.map((g) => (
                <li key={g.id} className="text-sm">
                  <span className="text-slate-200">{g.name}</span>
                  <span className="ml-2 text-[11px] text-slate-500">
                    {g.type} · {g.horizon} · {g.interests.join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {[...byLabel].map(([label, items]) => (
          <Panel key={label} title={label}>
            <ul className="space-y-1.5">
              {items.slice(0, 8).map((r) => (
                <li key={r.node.id}>
                  <button
                    onClick={() => open("node", r.node.name, { id: r.node.id })}
                    className="group w-full text-left"
                  >
                    <span className="text-sm text-slate-100 group-hover:text-sky-300">{r.node.name}</span>
                    <span className="ml-2 text-[11px] text-slate-500">
                      via {r.shared.slice(0, 3).join(", ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>

      <div className="border-l border-white/10">
        <GraphView
          data={data.subgraph}
          highlight={scope?.personId}
          onNodeClick={(id) => open("node", "Node", { id })}
        />
      </div>
    </div>
  );
}
