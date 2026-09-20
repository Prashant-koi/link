import { useEffect, useState } from "react";
import { api } from "../api/client";
import { ImportCard, buttonStyle, inputStyle, secondaryButtonStyle } from "./ImportCard";
import type { CourseOffering } from "../types/api";

// The simulated course system. A real Canvas/SIS integration is deliberately
// out of scope, so this stands in for the registrar feed: pick what you're
// enrolled in, or paste a transcript. Each course becomes a shared context
// (with its term dates, so a finished course decays against a current one)
// plus coursework-strength interests.
export function CourseImport({ actorId, onSubmitted }: { actorId: string; onSubmitted: () => void }) {
  const [catalog, setCatalog] = useState<CourseOffering[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pasted, setPasted] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    api.getCourseCatalog().then(setCatalog).catch(() => setCatalog([]));
  }, []);

  function toggle(code: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function handleSubmit() {
    if (!actorId || busy) return;
    const courses = catalog.filter((c) => selected.has(c.code));
    if (courses.length === 0 && !pasted.trim()) return;

    setBusy(true);
    setError(null);
    setNote(null);
    try {
      if (courses.length > 0) {
        await api.createImport({ actorId, kind: "courses", courses });
      } else {
        await api.createImport({ actorId, kind: "courses", text: pasted.trim() });
      }
      setNote(`Queued ${courses.length > 0 ? `${courses.length} course(s)` : "pasted courses"}.`);
      setSelected(new Set());
      setPasted("");
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const terms = [...new Set(catalog.map((c) => c.term))];

  return (
    <ImportCard
      title="Courses"
      blurb="Connect the course system and confirm what you're enrolled in. (Simulated: a real Canvas integration is out of scope, so this is the feed it would replace.)"
      busy={busy}
      error={error}
      note={note}
    >
      <div style={{ display: "grid", gap: 12, maxHeight: 320, overflowY: "auto" }}>
        {terms.map((term) => (
          <div key={term} style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--ink-500)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {term}
            </span>
            {catalog
              .filter((c) => c.term === term)
              .map((course) => (
                <label
                  key={course.code}
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "baseline",
                    fontSize: "var(--fs-sm)",
                    color: "var(--ink-900)",
                    cursor: "pointer",
                  }}
                >
                  <input type="checkbox" checked={selected.has(course.code)} onChange={() => toggle(course.code)} />
                  <span>
                    <strong style={{ fontWeight: 600 }}>{course.code}</strong> {course.title}
                  </span>
                </label>
              ))}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          style={{ ...buttonStyle, opacity: selected.size > 0 || pasted.trim() ? 1 : 0.5 }}
          disabled={busy || (selected.size === 0 && !pasted.trim())}
          onClick={handleSubmit}
        >
          {busy ? "Queuing…" : `Import ${selected.size > 0 ? `${selected.size} course(s)` : "courses"}`}
        </button>
        <button type="button" style={secondaryButtonStyle} onClick={() => setShowPaste((v) => !v)}>
          {showPaste ? "Hide transcript paste" : "Paste a transcript instead"}
        </button>
      </div>

      {showPaste && (
        <textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          rows={4}
          placeholder={"One course per line: CODE, Title, Term\n6.3900, Introduction to Machine Learning, Fall 2025"}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      )}
    </ImportCard>
  );
}
