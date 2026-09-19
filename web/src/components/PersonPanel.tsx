import { useState } from "react";
import type { ActorSummary, IntroState, Reason } from "../types/api";
import { api } from "../api/client";
import { ConceptChip } from "./ConceptChip";
import { ReasonList } from "./ReasonList";
import { ContactBlock } from "./ContactBlock";

// The §5 detail panel: opens beside the constellation/list rather than
// navigating away, so "why this person" never disappears.
export function PersonPanel({
  actor,
  reasons,
  meId,
  onClose,
}: {
  actor: ActorSummary;
  reasons: Reason[];
  meId: string;
  onClose: () => void;
}) {
  const [introState, setIntroState] = useState<IntroState | null>(null);

  async function handleRequestIntro() {
    if (!meId) return;
    const { state } = await api.requestIntro(meId, actor.id);
    setIntroState(state);
  }

  return (
    <aside
      role="dialog"
      aria-label={`Details for ${actor.displayName}`}
      className="person-panel"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "min(360px, 100vw)",
        background: "var(--surface)",
        borderLeft: "1px solid var(--ink-200)",
        padding: 24,
        overflowY: "auto",
        display: "grid",
        gap: 16,
        alignContent: "start",
      }}
    >
      <button
        onClick={onClose}
        aria-label="Close panel"
        style={{
          justifySelf: "end",
          background: "none",
          border: "none",
          fontSize: "var(--fs-base)",
          color: "var(--ink-500)",
          cursor: "pointer",
        }}
      >
        Close
      </button>

      <div>
        <h2 style={{ fontSize: "var(--fs-lg)", lineHeight: "var(--lh-tight)", color: "var(--ink-900)" }}>
          {actor.displayName}
        </h2>
        <p style={{ fontSize: "var(--fs-base)", color: "var(--ink-600)" }}>
          {[actor.personKind, actor.homeUnit?.name].filter(Boolean).join(" · ") || actor.kind}
        </p>
      </div>

      {actor.topConcepts.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {actor.topConcepts.map((chip) => (
            <ConceptChip key={chip.conceptId} chip={chip} />
          ))}
        </div>
      )}

      <ReasonList reasons={reasons} />

      <div>
        {introState ? (
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--ink-500)" }}>Intro {introState}.</p>
        ) : (
          <ContactBlock actor={actor} onRequestIntro={handleRequestIntro} />
        )}
      </div>
    </aside>
  );
}
