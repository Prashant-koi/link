import type { ConnectionSuggestion } from "../types/api";
import { ConceptChip } from "./ConceptChip";

export function PersonRow({
  suggestion,
  rank,
  onSelect,
}: {
  suggestion: ConnectionSuggestion;
  rank: number;
  onSelect: () => void;
}) {
  const { actor, reasons } = suggestion;
  const topReason = reasons[0];

  return (
    <button
      onClick={onSelect}
      style={{
        display: "grid",
        gridTemplateColumns: "2rem 1fr",
        gap: 12,
        width: "100%",
        textAlign: "left",
        padding: "12px 8px",
        background: "none",
        border: "none",
        borderBottom: "1px solid var(--ink-200)",
        cursor: "pointer",
      }}
    >
      <span style={{ fontSize: "var(--fs-xs)", color: "var(--ink-500)", fontVariantNumeric: "tabular-nums" }}>
        {rank}
      </span>
      <span style={{ display: "grid", gap: 4 }}>
        <span style={{ fontSize: "var(--fs-base)", color: "var(--ink-900)" }}>{actor.displayName}</span>
        <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {actor.topConcepts.slice(0, 2).map((chip) => (
            <ConceptChip key={chip.conceptId} chip={chip} />
          ))}
        </span>
        {topReason && (
          <span style={{ fontSize: "var(--fs-sm)", color: "var(--ink-500)" }}>
            {topReason.prose ?? topReason.summary}
          </span>
        )}
      </span>
    </button>
  );
}
