import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { api, USING_FIXTURES } from "../api/client";
import { AudienceToggle } from "../components/AudienceToggle";
import { EventPanel } from "../components/EventPanel";
import { InterestCanvas } from "../components/InterestCanvas";
import { InterestRankList } from "../components/InterestRankList";
import { PersonPanel } from "../components/PersonPanel";
import { useIsNarrow } from "../hooks/useIsNarrow";
import { useReducedMotion } from "../hooks/useReducedMotion";
import {
  applyOrder,
  buildBridges,
  buildEventNodes,
  buildInterests,
  buildNodes,
  fieldsFrom,
  loadOrder,
  saveOrder,
  selectVisible,
  splitByKind,
} from "../home/model";
import type { Audience, BridgeNode, CanvasNode } from "../home/model";
import type { BridgeSuggestion, ConnectionSuggestion, EventSuggestion, InterestRow } from "../types/api";

// The backend runs about three sequential queries per actor in a suggestions
// response, so a large limit is genuinely slow. Forty fills the fields without
// making the first paint wait on hundreds of round trips.
const FETCH_LIMIT = 40;

/** How many spheres the map shows. Ranking decides which ones. */
const WIDE_NODE_CAP = 22;
const NARROW_NODE_CAP = 12;

export function Home() {
  const { actor } = useAuth();
  const [suggestions, setSuggestions] = useState<ConnectionSuggestion[]>([]);
  const [interestRows, setInterestRows] = useState<InterestRow[]>([]);
  const [bridgeRows, setBridgeRows] = useState<BridgeSuggestion[]>([]);
  const [eventRows, setEventRows] = useState<EventSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [audience, setAudience] = useState<Audience>("people");
  const [order, setOrder] = useState<string[]>([]);
  const [selected, setSelected] = useState<CanvasNode | null>(null);
  const [selectedBridge, setSelectedBridge] = useState<BridgeNode | null>(null);
  const [partialCount, setPartialCount] = useState(0);
  const [still, setStill] = useReducedMotion();
  const narrow = useIsNarrow();

  useEffect(() => {
    if (actor) setOrder(loadOrder(actor.id));
  }, [actor]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      api.getSuggestions(FETCH_LIMIT),
      api.listInterests(),
      api.getBridges(),
      api.getEventSuggestions(),
    ])
      .then(([s, i, b, e]) => {
        if (cancelled) return;
        setSuggestions(s);
        setInterestRows(i);
        setBridgeRows(b);
        setEventRows(e);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Couldn't load your connections. Refresh to try again.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const interests = useMemo(
    () => applyOrder(buildInterests(actor, interestRows), order),
    [actor, interestRows, order],
  );
  const fields = useMemo(() => fieldsFrom(interests), [interests]);

  const { people: peopleSuggestions, societies: societySuggestions } = useMemo(
    () => splitByKind(suggestions),
    [suggestions],
  );

  const people = useMemo(() => buildNodes(peopleSuggestions, fields, 1), [peopleSuggestions, fields]);
  const societies = useMemo(() => buildNodes(societySuggestions, fields, 1.08), [societySuggestions, fields]);
  const events = useMemo(() => buildEventNodes(eventRows, fields, 1.05), [eventRows, fields]);

  // A name label needs real pixels. Rather than scaling every suggestion into
  // a phone-width frame and producing a picture nobody can read, the map shows
  // the people the current ranking favours and points at /view for the rest.
  const allNodes = audience === "people" ? people : audience === "societies" ? societies : events;
  const nodes = useMemo(
    () => selectVisible(allNodes, fields.length, narrow ? NARROW_NODE_CAP : WIDE_NODE_CAP),
    [allNodes, fields.length, narrow],
  );
  const hiddenCount = allNodes.length - nodes.length;

  // Bridges only mean anything against people, and only for targets on screen.
  const bridges = useMemo(
    () => (audience === "people" ? buildBridges(bridgeRows, people) : []),
    [audience, bridgeRows, people],
  );

  const handleReorder = useCallback(
    (keys: string[]) => {
      setOrder(keys);
      if (actor) saveOrder(actor.id, keys);
    },
    [actor],
  );

  const relatedCount = nodes.filter((n) => n.relatedOnly).length;

  if (loading) {
    return <p style={{ padding: "64px 0", textAlign: "center", color: "var(--ink-500)" }}>Building your map…</p>;
  }

  if (error) {
    return <p style={{ padding: "64px 0", textAlign: "center", color: "var(--ink-900)" }}>{error}</p>;
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: "var(--fs-xl)", lineHeight: "var(--lh-tight)", color: "var(--ink-900)" }}>
          {actor?.displayName ?? ""}
        </h1>
        <p style={{ fontSize: "var(--fs-sm)", color: "var(--ink-500)" }}>
          {fields.length > 0
            ? "People sit inside the interests they share with you."
            : "Add some interests in Settings to see your map."}
        </p>
      </div>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap-reverse" }}>
        <div style={{ flex: "1 1 520px", minWidth: 0 }}>
          {nodes.length === 0 ? (
            <p style={{ padding: "48px 0", textAlign: "center", color: "var(--ink-500)" }}>
              {emptyMessage(audience)}
            </p>
          ) : (
            <InterestCanvas
              nodes={nodes}
              bridges={bridges}
              fields={fields}
              viewerName={actor?.displayName ?? "You"}
              still={still}
              selectedId={selected?.id ?? selectedBridge?.id ?? null}
              onSelect={(node) => {
                setSelectedBridge(null);
                setSelected(node);
              }}
              onSelectBridge={(bridge) => {
                setSelected(null);
                setSelectedBridge(bridge);
              }}
              onPartialCount={setPartialCount}
            />
          )}
        </div>

        {interests.length > 0 && <InterestRankList interests={interests} onReorder={handleReorder} />}
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <AudienceToggle
          value={audience}
          counts={{ people: people.length, societies: societies.length, events: events.length }}
          onChange={(next) => {
            setAudience(next);
            setSelected(null);
            setSelectedBridge(null);
          }}
        />

        <button
          onClick={() => setStill(!still)}
          aria-pressed={still}
          style={{
            background: "none",
            border: "1px solid var(--ink-200)",
            borderRadius: 999,
            padding: "7px 14px",
            fontSize: "var(--fs-sm)",
            color: "var(--ink-600)",
            cursor: "pointer",
          }}
        >
          {still ? "Motion off" : "Hold still"}
        </button>

        <Link to="/view" style={{ fontSize: "var(--fs-sm)" }}>
          See the same people as a list →
        </Link>
      </div>

      {/* Position carries meaning here, so anything it cannot express has to be
          said in words rather than quietly approximated. */}
      <div style={{ display: "grid", gap: 4 }}>
        {hiddenCount > 0 && (
          <p style={{ fontSize: "var(--fs-xs)", color: "var(--ink-500)" }}>
            Showing your strongest {nodes.length} on this screen size. {hiddenCount} more are in the{" "}
            <Link to="/view">list view</Link>.
          </p>
        )}
        {partialCount > 0 && (
          <p style={{ fontSize: "var(--fs-xs)", color: "var(--ink-500)" }}>
            {partialCount} {partialCount === 1 ? "sphere shares" : "spheres share"} a combination of
            interests that five overlapping circles can't show at once —{" "}
            {partialCount === 1 ? "it sits" : "they sit"} in as many as the shape allows, ringed.
          </p>
        )}
        {relatedCount > 0 && (
          <p style={{ fontSize: "var(--fs-xs)", color: "var(--ink-500)" }}>
            {relatedCount} {relatedCount === 1 ? "person has" : "people have"} interests related to yours
            rather than shared outright — those sit outside the areas, ringed.
          </p>
        )}
        {audience === "events" && eventRows.length > 0 && (
          <p style={{ fontSize: "var(--fs-xs)", color: "var(--ink-500)" }}>
            Events are demo data — nothing serves them from the database yet.
          </p>
        )}
        {audience === "people" && bridges.length > 0 && (
          <p style={{ fontSize: "var(--fs-xs)", color: "var(--ink-500)" }}>
            Grey spheres are people you have in common. They stay put.
          </p>
        )}
      </div>

      {/* The authoritative, non-visual version of the same information. It is
          built from the same nodes, so it cannot disagree with the canvas. */}
      <ul
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clipPath: "inset(50%)",
          whiteSpace: "nowrap",
        }}
      >
        {nodes.map((node) => (
          <li key={node.id}>
            {node.label}
            {node.matchedLabels.length > 0
              ? `, shares ${node.matchedLabels.join(" and ")} with you`
              : ", no shared interest in your top five"}
            , rank {node.rank + 1}
          </li>
        ))}
      </ul>

      {selected?.actor && (
        <PersonPanel actor={selected.actor} reasons={selected.reasons} onClose={() => setSelected(null)} />
      )}
      {selected?.event && (
        <EventPanel
          event={selected.event}
          reasons={selected.reasons}
          demo={USING_FIXTURES}
          onClose={() => setSelected(null)}
        />
      )}
      {selectedBridge && (
        <PersonPanel
          actor={selectedBridge.actor}
          reasons={[{ kind: "path", summary: selectedBridge.via, evidence: [] }]}
          onClose={() => setSelectedBridge(null)}
        />
      )}
    </div>
  );
}

function emptyMessage(audience: Audience): string {
  if (audience === "societies") return "No societies or labs match your interests yet.";
  if (audience === "events") return "No events to show.";
  return "No suggestions yet — add some interests in Settings.";
}
