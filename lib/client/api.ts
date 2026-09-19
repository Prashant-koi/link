"use client";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `request failed (${res.status})`);
  return json as T;
}

export const post = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });

/** Palette shared by the graph view and the app chrome, keyed by node label. */
export const LABEL_COLOR: Record<string, string> = {
  Person: "#7dd3fc",
  Lab: "#a78bfa",
  Club: "#fbbf24",
  Course: "#34d399",
  Offering: "#10b981",
  Event: "#f472b6",
  Position: "#fb7185",
  Paper: "#93c5fd",
  Interest: "#e879f9",
  Goal: "#facc15",
  Department: "#94a3b8",
  Application: "#f97316",
  Assignment: "#6ee7b7",
  Term: "#64748b",
  FinanceRecord: "#4ade80",
  HRRecord: "#c084fc",
};

export const colorFor = (label: string) => LABEL_COLOR[label] ?? "#cbd5e1";
