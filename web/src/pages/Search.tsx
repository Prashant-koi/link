import { useRef, useState } from "react";
import { api } from "../api/client";
import { ConceptChip } from "../components/ConceptChip";
import { PersonPanel } from "../components/PersonPanel";
import { ReasonList } from "../components/ReasonList";
import type { AspirationMatch, MatchKind } from "../types/api";

const SECTIONS: { kind: MatchKind; title: string }[] = [
  { kind: "mentor", title: "People who have done this" },
  { kind: "peer", title: "People figuring it out right now" },
  { kind: "fellow_explorer", title: "People considering the same jump" },
];

// Resolution is async (the worker embeds and adjudicates a new phrase, a few
// seconds), so poll briefly instead of retrying once and giving up.
const POLL_MS = 1500;
const POLL_MAX = 8;

export function Search() {
  const [query, setQuery] = useState("");
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [matches, setMatches] = useState<AspirationMatch[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = (matches ?? []).find((m) => m.actor.id === selectedId);

  const runId = useRef(0);

  async function runSearch(q: string) {
    const id = ++runId.current;
    for (let attempt = 0; attempt <= POLL_MAX; attempt++) {
      const results = await api.searchAspirations(q);
      if (id !== runId.current) return; // a newer search took over
      setMatches(results);
      if (results.length > 0) return;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setPendingText(query.trim());
    setMatches(null);
    await api.postInterest(query.trim(), "aspiring");
    await runSearch(query.trim());
  }

  return (
    <div>
      <form onSubmit={handleSubmit} style={{ maxWidth: 560, margin: "48px auto 0", textAlign: "center" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="What are you looking into?"
          style={{
            width: "100%",
            fontSize: "var(--fs-lg)",
            textAlign: "center",
            padding: "12px 16px",
            border: "1px solid var(--ink-200)",
            borderRadius: 12,
            background: "var(--surface)",
          }}
        />
      </form>

      {pendingText && (
        <div style={{ maxWidth: 560, margin: "16px auto 0", textAlign: "center" }}>
          {matches && matches[0] ? (
            <ConceptChip chip={matches[0].concept} />
          ) : (
            <span style={{ fontSize: "var(--fs-sm)", color: "var(--ink-500)" }}>{pendingText}</span>
          )}
        </div>
      )}

      <div style={{ marginTop: 40, display: "grid", gap: 32, maxWidth: 720, marginInline: "auto" }}>
        {SECTIONS.map((section) => {
          const items = (matches ?? []).filter((m) => m.matchKind === section.kind);
          if (items.length === 0) return null;
          return (
            <div key={section.kind}>
              <h2 style={{ fontSize: "var(--fs-lg)", color: "var(--ink-900)", marginBottom: 12 }}>
                {section.title}
              </h2>
              <div style={{ display: "grid", gap: 12 }}>
                {items.map((m) => (
                  <button
                    key={m.actor.id}
                    onClick={() => setSelectedId(m.actor.id)}
                    aria-label={`Open details for ${m.actor.displayName}`}
                    style={{
                      border: "1px solid var(--ink-200)",
                      borderRadius: 10,
                      padding: 16,
                      background: "var(--surface)",
                      textAlign: "left",
                      cursor: "pointer",
                      font: "inherit",
                      width: "100%",
                    }}
                  >
                    <div style={{ fontSize: "var(--fs-base)", color: "var(--ink-900)" }}>
                      {m.actor.displayName}
                    </div>
                    <ReasonList reasons={m.reasons} />
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {selected && <PersonPanel actor={selected.actor} reasons={selected.reasons} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
