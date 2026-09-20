import type { EventSummary, Reason } from "../types/api";
import { ConceptChip } from "./ConceptChip";
import { ReasonList } from "./ReasonList";

/** The events counterpart to PersonPanel — same drawer, different subject. */
export function EventPanel({
  event,
  reasons,
  demo,
  onClose,
}: {
  event: EventSummary;
  reasons: Reason[];
  demo: boolean;
  onClose: () => void;
}) {
  const when = new Date(event.startsOn);
  const whenLabel = Number.isNaN(when.getTime())
    ? event.startsOn
    : when.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <aside
      role="dialog"
      aria-label={`Details for ${event.title}`}
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
          {event.title}
        </h2>
        <p style={{ fontSize: "var(--fs-base)", color: "var(--ink-600)" }}>
          {[whenLabel, event.venue].filter(Boolean).join(" · ")}
        </p>
      </div>

      {event.topConcepts.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {event.topConcepts.map((chip) => (
            <ConceptChip key={chip.conceptId} chip={chip} />
          ))}
        </div>
      )}

      <ReasonList reasons={reasons} />

      {demo && (
        <p
          style={{
            fontSize: "var(--fs-xs)",
            color: "var(--ink-500)",
            background: "var(--tq-050)",
            borderRadius: 6,
            padding: "8px 10px",
          }}
        >
          Demo data. Events exist in the database as contexts with attendance, but nothing serves them
          yet — so there is no real event to link to here.
        </p>
      )}
    </aside>
  );
}
