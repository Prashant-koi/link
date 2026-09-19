"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";

export function useFetch<T>(url: string | null): { data: T | null; error: string | null; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(url));

  useEffect(() => {
    if (!url) return;
    let alive = true;
    setLoading(true);
    api<T>(url)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [url]);

  return { data, error, loading };
}

export function Panel({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      {title && <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</div>}
      {children}
    </div>
  );
}

export function Loading({ error, loading }: { error: string | null; loading: boolean }) {
  if (loading) return <div className="p-6 text-sm text-slate-400">loading…</div>;
  if (error)
    return (
      <div className="m-4 rounded-lg border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200">
        {error}
      </div>
    );
  return null;
}

export function Table({ columns, rows }: { columns: string[]; rows: (string | number | null)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-white/10 text-slate-400">
            {columns.map((c) => (
              <th key={c} className="px-2 py-1.5 font-medium">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-white/5 hover:bg-white/5">
              {r.map((cell, j) => (
                <td key={j} className="px-2 py-1.5 text-slate-200">{cell ?? "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="p-4 text-xs text-slate-500">Nothing in your view.</div>}
    </div>
  );
}
