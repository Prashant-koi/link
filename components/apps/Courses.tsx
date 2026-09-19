"use client";

import { useState } from "react";
import { useOS } from "@/lib/client/store";
import { useFetch, Loading } from "./ui";
import type { CourseFolder } from "@/lib/graph/apps";

/** The LMS-lite folder tree. One window among many, deliberately. */
export function Courses() {
  const { open } = useOS();
  const { data, error, loading } = useFetch<CourseFolder[]>("/api/apps/courses");
  const [selected, setSelected] = useState<string | null>(null);

  if (loading || error) return <Loading loading={loading} error={error} />;
  const folders = data ?? [];
  const byTerm = new Map<string, CourseFolder[]>();
  for (const f of folders) {
    if (!byTerm.has(f.term)) byTerm.set(f.term, []);
    byTerm.get(f.term)!.push(f);
  }
  const current = folders.find((f) => f.offeringId === selected) ?? folders[0];

  return (
    <div className="grid h-full grid-cols-3">
      <div className="overflow-auto border-r border-white/10 p-2 text-sm">
        {[...byTerm].map(([term, items]) => (
          <div key={term} className="mb-3">
            <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-slate-400">{term}</div>
            {items.map((f) => (
              <button
                key={f.offeringId}
                onClick={() => setSelected(f.offeringId)}
                className={`block w-full truncate rounded px-2 py-1.5 text-left transition hover:bg-white/10 ${
                  current?.offeringId === f.offeringId ? "bg-white/10 text-sky-200" : "text-slate-200"
                }`}
              >
                {f.code}
                <span className="ml-1.5 text-[10px] text-slate-500">{f.role}</span>
              </button>
            ))}
          </div>
        ))}
        {folders.length === 0 && <div className="p-3 text-xs text-slate-500">No courses in your view.</div>}
      </div>

      <div className="col-span-2 overflow-auto p-4">
        {current && (
          <>
            <div className="text-lg font-semibold">
              {current.code} <span className="text-slate-400">{current.title}</span>
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {current.term} · {current.instructor ?? "staff"} · {current.meets ?? "TBA"}
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => open("calendar", `Deadlines — ${current.code}`, { offeringId: current.offeringId, courseCode: current.code })}
                className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs transition hover:border-sky-400/50"
              >
                Deadlines →
              </button>
              <button
                onClick={() => open("compass", "Compass", { seedQuery: `who else is connected to ${current.code}?` })}
                className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs transition hover:border-sky-400/50"
              >
                Explore in Compass →
              </button>
            </div>

            <div className="mt-5">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Assignments</div>
              <ul className="space-y-1.5">
                {current.assignments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between rounded border border-white/10 bg-black/20 px-3 py-2 text-sm">
                    <span>{a.title}</span>
                    <span className="text-xs text-slate-400">due {a.dueAt}</span>
                  </li>
                ))}
              </ul>
              {current.assignments.length === 0 && <div className="text-xs text-slate-500">No assignments posted.</div>}
            </div>

            <div className="mt-5">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Notes (AI)</div>
              <div className="rounded border border-dashed border-white/15 p-3 text-xs text-slate-500">
                Generated notes land here once a model is attached to the offering.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
