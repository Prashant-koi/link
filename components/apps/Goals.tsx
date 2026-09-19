"use client";

import { useOS } from "@/lib/client/store";
import { useFetch, Loading, Panel } from "./ui";

interface Goal {
  id: string; name: string; type: string; horizon: string;
  owner: string; ownerId: string; interests: string[];
}

/** Goals / Pathways — each goal is an intent ABOUT an interest, so the graph can map onto it. */
export function Goals() {
  const { scope, open } = useOS();
  const { data, error, loading } = useFetch<Goal[]>("/api/apps/goals");
  if (loading || error) return <Loading loading={loading} error={error} />;

  const goals = data ?? [];
  const mine = goals.filter((g) => g.ownerId === scope?.personId);
  const others = goals.filter((g) => g.ownerId !== scope?.personId);

  const card = (g: Goal) => (
    <div key={g.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="text-sm text-slate-100">{g.name}</div>
      <div className="mt-1 text-[11px] text-slate-500">
        {g.owner} · {g.type} · {g.horizon}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {g.interests.map((i) => (
          <button
            key={i}
            onClick={() => open("compass", "Compass", { seedQuery: `what should I do about ${i}?` })}
            className="rounded-full bg-fuchsia-400/15 px-2 py-0.5 text-[11px] text-fuchsia-200 hover:bg-fuchsia-400/25"
          >
            {i}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-3 overflow-auto p-3">
      <Panel title="Your goals">
        <div className="space-y-2">{mine.map(card)}</div>
        {mine.length === 0 && <div className="text-xs text-slate-500">No goals recorded.</div>}
      </Panel>
      {others.length > 0 && (
        <Panel title="Goals you can see">
          <div className="space-y-2">{others.map(card)}</div>
        </Panel>
      )}
    </div>
  );
}
