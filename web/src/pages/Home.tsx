import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useMe } from "../hooks/useMe";
import { Constellation } from "../components/Constellation";
import { PersonPanel } from "../components/PersonPanel";
import type { ActorSummary, ConnectionSuggestion } from "../types/api";

export function Home() {
  const [me] = useMe();
  const [self, setSelf] = useState<ActorSummary | null>(null);
  const [suggestions, setSuggestions] = useState<ConnectionSuggestion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    api.getActor(me).then(setSelf);
    api.getSuggestions(me).then(setSuggestions);
  }, [me]);

  if (!me) {
    return (
      <p style={{ fontSize: "var(--fs-base)", color: "var(--ink-600)" }}>
        Set up your profile in <Link to="/settings">Settings</Link> to see your connections.
      </p>
    );
  }

  const selected = suggestions.find((s) => s.actor.id === selectedId);

  return (
    <div>
      <h1 style={{ fontSize: "var(--fs-xl)", color: "var(--ink-900)", marginBottom: 32 }}>
        {self?.displayName ?? ""}
      </h1>

      {suggestions.length === 0 ? (
        <p style={{ fontSize: "var(--fs-base)", color: "var(--ink-500)" }}>
          No suggestions yet — add some interests in Settings.
        </p>
      ) : (
        <Constellation suggestions={suggestions} selectedId={selectedId} onSelect={setSelectedId} />
      )}

      {selected && (
        <PersonPanel
          actor={selected.actor}
          reasons={selected.reasons}
          meId={me}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
