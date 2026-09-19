import type { Reason } from "../types/api";

// Renders prose ?? summary and never waits on generation — prose is only
// ever already-cached by the time it reaches the frontend.
export function ReasonList({ reasons }: { reasons: Reason[] }) {
  if (reasons.length === 0) return null;

  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
      {reasons.map((reason, i) => (
        <li key={i} style={{ fontSize: "var(--fs-sm)", color: "var(--ink-600)" }}>
          {reason.prose ?? reason.summary}
        </li>
      ))}
    </ul>
  );
}
