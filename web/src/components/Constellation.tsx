import { useEffect, useState } from "react";
import type { ConnectionSuggestion } from "../types/api";
import { PersonNode } from "./PersonNode";

const R_MIN_DESKTOP = 140;
const R_MAX_DESKTOP = 240;
const MOBILE_BREAKPOINT = 600;

function useViewportWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

function normalizeScores(scores: number[]): number[] {
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  if (max === min) return scores.map(() => 1); // all equal: all at R_min
  return scores.map((s) => (s - min) / (max - min));
}

// Fixed radial layout, not a force simulation — computed positions, no
// jitter, no settle-differently-every-load (§4).
export function Constellation({
  suggestions,
  selectedId,
  onSelect,
}: {
  suggestions: ConnectionSuggestion[];
  selectedId: string | null;
  onSelect: (actorId: string) => void;
}) {
  const width = useViewportWidth();
  const isMobile = width < MOBILE_BREAKPOINT;
  const rMin = isMobile ? R_MIN_DESKTOP * 0.6 : R_MIN_DESKTOP;
  const rMax = isMobile ? R_MAX_DESKTOP * 0.6 : R_MAX_DESKTOP;

  const size = rMax * 2 + 120; // room for avatar + labels at the outer radius
  const cx = size / 2;
  const cy = size / 2;
  const n = suggestions.length;
  const normalized = normalizeScores(suggestions.map((s) => s.score));

  return (
    <svg
      role="img"
      viewBox={`0 0 ${size} ${size}`}
      width="100%"
      style={{ maxWidth: size, display: "block", margin: "0 auto" }}
      aria-labelledby="constellation-title constellation-desc"
    >
      <title id="constellation-title">Your closest connections</title>
      <desc id="constellation-desc">
        {n} suggested connections, radiating from your profile at the centre. Closer means a stronger match.{" "}
        {suggestions.map((s) => s.actor.displayName).join(", ")}.
      </desc>

      {suggestions.map((s, i) => {
        const angle = (-90 + (360 / n) * i) * (Math.PI / 180);
        const radius = rMin + (rMax - rMin) * (1 - normalized[i]);
        const x = cx + radius * Math.cos(angle);
        const y = cy + radius * Math.sin(angle);
        const strokeWidth = 1 + normalized[i] * 2;
        const strokeColor = normalized[i] > 0.5 ? "var(--tq-500)" : "var(--tq-300)";

        return (
          <line
            key={`line-${s.actor.id}`}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            pathLength={1}
            strokeDasharray={1}
            className="constellation-line"
            style={{ animationDelay: `${i * 40}ms` }}
          />
        );
      })}

      <circle cx={cx} cy={cy} r={20} fill="var(--tq-600)" />

      {suggestions.map((s, i) => {
        const angle = (-90 + (360 / n) * i) * (Math.PI / 180);
        const radius = rMin + (rMax - rMin) * (1 - normalized[i]);
        const x = cx + radius * Math.cos(angle);
        const y = cy + radius * Math.sin(angle);

        return (
          <PersonNode
            key={s.actor.id}
            suggestion={s}
            x={x}
            y={y}
            tabIndex={0}
            selected={selectedId === s.actor.id}
            onSelect={() => onSelect(s.actor.id)}
          />
        );
      })}
    </svg>
  );
}
