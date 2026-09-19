"use client";

import { useFetch, Loading, Panel, Table } from "./ui";

/* The role-gated consoles. They only render because the dock only offered them,
   and they only return data because the query layer allowed it. */

export function Admissions() {
  const { data, error, loading } = useFetch<Record<string, string | number | null>[]>("/api/apps/admissions");
  if (loading || error) return <Loading loading={loading} error={error} />;
  const rows = data ?? [];
  const stages = ["received", "in_review", "interview", "decision_pending", "admitted", "waitlisted"];

  return (
    <div className="space-y-3 p-3">
      <div className="grid grid-cols-6 gap-2">
        {stages.map((s) => (
          <div key={s} className="rounded-lg border border-white/10 bg-black/20 p-2 text-center">
            <div className="text-lg font-semibold text-orange-300">
              {rows.filter((r) => r.stage === s).length}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">{s.replace(/_/g, " ")}</div>
          </div>
        ))}
      </div>
      <Panel title="Applicant pipeline">
        <Table
          columns={["Application", "Applicant", "Program", "Stage", "GPA", "Reviewer", "Submitted"]}
          rows={rows.map((r) => [r.name, r.applicant, r.program, String(r.stage).replace(/_/g, " "), r.gpa, r.reviewer, r.submittedAt])}
        />
      </Panel>
    </div>
  );
}

export function Finance() {
  const { data, error, loading } = useFetch<Record<string, string | number | null>[]>("/api/apps/finance");
  if (loading || error) return <Loading loading={loading} error={error} />;
  const rows = data ?? [];
  const budgets = rows.filter((r) => r.budget != null);
  const accounts = rows.filter((r) => r.budget == null);

  return (
    <div className="space-y-3 p-3">
      <Panel title="Department budgets">
        <Table
          columns={["Department", "Fiscal year", "Budget"]}
          rows={budgets.map((r) => [r.holder, r.fiscalYear, `$${Number(r.budget).toLocaleString()}`])}
        />
      </Panel>
      <Panel title="Student accounts">
        <Table
          columns={["Student", "Term", "Balance", "Aid"]}
          rows={accounts.map((r) => [
            r.holder,
            r.term,
            `$${Number(r.tuitionBalance ?? 0).toLocaleString()}`,
            `$${Number(r.aidPackage ?? 0).toLocaleString()}`,
          ])}
        />
      </Panel>
    </div>
  );
}

export function HR() {
  const { data, error, loading } = useFetch<Record<string, string | number | null>[]>("/api/apps/hr");
  if (loading || error) return <Loading loading={loading} error={error} />;
  return (
    <div className="p-3">
      <Panel title="Employment records">
        <Table
          columns={["Person", "Role", "Department", "Type", "Band", "Start"]}
          rows={(data ?? []).map((r) => [
            r.person,
            `${r.role}${r.subrole ? ` / ${r.subrole}` : ""}`,
            r.department,
            r.employmentType,
            r.salaryBand,
            r.startDate,
          ])}
        />
      </Panel>
    </div>
  );
}

interface Dean {
  departments: { id: string; name: string; faculty: number; labs: number; courses: number }[];
  deptGoals: { department: string; goal: string; horizon: string; interests: string[] }[];
  topInterests: { interest: string; people: number; avgStrength: number }[];
  openings: { lab: string; openings: number }[];
}

export function DeanDashboard() {
  const { data, error, loading } = useFetch<Dean>("/api/apps/dean");
  if (loading || error) return <Loading loading={loading} error={error} />;
  if (!data) return null;

  return (
    <div className="space-y-3 overflow-auto p-3">
      <div className="grid grid-cols-3 gap-2">
        {data.departments.map((d) => (
          <div key={d.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="text-sm font-medium text-slate-100">{d.name}</div>
            <div className="mt-1 text-[11px] text-slate-400">
              {d.faculty} faculty · {d.labs} labs · {d.courses} courses
            </div>
          </div>
        ))}
      </div>

      <Panel title="Department goals">
        <Table
          columns={["Department", "Goal", "Horizon", "Interests"]}
          rows={data.deptGoals.map((g) => [g.department, g.goal, g.horizon, g.interests.join(", ")])}
        />
      </Panel>

      <div className="grid grid-cols-2 gap-3">
        <Panel title="Where attention is (interest density)">
          <div className="space-y-1.5">
            {data.topInterests.map((i) => (
              <div key={i.interest} className="flex items-center gap-2 text-xs">
                <span className="w-44 truncate text-slate-300">{i.interest}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-fuchsia-400/70"
                    style={{ width: `${(i.people / (data.topInterests[0]?.people || 1)) * 100}%` }}
                  />
                </div>
                <span className="w-8 text-right text-slate-400">{i.people}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Open research positions">
          <Table columns={["Lab", "Openings"]} rows={data.openings.map((o) => [o.lab, o.openings])} />
        </Panel>
      </div>
    </div>
  );
}
