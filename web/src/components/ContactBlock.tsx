import type { ActorSummary } from "../types/api";

const KIND_LABEL: Record<string, string> = {
  email: "Email",
  phone: "Phone",
  website: "Website",
  office: "Office",
};

export function ContactBlock({
  actor,
  onRequestIntro,
}: {
  actor: ActorSummary;
  onRequestIntro: () => void;
}) {
  const { contact } = actor;

  if (contact.hasAccount) {
    return (
      <button
        onClick={onRequestIntro}
        style={{
          background: "var(--tq-600)",
          color: "var(--surface)",
          border: "none",
          borderRadius: 8,
          padding: "10px 16px",
          fontSize: "var(--fs-base)",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Send a message
      </button>
    );
  }

  if (contact.methods.length === 0) {
    return <p style={{ fontSize: "var(--fs-sm)", color: "var(--ink-500)" }}>No contact details listed</p>;
  }

  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
      {contact.methods.map((method, i) => (
        <li key={i}>
          <div style={{ fontSize: "var(--fs-xs)", color: "var(--ink-500)" }}>
            {method.label ?? KIND_LABEL[method.kind] ?? method.kind}
          </div>
          <div style={{ fontSize: "var(--fs-base)", color: "var(--ink-900)", userSelect: "text" }}>
            {method.value}
          </div>
        </li>
      ))}
    </ul>
  );
}
