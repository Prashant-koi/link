"use client";

import { useState } from "react";
import { post } from "@/lib/client/api";

/** Agentic actions are always proposed, never performed silently. */
export function ActionCard({ kind, data }: { kind: string; data: unknown }) {
  const [state, setState] = useState<"pending" | "sent" | "dismissed">("pending");
  const d = data as Record<string, unknown>;

  if (state === "dismissed") return null;

  if (kind === "email") {
    return (
      <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-xs">
        <div className="mb-1 font-medium text-amber-200">Draft email — not sent</div>
        <div className="text-slate-400">To: {String(d.to)}</div>
        <div className="mb-2 text-slate-400">Subject: {String(d.subject)}</div>
        <pre className="whitespace-pre-wrap font-sans text-slate-200">{String(d.body)}</pre>
        {state === "pending" ? (
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => setState("sent")}
              className="rounded bg-amber-400/80 px-3 py-1 font-medium text-black"
            >
              Confirm &amp; send
            </button>
            <button onClick={() => setState("dismissed")} className="rounded border border-white/15 px-3 py-1">
              Discard
            </button>
          </div>
        ) : (
          <div className="mt-2 text-emerald-300">Sent (simulated).</div>
        )}
      </div>
    );
  }

  if (kind === "checklist") {
    const items = (d.items as string[]) ?? [];
    return (
      <div className="mt-3 rounded-lg border border-sky-400/30 bg-sky-400/5 p-3 text-xs">
        <div className="mb-1 font-medium text-sky-200">{String(d.title)}</div>
        <ul className="list-disc space-y-1 pl-4 text-slate-200">
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (kind === "calendar") {
    const event = d.event as { name?: string } | undefined;
    return (
      <div className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-400/5 p-3 text-xs text-emerald-200">
        Added to your calendar: {event?.name ?? "event"}
      </div>
    );
  }

  return null;
}

/** Inline confirm-then-act button used by the node inspector. */
export function ConfirmAction({
  label,
  body,
  done,
}: {
  label: string;
  body: Record<string, unknown>;
  done: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const [message, setMessage] = useState("");

  if (state === "ok") return <div className="text-xs text-emerald-300">{done}</div>;

  return (
    <div>
      <button
        disabled={state === "busy"}
        onClick={async () => {
          setState("busy");
          try {
            await post("/api/ai/action", body);
            setState("ok");
          } catch (e) {
            setMessage((e as Error).message);
            setState("err");
          }
        }}
        className="rounded border border-white/15 bg-white/5 px-3 py-1 text-xs transition hover:border-sky-400/50"
      >
        {state === "busy" ? "…" : label}
      </button>
      {state === "err" && <div className="mt-1 text-xs text-rose-300">{message}</div>}
    </div>
  );
}
