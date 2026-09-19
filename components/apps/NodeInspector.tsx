"use client";

import { useOS } from "@/lib/client/store";
import { colorFor } from "@/lib/client/api";
import { useFetch, Loading } from "./ui";
import { ConfirmAction } from "./ActionCard";
import type { GraphNode, Subgraph } from "@/lib/graph/types";

interface Detail {
  center: GraphNode;
  subgraph: Subgraph;
  facts: string[];
}

const HIDDEN_PROPS = new Set(["id", "name"]);

export function NodeInspector({ id }: { id: string }) {
  const { scope, open } = useOS();
  const { data, error, loading } = useFetch<Detail>(id ? `/api/graph/node/${id}` : null);
  if (loading || error) return <Loading loading={loading} error={error} />;
  if (!data) return null;

  const { center, subgraph } = data;
  const neighbours = subgraph.nodes.filter((n) => n.id !== center.id);

  return (
    <div className="space-y-3 p-4 text-sm">
      <div>
        <span
          className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
          style={{ background: colorFor(center.label) }}
        />
        <span className="text-[11px] uppercase tracking-wider text-slate-400">{center.label}</span>
        <div className="text-lg font-semibold text-slate-100">{center.name}</div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {Object.entries(center.props)
          .filter(([k, v]) => !HIDDEN_PROPS.has(k) && v !== null && v !== "")
          .slice(0, 10)
          .map(([k, v]) => (
            <div key={k} className="truncate">
              <span className="text-slate-500">{k}: </span>
              <span className="text-slate-200">{String(v)}</span>
            </div>
          ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => open("compass", "Compass", { seedQuery: `how am I connected to ${center.name}?` })}
          className="rounded border border-white/15 bg-white/5 px-3 py-1 text-xs transition hover:border-sky-400/50"
        >
          How am I connected?
        </button>
        {center.label === "Person" && scope?.capabilities.includes("draft_intro_email") && (
          <ConfirmAction
            label="Draft intro email"
            body={{ action: "draft_intro_email", person_id: center.id }}
            done="Draft created — see Compass."
          />
        )}
        {center.label === "Event" && scope?.capabilities.includes("add_to_calendar") && (
          <ConfirmAction
            label="Add to my calendar"
            body={{ action: "add_to_calendar", event_id: center.id }}
            done="Added to your calendar."
          />
        )}
        {center.label === "Goal" && scope?.capabilities.includes("generate_checklist") && (
          <ConfirmAction
            label="Generate checklist"
            body={{ action: "generate_checklist", goal_id: center.id }}
            done="Checklist generated."
          />
        )}
      </div>

      <div>
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Connected ({neighbours.length})
        </div>
        <ul className="space-y-1">
          {neighbours.slice(0, 40).map((n) => {
            const link = subgraph.links.find(
              (l) => (l.source === center.id && l.target === n.id) || (l.target === center.id && l.source === n.id),
            );
            return (
              <li key={n.id}>
                <button
                  onClick={() => open("node", n.name, { id: n.id })}
                  className="group flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left hover:bg-white/5"
                >
                  <span className="text-[10px] text-slate-500">
                    {link?.type.toLowerCase().replace(/_/g, " ") ?? "linked"}
                  </span>
                  <span className="truncate text-xs text-slate-200 group-hover:text-sky-300">{n.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
