import type { ConnectionSuggestion } from "../types/api";

const AVATAR_RADIUS = 28;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

// ActorSummary has no photo field today (backend gap, not a frontend
// choice) — every node renders as initials on a --tq-100 circle.
export function PersonNode({
  suggestion,
  x,
  y,
  tabIndex,
  selected,
  onSelect,
}: {
  suggestion: ConnectionSuggestion;
  x: number;
  y: number;
  tabIndex: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { actor } = suggestion;
  const topConcept = actor.topConcepts[0];

  return (
    <g
      transform={`translate(${x}, ${y})`}
      tabIndex={tabIndex}
      role="button"
      aria-label={`${actor.displayName}${topConcept ? `, shared interest: ${topConcept.label}` : ""}`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      style={{ cursor: "pointer" }}
    >
      <circle
        r={AVATAR_RADIUS}
        fill="var(--tq-100)"
        stroke={selected ? "var(--tq-600)" : "none"}
        strokeWidth={selected ? 2 : 0}
      />
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--tq-600)"
        fontSize="var(--fs-base)"
        fontWeight={600}
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {initials(actor.displayName)}
      </text>
      <text
        y={AVATAR_RADIUS + 18}
        textAnchor="middle"
        fill="var(--ink-900)"
        fontSize="var(--fs-sm)"
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {actor.displayName}
      </text>
      {topConcept && (
        <text
          y={AVATAR_RADIUS + 34}
          textAnchor="middle"
          fill="var(--ink-500)"
          fontSize="var(--fs-xs)"
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          {topConcept.shownAs}
        </text>
      )}
    </g>
  );
}
