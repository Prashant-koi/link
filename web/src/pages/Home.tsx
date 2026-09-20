import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { api } from "../api/client";
import { Constellation } from "../components/Constellation";
import { PersonPanel } from "../components/PersonPanel";
import type { ConnectionSuggestion } from "../types/api";

export function Home() {
  const { actor } = useAuth();
  const [suggestions, setSuggestions] = useState<ConnectionSuggestion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    api.getSuggestions().then(setSuggestions);
  }, []);

  const selected = suggestions.find((s) => s.actor.id === selectedId);

  return (
    <div>
      <h1 style={{ fontSize: "var(--fs-xl)", color: "var(--ink-900)", marginBottom: 32 }}>
        {actor?.displayName ?? ""}
      </h1>

      {suggestions.length === 0 ? (
        <p style={{ fontSize: "var(--fs-base)", color: "var(--ink-500)" }}>
          No suggestions yet — add some interests in Settings.
        </p>
      ) : (
        <Constellation suggestions={suggestions} selectedId={selectedId} onSelect={setSelectedId} />
      )}

      {selected && (
        <PersonPanel actor={selected.actor} reasons={selected.reasons} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
