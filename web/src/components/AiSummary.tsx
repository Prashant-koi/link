import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { streamSse } from "../api/sse";
import { AiBadge } from "./AiBadge";

// "Learn more" in the profile panel: a short AI summary of what this person does and
// has done, streamed in when asked for (never automatically — it costs a model call).
export function AiSummary({ actorId, name }: { actorId: string; name: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [text, setText] = useState("");
  const [fallback, setFallback] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  async function learnMore() {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setState("loading");
    setText("");
    setFallback(false);
    try {
      await streamSse(
        `/api/ai/profiles/${actorId}/summary`,
        {
          token: (d) => setText((t) => t + d.text),
          replace: (d) => setText(d.text),
          done: (d) => setFallback(!!d.fallback),
        },
        controller.signal,
      );
      setState("done");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setState("error");
    }
  }

  if (state === "idle") {
    return (
      <button
        onClick={learnMore}
        aria-label={`Learn more about ${name} (AI summary)`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          width: "100%",
          padding: "10px 16px",
          borderRadius: 8,
          border: "1px solid var(--tq-300)",
          background: "var(--tq-050)",
          color: "var(--tq-700)",
          fontSize: "var(--fs-base)",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        <Sparkles size={16} aria-hidden="true" />
        Learn more
        <AiBadge />
      </button>
    );
  }

  return (
    <section
      aria-label="AI summary"
      style={{ border: "1px solid var(--tq-100)", background: "var(--tq-050)", borderRadius: 10, padding: 14, display: "grid", gap: 8 }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <AiBadge label="AI summary" />
      </div>
      {state === "error" ? (
        <p style={{ fontSize: "var(--fs-sm)", color: "#b3261e" }}>
          Couldn't write the summary just now.{" "}
          <button onClick={learnMore} style={{ background: "none", border: "none", color: "var(--tq-600)", cursor: "pointer", font: "inherit", textDecoration: "underline" }}>
            Try again
          </button>
        </p>
      ) : (
        <p aria-live="polite" style={{ fontSize: "var(--fs-sm)", color: "var(--ink-900)", lineHeight: 1.55 }}>
          {text || <span className="ai-shimmer" style={{ display: "block", height: 48, borderRadius: 6 }} aria-label="Reading their profile" />}
          {state === "loading" && text && <span aria-hidden="true" style={{ display: "inline-block", width: 6, height: 13, marginLeft: 2, background: "var(--tq-600)", verticalAlign: -2 }} />}
        </p>
      )}
      <p style={{ fontSize: "var(--fs-xs)", color: "var(--ink-500)" }}>
        {fallback ? "A plain summary of what's listed on their profile." : "Written by AI from information they've shared. It can be wrong."}
      </p>
    </section>
  );
}
