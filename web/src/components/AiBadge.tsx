import { Sparkles } from "lucide-react";

// The mark that says "an AI wrote this" — the same sparkle as the AI tab, so it is
// recognisable everywhere AI text appears.
export function AiBadge({ label = "AI" }: { label?: string }) {
  return (
    <span
      title="Written by the local AI model from profile information"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 8px 1px 6px",
        borderRadius: 999,
        background: "var(--tq-100)",
        color: "var(--tq-700)",
        fontSize: "var(--fs-xs)",
        fontWeight: 600,
        lineHeight: 1.5,
      }}
    >
      <Sparkles size={12} aria-hidden="true" />
      {label}
    </span>
  );
}
