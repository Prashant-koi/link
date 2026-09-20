import type { Audience } from "../home/model";

const SEGMENTS: { value: Audience; label: string }[] = [
  { value: "people", label: "People" },
  { value: "societies", label: "Societies" },
  { value: "events", label: "Events" },
];

interface Props {
  value: Audience;
  counts: Record<Audience, number>;
  onChange: (value: Audience) => void;
}

/** Who to show in the interest fields. Same fields, different population. */
export function AudienceToggle({ value, counts, onChange }: Props) {
  return (
    <div
      role="tablist"
      aria-label="What to show on the map"
      style={{
        display: "inline-flex",
        gap: 2,
        padding: 3,
        background: "var(--surface)",
        border: "1px solid var(--ink-200)",
        borderRadius: 999,
        boxShadow: "0 1px 2px rgba(15,23,36,0.04)",
      }}
    >
      {SEGMENTS.map((segment) => {
        const active = segment.value === value;
        return (
          <button
            key={segment.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(segment.value)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              border: "none",
              borderRadius: 999,
              padding: "7px 16px",
              fontSize: "var(--fs-sm)",
              fontWeight: 600,
              cursor: "pointer",
              color: active ? "var(--surface)" : "var(--ink-600)",
              background: active ? "var(--tq-600)" : "transparent",
              transition: "background var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out)",
            }}
          >
            {segment.label}
            <span
              style={{
                fontSize: "var(--fs-xs)",
                fontWeight: 400,
                fontVariantNumeric: "tabular-nums",
                color: active ? "rgba(255,255,255,0.8)" : "var(--ink-400)",
              }}
            >
              {counts[segment.value]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
