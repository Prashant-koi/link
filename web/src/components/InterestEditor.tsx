import { useState } from "react";
import type { Stance } from "../types/api";
import { api } from "../api/client";
import { StanceSelect } from "./StanceSelect";

// Shared between Settings (default stance 'established', stance selector
// shown) and Search (default 'aspiring', selector hidden) — same
// interaction, different defaults, per the components spec.
export function InterestEditor({
  defaultStance,
  showStanceSelector = false,
  placeholder = "Add an interest",
  onSubmitted,
}: {
  defaultStance: Stance;
  showStanceSelector?: boolean;
  placeholder?: string;
  onSubmitted?: (rawText: string, stance: Stance) => void;
}) {
  const [rawText, setRawText] = useState("");
  const [stance, setStance] = useState<Stance>(defaultStance);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rawText.trim()) return;
    setSubmitting(true);
    try {
      // Resolution is async — never block the input on the model. This
      // accepts immediately; the concept chip fills in on a later fetch.
      await api.postInterest(rawText.trim(), stance);
      onSubmitted?.(rawText.trim(), stance);
      setRawText("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <input
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1,
          fontSize: "var(--fs-base)",
          padding: "8px 12px",
          border: "1px solid var(--ink-200)",
          borderRadius: 8,
        }}
      />
      {showStanceSelector && <StanceSelect value={stance} onChange={setStance} />}
      <button
        type="submit"
        disabled={submitting || !rawText.trim()}
        style={{
          background: "var(--tq-600)",
          color: "var(--surface)",
          border: "none",
          borderRadius: 8,
          padding: "8px 16px",
          fontSize: "var(--fs-sm)",
          fontWeight: 600,
          cursor: submitting ? "default" : "pointer",
          opacity: submitting ? 0.6 : 1,
        }}
      >
        Add
      </button>
    </form>
  );
}
