import type { ReactNode } from "react";

// Shared chrome for the four import sources, so the page reads as one
// mechanism with four inputs rather than four separate features.
export function ImportCard({
  title,
  blurb,
  children,
  busy,
  error,
  note,
}: {
  title: string;
  blurb: string;
  children: ReactNode;
  busy?: boolean;
  error?: string | null;
  note?: string | null;
}) {
  return (
    <section
      style={{
        display: "grid",
        gap: 12,
        padding: 20,
        border: "1px solid var(--ink-200)",
        borderRadius: 12,
        background: "var(--surface)",
        opacity: busy ? 0.7 : 1,
      }}
    >
      <div style={{ display: "grid", gap: 4 }}>
        <h2 style={{ fontSize: "var(--fs-lg)", color: "var(--ink-900)" }}>{title}</h2>
        <p style={{ fontSize: "var(--fs-sm)", color: "var(--ink-600)", lineHeight: "var(--lh-body)" }}>{blurb}</p>
      </div>
      {children}
      {note && <p style={{ fontSize: "var(--fs-sm)", color: "var(--tq-600)" }}>{note}</p>}
      {error && <p style={{ fontSize: "var(--fs-sm)", color: "#b3261e" }}>{error}</p>}
    </section>
  );
}

export const buttonStyle: React.CSSProperties = {
  background: "var(--tq-600)",
  color: "var(--surface)",
  border: "none",
  borderRadius: 8,
  padding: "8px 16px",
  fontSize: "var(--fs-sm)",
  fontWeight: 600,
  cursor: "pointer",
};

export const secondaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: "var(--tq-050)",
  color: "var(--tq-700)",
  border: "1px solid var(--tq-300)",
};

export const inputStyle: React.CSSProperties = {
  fontSize: "var(--fs-base)",
  padding: "8px 12px",
  border: "1px solid var(--ink-200)",
  borderRadius: 8,
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
};
