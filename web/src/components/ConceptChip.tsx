import type { ConceptChip as ConceptChipData } from "../types/api";

const RARITY_EMPHASIS_THRESHOLD = 0.7;

// Rare shared interests stand out from common ones without any explanatory
// text — the emphasis threshold is the entire mechanism.
export function ConceptChip({ chip }: { chip: ConceptChipData }) {
  const emphasised = chip.rarity > RARITY_EMPHASIS_THRESHOLD;

  return (
    <span
      style={{
        display: "inline-block",
        fontSize: "var(--fs-sm)",
        padding: "2px 10px",
        borderRadius: 999,
        background: emphasised ? "var(--tq-100)" : "var(--surface)",
        color: emphasised ? "var(--tq-600)" : "var(--ink-500)",
        border: emphasised ? "none" : "1px solid var(--ink-200)",
      }}
      title={chip.label !== chip.shownAs ? chip.label : undefined}
    >
      {chip.shownAs}
    </span>
  );
}
