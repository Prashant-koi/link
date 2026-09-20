import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useMe } from "../hooks/useMe";
import { CourseImport } from "../components/CourseImport";
import { DocumentImport } from "../components/DocumentImport";
import { GithubImport } from "../components/GithubImport";
import { ImportStatusList } from "../components/ImportStatusList";
import { buttonStyle, inputStyle } from "../components/ImportCard";
import type { ImportSummary } from "../types/api";

const ACTIVE_POLL_MS = 1500;
const IDLE_POLL_MS = 8000;

// Onboarding: four sources in, one graph out. Every one of them lands as
// actor_concept.raw_text (plus contexts and edges where the source has them)
// and resolves through the same pipeline a hand-typed interest does — so
// nothing downstream of here knows or cares where a concept came from.
export function Import() {
  const [me, setMe] = useMe();
  const [displayName, setDisplayName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [imports, setImports] = useState<ImportSummary[]>([]);
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!me) return;
    try {
      setImports(await api.listImports(me));
    } catch {
      // A failed poll is not worth a screenful of error on stage; the next
      // tick re-reads.
    }
  }, [me]);

  // Imports are asynchronous by design (an upload never blocks on the
  // model), so the page polls. It polls fast while anything is in flight and
  // backs off once everything has settled.
  useEffect(() => {
    if (!me) return;
    let cancelled = false;

    async function tick() {
      if (cancelled) return;
      await refresh();
      if (cancelled) return;
      timer.current = window.setTimeout(tick, nextDelay());
    }

    function nextDelay(): number {
      return imports.some((i) => i.status === "pending" || i.status === "running")
        ? ACTIVE_POLL_MS
        : IDLE_POLL_MS;
    }

    tick();
    return () => {
      cancelled = true;
      if (timer.current) window.clearTimeout(timer.current);
    };
    // `imports` is deliberately not a dependency: it only tunes the delay,
    // and depending on it would restart the loop on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, refresh]);

  async function handleCreate() {
    if (!displayName.trim() || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const actor = await api.createActor(displayName.trim());
      setMe(actor.id);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  const resolvedTotal = imports.reduce((sum, i) => sum + i.conceptsResolved, 0);

  return (
    <div style={{ maxWidth: 720, display: "grid", gap: 24 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <h1 style={{ fontSize: "var(--fs-xl)", color: "var(--ink-900)" }}>Import</h1>
        <p style={{ fontSize: "var(--fs-base)", color: "var(--ink-600)", lineHeight: "var(--lh-body)" }}>
          Bring in what you've already written down. Everything below turns into interests and shared
          contexts on the same graph — nothing here is a separate profile.
        </p>
      </div>

      {!me ? (
        <section style={{ display: "grid", gap: 12, padding: 20, border: "1px solid var(--ink-200)", borderRadius: 12 }}>
          <h2 style={{ fontSize: "var(--fs-lg)", color: "var(--ink-900)" }}>Start with your name</h2>
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--ink-600)" }}>
            Creates your node in the graph. You can change what's visible in{" "}
            <Link to="/settings">Settings</Link> afterwards.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="Your name"
              style={inputStyle}
            />
            <button
              type="button"
              style={{ ...buttonStyle, opacity: displayName.trim() && !creating ? 1 : 0.5, whiteSpace: "nowrap" }}
              disabled={!displayName.trim() || creating}
              onClick={handleCreate}
            >
              {creating ? "Creating…" : "Create profile"}
            </button>
          </div>
          {createError && <p style={{ fontSize: "var(--fs-sm)", color: "#b3261e" }}>{createError}</p>}
        </section>
      ) : (
        <>
          <DocumentImport
            actorId={me}
            kind="resume"
            title="Résumé"
            blurb="A PDF, or the text pasted straight in. Skills, projects, and research areas are pulled out as interests."
            placeholder="…or paste your résumé text here"
            accept=".pdf,.txt,.md"
            onSubmitted={refresh}
          />

          <DocumentImport
            actorId={me}
            kind="linkedin"
            title="LinkedIn"
            blurb="LinkedIn has no open API, so this takes the profile the way you can actually get it: the PDF export (More → Save to PDF) or the About/Experience text pasted in."
            placeholder="…or paste your headline, about, and experience sections"
            accept=".pdf,.txt,.md"
            onSubmitted={refresh}
          />

          <GithubImport actorId={me} onSubmitted={refresh} />

          <CourseImport actorId={me} onSubmitted={refresh} />

          <section style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
              <h2 style={{ fontSize: "var(--fs-lg)", color: "var(--ink-900)" }}>What's landed</h2>
              {resolvedTotal > 0 && (
                <Link to="/" style={{ fontSize: "var(--fs-sm)", color: "var(--tq-600)" }}>
                  See your constellation →
                </Link>
              )}
            </div>
            <ImportStatusList imports={imports} />
          </section>
        </>
      )}
    </div>
  );
}
