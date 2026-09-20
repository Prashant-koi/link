import type { ImportStatus, ImportSummary } from "../types/api";

const KIND_LABEL: Record<ImportSummary["kind"], string> = {
  resume: "Résumé",
  linkedin: "LinkedIn",
  github: "GitHub",
  courses: "Courses",
};

const STATUS_COLOR: Record<ImportStatus, string> = {
  pending: "var(--ink-500)",
  running: "var(--tq-600)",
  done: "var(--tq-700)",
  failed: "#b3261e",
};

// Extraction and resolution are separate async stages, so they're reported
// separately: "12 found, 9 resolved" is the honest statement, and it is what
// makes the pipeline legible while it runs.
export function ImportStatusList({ imports }: { imports: ImportSummary[] }) {
  if (imports.length === 0) {
    return (
      <p style={{ fontSize: "var(--fs-sm)", color: "var(--ink-500)" }}>
        Nothing imported yet. Anything you add above shows up here as it lands in the graph.
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {imports.map((item) => (
        <div
          key={item.id}
          style={{
            display: "grid",
            gap: 4,
            padding: "12px 16px",
            border: "1px solid var(--ink-200)",
            borderRadius: 10,
            background: "var(--surface)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
            <span style={{ fontSize: "var(--fs-base)", color: "var(--ink-900)" }}>
              {KIND_LABEL[item.kind]}
              {item.origin && <span style={{ color: "var(--ink-500)" }}> · {item.origin}</span>}
            </span>
            <span style={{ fontSize: "var(--fs-sm)", color: STATUS_COLOR[item.status], fontWeight: 600 }}>
              {item.status === "running" ? "working…" : item.status}
            </span>
          </div>

          <div style={{ fontSize: "var(--fs-sm)", color: "var(--ink-600)" }}>
            {item.conceptsFound} interest{item.conceptsFound === 1 ? "" : "s"} found ·{" "}
            {item.conceptsResolved} resolved
            {item.contextsLinked > 0 && ` · ${item.contextsLinked} context${item.contextsLinked === 1 ? "" : "s"} linked`}
          </div>

          {item.detail && (
            <div style={{ fontSize: "var(--fs-xs)", color: item.status === "failed" ? "#b3261e" : "var(--ink-500)" }}>
              {item.detail}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
