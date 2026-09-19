"use client";

import { useMemo, useState } from "react";
import { useOS } from "@/lib/client/store";
import { useFetch, Loading } from "./ui";
import type { CalendarItem } from "@/lib/graph/apps";

export function Calendar({ offeringId, courseCode }: { offeringId?: string; courseCode?: string }) {
  const { open } = useOS();
  const [q, setQ] = useState("");
  const url = offeringId ? `/api/apps/calendar?offeringId=${offeringId}` : "/api/apps/calendar";
  const { data, error, loading } = useFetch<CalendarItem[]>(url);

  const items = useMemo(() => {
    const all = data ?? [];
    const needle = q.toLowerCase().trim();
    return needle ? all.filter((i) => `${i.title} ${i.source}`.toLowerCase().includes(needle)) : all;
  }, [data, q]);

  if (loading || error) return <Loading loading={loading} error={error} />;

  const byMonth = new Map<string, CalendarItem[]>();
  for (const i of items) {
    const key = i.at.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(i);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/10 p-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={offeringId ? `Search ${courseCode ?? "course"} deadlines…` : "Search all deadlines and events…"}
          className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm outline-none placeholder:text-slate-500 focus:border-sky-400/60"
        />
        <span className="text-xs text-slate-500">
          {offeringId ? `filtered: ${courseCode ?? offeringId}` : "global"}
        </span>
      </div>

      <div className="flex-1 overflow-auto p-3">
        {[...byMonth].map(([month, group]) => (
          <div key={month} className="mb-4">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">{month}</div>
            <ul className="space-y-1">
              {group.map((i) => (
                <li
                  key={`${i.kind}-${i.id}`}
                  className="flex items-center gap-3 rounded border border-white/10 bg-black/20 px-3 py-2 text-sm"
                >
                  <span className="w-24 shrink-0 text-xs text-slate-400">{i.at.replace("T", " ")}</span>
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${i.kind === "assignment" ? "bg-emerald-400" : "bg-pink-400"}`}
                  />
                  <button
                    onClick={() => i.kind === "event" && open("node", i.title, { id: i.id })}
                    className="flex-1 truncate text-left hover:text-sky-300"
                  >
                    {i.title}
                  </button>
                  <span className="shrink-0 text-[11px] text-slate-500">{i.source}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {items.length === 0 && <div className="p-4 text-sm text-slate-500">Nothing scheduled in your view.</div>}
      </div>
    </div>
  );
}
