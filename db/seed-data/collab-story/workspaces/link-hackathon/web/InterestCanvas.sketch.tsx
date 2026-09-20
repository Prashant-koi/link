// web/InterestCanvas.sketch.tsx
// Jane — atlas home screen sketch (D8)
// First pass: Tue 25 Aug. Tweaked Sun 6 Sep to calm the animation for the demo.
// This is a stand-in for the real component; it owns the SVG layout and the
// drag loop, not the data fetching (that lives in useAtlasData).

import { useEffect, useRef, useState } from "react";
import type { AtlasNode, ConceptRegion } from "../types/atlas";

const TURQUOISE = "#2dd4bf";
const PERSON_R = 10;
const REGION_OPACITY = 0.18;

interface Props {
  regions: ConceptRegion[];
  people: AtlasNode[];
  selectedId?: string;
}

export default function InterestCanvas({ regions, people, selectedId }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

  // Respect prefers-reduced-motion: if the user wants less motion we skip the
  // rAF loop entirely and just render static positions (Mei's a11y note).
  const reducedMotion = useRef(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion.current = mq.matches;
  }, []);

  // requestAnimationFrame loop ONLY while dragging (perf: we were janking on
  // the GX10 box when this ran constantly, even though it's a sketch).
  const rafId = useRef<number | null>(null);
  const tick = () => {
    // In the real impl we'd integrate velocities here; for the sketch we just
    // re-render so positions settle. Keep this cheap.
    if (!dragging) return;
    rafId.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    if (dragging && !reducedMotion.current && rafId.current == null) {
      rafId.current = requestAnimationFrame(tick);
    }
    return () => {
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
      rafId.current = null;
    };
  }, [dragging]);

  const onMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    // TODO(jane): hit-test and move the dragged node; currently a no-op stub.
  };

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 800 500"
      width="100%"
      height="100%"
      role="img"
      aria-label="Atlas of shared interests"
      onPointerMove={onMove}
      onPointerUp={() => setDragging(false)}
      onPointerLeave={() => setDragging(false)}
    >
      {/* Soft overlapping concept regions */}
      {regions.map((r) => (
        <path
          key={r.id}
          d={r.path}
          fill={TURQUOISE}
          opacity={REGION_OPACITY}
          stroke={TURQUOISE}
          strokeWidth={1}
          style={{ pointerEvents: "none" }}
        />
      ))}

      {/* People as spheres inside the regions */}
      {people.map((p) => {
        const isSel = p.id === selectedId;
        const isHov = p.id === hovered;
        return (
          <circle
            key={p.id}
            cx={p.x}
            cy={p.y}
            r={PERSON_R}
            fill={isSel ? TURQUOISE : "#0f766e"}
            stroke="#ffffff"
            strokeWidth={isSel || isHov ? 2 : 1}
            opacity={0.95}
            onPointerDown={() => setDragging(true)}
            onPointerEnter={() => setHovered(p.id)}
            onPointerLeave={() => setHovered(null)}
          >
            <title>{p.name}</title>
          </circle>
        );
      })}
    </svg>
  );
}

// Notes for the real component (not in this sketch):
// - Regions should be generated from concept centroids + radius ~ sqrt(idf).
// - Drag should update a local copy of `people` and commit on release.
// - Accessibility: keyboard focus + arrow keys to move selection (TODO).
// - Theme tokens: pull TURQUOISE / dark teal from design-tokens.css, don't hardcode.
