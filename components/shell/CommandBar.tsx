"use client";

import { useEffect, useState } from "react";
import { useOS } from "@/lib/client/store";

/** Cmd/Ctrl+K from anywhere. Routes the query into Compass. */
export function CommandBar() {
  const { commandOpen, setCommandOpen, open, scope } = useOS();
  const [value, setValue] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen(true);
      }
      if (e.key === "Escape") setCommandOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setCommandOpen]);

  if (!commandOpen || !scope) return null;

  return (
    <div
      className="fixed inset-0 z-[9500] flex items-start justify-center bg-black/50 pt-[14vh] backdrop-blur-sm"
      onClick={() => setCommandOpen(false)}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!value.trim()) return;
          open("compass", "Compass", { seedQuery: value, nonce: Date.now() });
          setValue("");
          setCommandOpen(false);
        }}
        className="panel w-[min(680px,92vw)] rounded-2xl p-2 shadow-2xl shadow-black/60"
      >
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Ask the university…  (deadlines, labs, people, how am I connected to…)"
          className="w-full bg-transparent px-4 py-3 text-base outline-none placeholder:text-slate-500"
        />
        <div className="flex items-center justify-between border-t border-white/10 px-4 py-2 text-[11px] text-slate-500">
          <span>
            Answering as {scope.name} · {scope.role}
            {scope.subrole ? ` / ${scope.subrole.replace(/_/g, " ")}` : ""}
          </span>
          <span>⏎ to run · esc to close</span>
        </div>
      </form>
    </div>
  );
}
