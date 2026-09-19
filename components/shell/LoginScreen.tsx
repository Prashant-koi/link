"use client";

import { useState } from "react";
import { api, post } from "@/lib/client/api";
import { useOS } from "@/lib/client/store";
import type { Scope } from "@/lib/auth/roles";

interface Persona { id: string; name: string; role: string; subrole: string | null; dept: string }

const BLURB: Record<string, string> = {
  student: "Own enrollments, goals and the whole public layer.",
  prof: "Own offerings, rosters, lab and advisees.",
  assoc_prof: "Own offerings, rosters, lab and advisees.",
  phd_student: "Offerings they TA, their lab, the public layer.",
  admissions: "The applicant pipeline — and nothing student-owned.",
  finance: "Tuition, aid and department budgets.",
  hr: "Employment records for faculty and staff.",
  deans_office: "Org structure, department goals, cross-cutting views.",
  registrar: "Enrollment administration.",
};

export function LoginScreen() {
  const { setSession } = useOS();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [personas, setPersonas] = useState<Persona[] | null>(null);

  if (personas === null) {
    api<{ personas: Persona[] }>("/api/auth/personas")
      .then((d) => setPersonas(d.personas))
      .catch((e) =>
        setError(
          `${(e as Error).message} — is Neo4j up and seeded?  docker compose up -d neo4j && npm run seed`,
        ),
      );
  }

  const login = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const { scope } = await post<{ scope: Scope }>("/api/auth/login", { personId: id });
      const me = await api<{ llm: { configured: boolean; model: string | null } }>("/api/auth/me");
      setSession(scope, me.llm);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center p-6">
      <div className="panel w-[min(920px,95vw)] rounded-2xl p-7 shadow-2xl shadow-black/60">
        <div className="text-2xl font-semibold tracking-tight">StudentOS</div>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          One university, modeled as a connected graph. Pick who you are — the dock, the data and the
          answers all change, because access scope is part of the model rather than a coat of paint on it.
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-rose-400/30 bg-rose-400/10 p-3 text-xs text-rose-200">
            {error}
          </div>
        )}

        <div className="mt-5 grid max-h-[55vh] grid-cols-2 gap-2 overflow-auto md:grid-cols-3">
          {(personas ?? []).map((p) => (
            <button
              key={p.id}
              disabled={busy !== null}
              onClick={() => login(p.id)}
              className="rounded-xl border border-white/10 bg-black/25 p-3 text-left transition hover:border-sky-400/50 hover:bg-white/5 disabled:opacity-50"
            >
              <div className="truncate text-sm font-medium text-slate-100">{p.name}</div>
              <div className="text-[11px] text-sky-300/80">
                {p.role}
                {p.subrole ? ` · ${p.subrole.replace(/_/g, " ")}` : ""}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">{p.dept}</div>
              <div className="mt-1.5 text-[10px] leading-snug text-slate-600">
                {BLURB[p.subrole ?? p.role] ?? ""}
              </div>
              {busy === p.id && <div className="mt-1 text-[10px] text-sky-300">signing in…</div>}
            </button>
          ))}
          {personas === null && !error && <div className="p-4 text-sm text-slate-400">loading personas…</div>}
        </div>
      </div>
    </div>
  );
}
