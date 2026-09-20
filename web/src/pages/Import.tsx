import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { CourseImport } from "../components/CourseImport";
import { DocumentImport } from "../components/DocumentImport";
import { GithubImport } from "../components/GithubImport";
import { ImportStatusList } from "../components/ImportStatusList";
import type { ImportSummary } from "../types/api";

const ACTIVE_POLL_MS = 1500;
const IDLE_POLL_MS = 8000;

// Onboarding: four sources in, one graph out. Every one of them lands as
// actor_concept.raw_text (plus contexts and edges where the source has them)
// and resolves through the same pipeline a hand-typed interest does — so
// nothing downstream of here knows or cares where a concept came from.
//
// This page sits behind RequireAuth (like every other route), so the
// visitor always already has a session actor by the time they get here —
// unlike the imports API itself, which stays reachable pre-session for the
// onboarding case the auth handoff explicitly left out of scope.
export function Import() {
  const { actor } = useAuth();
  const actorId = actor!.id;
  const [imports, setImports] = useState<ImportSummary[]>([]);
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      setImports(await api.listImports(actorId));
    } catch {
      // A failed poll is not worth a screenful of error on stage; the next
      // tick re-reads.
    }
  }, [actorId]);

  // Imports are asynchronous by design (an upload never blocks on the
  // model), so the page polls. It polls fast while anything is in flight and
  // backs off once everything has settled.
  useEffect(() => {
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
  }, [refresh]);

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

      <DocumentImport
        actorId={actorId}
        kind="resume"
        title="Résumé"
        blurb="A PDF, or the text pasted straight in. Skills, projects, and research areas are pulled out as interests."
        placeholder="…or paste your résumé text here"
        accept=".pdf,.txt,.md"
        onSubmitted={refresh}
      />

      <DocumentImport
        actorId={actorId}
        kind="linkedin"
        title="LinkedIn"
        blurb="LinkedIn has no open API, so this takes the profile the way you can actually get it: the PDF export (More → Save to PDF) or the About/Experience text pasted in."
        placeholder="…or paste your headline, about, and experience sections"
        accept=".pdf,.txt,.md"
        onSubmitted={refresh}
      />

      <GithubImport actorId={actorId} onSubmitted={refresh} />

      <CourseImport actorId={actorId} onSubmitted={refresh} />

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
    </div>
  );
}
