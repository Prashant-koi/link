import type { Stance } from "../types/api";

const OPTIONS: { value: Stance; label: string }[] = [
  { value: "established", label: "Established" },
  { value: "exploring", label: "Exploring" },
  { value: "aspiring", label: "Aspiring" },
];

export function StanceSelect({ value, onChange }: { value: Stance; onChange: (s: Stance) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Stance)}
      style={{
        fontSize: "var(--fs-sm)",
        color: "var(--ink-900)",
        border: "1px solid var(--ink-200)",
        borderRadius: 6,
        padding: "4px 8px",
        background: "var(--surface)",
      }}
    >
      {OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
