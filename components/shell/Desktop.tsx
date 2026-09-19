"use client";

import { useEffect } from "react";
import { api, post } from "@/lib/client/api";
import { useOS } from "@/lib/client/store";
import type { Scope } from "@/lib/auth/roles";
import { Dock } from "./Dock";
import { CommandBar } from "./CommandBar";
import { WindowFrame } from "./WindowFrame";
import { Compass } from "@/components/apps/Compass";
import { Me } from "@/components/apps/Me";
import { Courses } from "@/components/apps/Courses";
import { Calendar } from "@/components/apps/Calendar";
import { Browse } from "@/components/apps/Browse";
import { Goals } from "@/components/apps/Goals";
import { Admissions, DeanDashboard, Finance, HR } from "@/components/apps/Admin";
import { NodeInspector } from "@/components/apps/NodeInspector";
import type { WindowState } from "@/lib/client/store";

function render(win: WindowState) {
  const p = win.payload ?? {};
  switch (win.app) {
    case "compass":
      return <Compass key={String(p.nonce ?? "")} seedQuery={p.seedQuery as string | undefined} />;
    case "me":
      return <Me />;
    case "courses":
      return <Courses />;
    case "calendar":
      return <Calendar offeringId={p.offeringId as string | undefined} courseCode={p.courseCode as string | undefined} />;
    case "directory":
      return <Browse label="Person" title="People" />;
    case "labs":
      return <Browse label="Lab" title="Labs & research" />;
    case "clubs":
      return <Browse label="Club" title="Clubs" />;
    case "goals":
      return <Goals />;
    case "admissions":
      return <Admissions />;
    case "finance":
      return <Finance />;
    case "hr":
      return <HR />;
    case "dean":
      return <DeanDashboard />;
    case "node":
      return <NodeInspector id={String(p.id ?? "")} />;
    default:
      return null;
  }
}

export function Desktop() {
  const { scope, llm, windows, open, setSession, setCommandOpen, reset } = useOS();

  /* open the right first window for whoever just logged in */
  useEffect(() => {
    if (!scope || windows.length > 0) return;
    if (scope.apps.includes("me")) open("me", "Where I Fit");
    else if (scope.apps.includes("admissions")) open("admissions", "Admissions Console");
    else if (scope.apps.includes("dean")) open("dean", "Dean Dashboard");
    else if (scope.apps.includes("finance")) open("finance", "Finance");
    else if (scope.apps.includes("hr")) open("hr", "HR");
    else open("compass", "Compass");
  }, [scope, windows.length, open]);

  if (!scope) return null;

  const switchUser = async () => {
    await post("/api/auth/logout", {});
    reset();
    setSession(null);
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <div className="panel absolute inset-x-0 top-0 z-[9001] flex items-center gap-3 border-x-0 border-t-0 px-4 py-1.5 text-xs">
        <span className="font-semibold tracking-tight text-slate-100">StudentOS</span>
        <span className="text-slate-500">|</span>
        <span className="text-slate-300">{scope.name}</span>
        <span className="rounded-full bg-sky-400/15 px-2 py-0.5 text-[10px] text-sky-200">
          {scope.role}
          {scope.subrole ? ` · ${scope.subrole.replace(/_/g, " ")}` : ""}
        </span>
        <span className="text-slate-500">{scope.apps.length} apps in scope</span>
        <div className="flex-1" />
        <span className="text-[10px] text-slate-500">
          {llm.configured ? `vLLM: ${llm.model}` : "LLM offline — local planner"}
        </span>
        <button
          onClick={() => setCommandOpen(true)}
          className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-slate-300 transition hover:border-sky-400/50"
        >
          ⌘K
        </button>
        <button
          onClick={switchUser}
          className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-slate-300 transition hover:border-sky-400/50"
        >
          Switch user
        </button>
      </div>

      <div className="absolute inset-0 pt-8">
        {windows.map((w) => (
          <WindowFrame key={w.key} win={w}>
            {render(w)}
          </WindowFrame>
        ))}
      </div>

      <Dock />
      <CommandBar />
    </div>
  );
}
