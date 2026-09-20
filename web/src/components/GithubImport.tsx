import { useState } from "react";
import { api } from "../api/client";
import { ImportCard, buttonStyle, inputStyle } from "./ImportCard";

// GitHub is the one source with a real API behind it: the worker reads the
// profile and the non-fork repositories, extracts interests from them, and
// links each repo as a project context — so two people on the same repo get
// the same shared-context signal as two people in the same lab.
export function GithubImport({ actorId, onSubmitted }: { actorId: string; onSubmitted: () => void }) {
  const [login, setLogin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function handleSubmit() {
    const username = login.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\/$/, "");
    if (!username || !actorId || busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await api.createImport({ actorId, kind: "github", origin: username });
      setNote(`Fetching @${username}'s repositories…`);
      setLogin("");
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ImportCard
      title="GitHub"
      blurb="Your public profile and repositories. Forks are skipped — someone else's work isn't evidence of your interests."
      busy={busy}
      error={error}
      note={note}
    >
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="github username"
          style={inputStyle}
        />
        <button
          type="button"
          style={{ ...buttonStyle, opacity: login.trim() && !busy ? 1 : 0.5, whiteSpace: "nowrap" }}
          disabled={!login.trim() || busy}
          onClick={handleSubmit}
        >
          {busy ? "Queuing…" : "Import"}
        </button>
      </div>
    </ImportCard>
  );
}
