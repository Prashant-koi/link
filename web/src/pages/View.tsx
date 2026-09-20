import { useEffect, useState } from "react";
import { api } from "../api/client";
import { PersonRow } from "../components/PersonRow";
import { PersonPanel } from "../components/PersonPanel";
import type { ConnectionSuggestion } from "../types/api";

const FETCH_LIMIT = 50;
const PAGE_SIZE = 25;

// Same data as Home in a different shape — the accessible equivalent of the
// constellation, which is why it's worth building early, not as secondary.
export function View() {
  const [suggestions, setSuggestions] = useState<ConnectionSuggestion[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    // Backend §10 open question: /view needs `limit` on suggestions, not a
    // client-side slice of a 5-item response — fetched once at 50, then
    // paginated 25-at-a-time here.
    api.getSuggestions(FETCH_LIMIT).then(setSuggestions);
  }, []);

  const visible = suggestions.slice(0, visibleCount);
  const selected = suggestions.find((s) => s.actor.id === selectedId);

  return (
    <div>
      <h1 style={{ fontSize: "var(--fs-xl)", color: "var(--ink-900)", marginBottom: 24 }}>
        Your top connections
      </h1>

      <div>
        {visible.map((s, i) => (
          <PersonRow key={s.actor.id} suggestion={s} rank={i + 1} onSelect={() => setSelectedId(s.actor.id)} />
        ))}
      </div>

      {visibleCount < suggestions.length && (
        <button
          onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
          style={{
            marginTop: 16,
            background: "none",
            border: "1px solid var(--ink-200)",
            borderRadius: 8,
            padding: "8px 16px",
            fontSize: "var(--fs-sm)",
            color: "var(--tq-600)",
            cursor: "pointer",
          }}
        >
          Show more
        </button>
      )}

      {selected && (
        <PersonPanel actor={selected.actor} reasons={selected.reasons} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
