"use client";

import { useOS } from "@/lib/client/store";
import type { AppId } from "@/lib/auth/roles";

/** The dock is rendered from the caller's scope. Different login, different OS. */
const APP_META: Record<AppId, { label: string; icon: string; hint: string }> = {
  compass: { label: "Compass", icon: "◎", hint: "Graph explorer" },
  me: { label: "Where I Fit", icon: "◈", hint: "Your neighbourhood" },
  courses: { label: "Courses", icon: "▤", hint: "Term → course → work" },
  calendar: { label: "Calendar", icon: "◷", hint: "Deadlines and events" },
  directory: { label: "Directory", icon: "☷", hint: "People" },
  labs: { label: "Labs", icon: "⬡", hint: "Research groups" },
  clubs: { label: "Clubs", icon: "✦", hint: "Student organizations" },
  goals: { label: "Goals", icon: "◇", hint: "Pathways" },
  admissions: { label: "Admissions", icon: "▦", hint: "Applicant pipeline" },
  finance: { label: "Finance", icon: "$", hint: "Ledger" },
  hr: { label: "HR", icon: "⚯", hint: "Employment records" },
  dean: { label: "Dean", icon: "▲", hint: "Institution dashboard" },
};

export function Dock() {
  const { scope, windows, open, focus } = useOS();
  if (!scope) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[9000] flex justify-center pb-4">
      <div className="panel pointer-events-auto flex items-end gap-1.5 rounded-2xl px-3 py-2 shadow-2xl shadow-black/60">
        {scope.apps.map((app) => {
          const meta = APP_META[app];
          const win = windows.find((w) => w.key === `app:${app}`);
          return (
            <button
              key={app}
              title={`${meta.label} — ${meta.hint}`}
              onClick={() => (win ? focus(win.key) : open(app, meta.label))}
              className="group relative flex w-16 flex-col items-center gap-1 rounded-xl px-1 py-1.5 transition hover:bg-white/10"
            >
              <span className="text-xl leading-none text-sky-200 transition group-hover:scale-110">
                {meta.icon}
              </span>
              <span className="truncate text-[10px] text-slate-300">{meta.label}</span>
              <span
                className={`absolute -bottom-0.5 h-1 w-1 rounded-full ${
                  win ? "bg-sky-300" : "bg-transparent"
                }`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
