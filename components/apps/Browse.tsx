"use client";

import { useEffect, useState } from "react";
import { post } from "@/lib/client/api";
import { useOS } from "@/lib/client/store";
import type { Subgraph } from "@/lib/graph/types";

/** Directory / Labs / Clubs — public-layer browsers over the same scoped search. */
export function Browse({ label, title }: { label: string; title: string }) {
  const { open } = useOS();
  const [q, setQ] = useState("");
  const [data, setData] = useState<Subgraph>({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    post<Subgraph>("/api/graph/search", { query_terms: q, labels: [label], limit: 60 })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [q, label]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/10 p-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${title.toLowerCase()}…`}
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm outline-none placeholder:text-slate-500 focus:border-sky-400/60"
        />
      </div>
      <div className="flex-1 overflow-auto p-3">
        {error && <div className="text-sm text-rose-300">{error}</div>}
        {loading && <div className="text-sm text-slate-400">loading…</div>}
        <ul className="grid grid-cols-2 gap-2">
          {data.nodes.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => open("node", n.name, { id: n.id })}
                className="w-full rounded-lg border border-white/10 bg-black/20 p-3 text-left transition hover:border-sky-400/40"
              >
                <div className="truncate text-sm text-slate-100">{n.name}</div>
                <div className="truncate text-[11px] text-slate-500">
                  {String(n.props.title ?? n.props.summary ?? n.props.role ?? n.props.kind ?? "")}
                </div>
              </button>
            </li>
          ))}
        </ul>
        {!loading && data.nodes.length === 0 && (
          <div className="p-4 text-sm text-slate-500">Nothing in your view.</div>
        )}
      </div>
    </div>
  );
}
