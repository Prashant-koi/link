import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { relax, solveLayout } from "../physics/venn";
import { blobPath } from "../physics/blob";
import { createBody, createWorld, hitBody, releaseBody, settleWorld, stepWorld, worldEnergy } from "../physics/world";
import type { PointerSample, World } from "../physics/world";
import type { LayoutInput, LayoutResult, Placed } from "../physics/types";
import type { BridgeNode, CanvasNode, RankedInterest } from "../home/model";
import { NARROW_BREAKPOINT } from "../hooks/useIsNarrow";

/** Field hues, in slot order. An interest's colour comes from its identity,
 *  never its rank, so re-ranking never repaints a field still on screen. */
const FIELD_COLORS = [
  "var(--field-1)",
  "var(--field-2)",
  "var(--field-3)",
  "var(--field-4)",
  "var(--field-5)",
];

const DT = 1 / 120;
const MAX_FRAME = 0.05;
const MAX_STEPS = 6;
const SLEEP_ENERGY = 0.5;
const SLEEP_FRAMES = 30;

// Roomy on purpose: every sphere carries a name label, and the separation the
// solver enforces has to cover the label, not just the circle.
//
// The ring radius is bounded by the frame. A field's furthest extent from the
// canvas centre is ring * (1 + largest radius multiple) = ring * 2.1, and the
// labels sit ~40 units beyond that — so ring must stay under
// (height/2 - 40) / 2.1 or the top field label climbs out of the canvas and
// collides with the page header.
const LANDSCAPE = { width: 1300, height: 900, ring: 230, viewerRadius: 26, scale: 1, fontScale: 1, separation: 30, names: true };

// A viewBox scales its contents to the rendered width, so on a phone the
// landscape frame would render 12px type at about 6px. The portrait frame
// draws everything larger in viewBox units to compensate, which it can afford
// because the page also shows fewer spheres at this size.
//
// It also drops the name under each sphere (`names: false`). Those labels are
// what force the spacing between spheres, and at phone width that spacing is
// wider than the interest circles themselves — so the crowd stops fitting
// inside the very fields the picture is about. Without them the spheres pack
// properly, and a name is one tap away.
const PORTRAIT = { width: 800, height: 980, ring: 220, viewerRadius: 30, scale: 1.6, fontScale: 1.9, separation: 12, names: false };

interface Props {
  nodes: CanvasNode[];
  bridges: BridgeNode[];
  fields: RankedInterest[];
  viewerName: string;
  still: boolean;
  selectedId: string | null;
  onSelect: (node: CanvasNode) => void;
  onSelectBridge: (bridge: BridgeNode) => void;
  /** How many nodes the geometry could not place truthfully. */
  onPartialCount: (count: number) => void;
}

interface DragState {
  bodyId: string | null;
  grabDx: number;
  grabDy: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  lastX: number;
  lastY: number;
  lastT: number;
  downX: number;
  downY: number;
  downT: number;
  moved: boolean;
}

export function InterestCanvas({
  nodes,
  bridges,
  fields,
  viewerName,
  still,
  selectedId,
  onSelect,
  onSelectBridge,
  onPartialCount,
}: Props) {
  const [portrait, setPortrait] = useState(() => window.innerWidth < NARROW_BREAKPOINT);
  const [focusIndex, setFocusIndex] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    const onResize = () => setPortrait(window.innerWidth < NARROW_BREAKPOINT);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const frame = portrait ? PORTRAIT : LANDSCAPE;

  // The layout is a pure function of the data and the frame, so it is keyed on
  // exactly that and nothing else. Resizing changes the *bucket*, not a
  // continuous value, so dragging a window edge cannot cause a relayout storm.
  const layout = useMemo(() => {
    const inputs: LayoutInput[] = nodes.map((n) => ({
      id: n.id,
      membership: n.membership,
      rank: n.rank,
      radius: n.radius * frame.scale,
    }));
    return solveLayout(inputs, {
      width: frame.width,
      height: frame.height,
      fieldCount: fields.length,
      ringRadius: frame.ring,
      viewerRadius: frame.viewerRadius,
      separationSlack: frame.separation,
    });
  }, [nodes, fields.length, frame]);

  useEffect(() => {
    onPartialCount(layout.partialCount);
  }, [layout.partialCount, onPartialCount]);

  // Bridges are positioned from the people, and the people then have to make
  // room for the bridges — so it takes two passes. Place everyone, see where
  // the bridges land, then re-settle the people with those bridges as fixed
  // obstacles and place the bridges again against the result.
  //
  // The runtime springs cannot substitute for this: a person's pull toward
  // home is stronger than the shove from a neighbour, so a bridge dropped on
  // top of someone stays on top of them.
  const { placed, bridgePlacements } = useMemo(() => {
    const bridgeRadius = 17 * frame.scale;
    const next = layout.placed.map((p) => ({ ...p, dropped: [...p.dropped] }));

    if (bridges.length === 0 || layout.fields.length === 0) {
      return { placed: next, bridgePlacements: placeBridges(bridges, next, layout, bridgeRadius) };
    }

    const inputs: LayoutInput[] = nodes.map((n) => ({
      id: n.id,
      membership: n.membership,
      rank: n.rank,
      radius: n.radius * frame.scale,
    }));

    const first = placeBridges(bridges, next, layout, bridgeRadius);
    relax(
      next,
      layout.fields,
      inputs,
      first.map((b) => ({ x: b.x, y: b.y, radius: bridgeRadius })),
      8,
      layout.pad,
      layout.minSep,
      layout.width,
      layout.height,
      layout.viewerX,
      layout.viewerY,
      layout.viewerRadius,
    );

    return { placed: next, bridgePlacements: placeBridges(bridges, next, layout, bridgeRadius) };
  }, [layout, bridges, nodes, frame.scale]);

  const placedById = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const worldRef = useRef<World | null>(null);
  const nodeRefs = useRef(new Map<string, SVGGElement>());
  const blobRefs = useRef<(SVGPathElement | null)[]>([]);
  const linkRefs = useRef(new Map<string, SVGLineElement>());
  const pointers = useRef(new Map<number, DragState>());
  const rafRef = useRef<number | null>(null);
  const rectRef = useRef({ left: 0, top: 0, scale: 1 });

  // Build the world whenever the layout changes.
  useEffect(() => {
    // The settled positions, not layout.placed — otherwise the loop would
    // spring everyone back to where they sat before the bridges pushed them.
    const world = createWorld({ ...layout, placed }, new Set());
    for (const bp of bridgePlacements) {
      const body = createBody(bp.bridge.id, bp.x, bp.y, 17 * frame.scale, true);
      world.bodies.push(body);
      world.byId.set(body.id, body);
    }
    worldRef.current = world;
    if (still) settleWorld(world);
    draw();
    // draw is stable for the life of the effect; the world is what changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, placed, bridgePlacements, still, frame.scale]);

  const measure = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    rectRef.current = {
      left: rect.left,
      top: rect.top,
      // preserveAspectRatio is left at its uniform default, so one scalar is
      // enough and we never have to touch getScreenCTM on the move path.
      scale: rect.width === 0 ? 1 : frame.width / rect.width,
    };
  }, [frame.width]);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure]);

  const draw = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    for (let i = 0; i < world.blobs.length; i++) {
      blobRefs.current[i]?.setAttribute("d", blobPath(world.blobs[i]));
    }
    for (const body of world.bodies) {
      const x = body.x.toFixed(1);
      const y = body.y.toFixed(1);
      const el = nodeRefs.current.get(body.id);
      if (el) el.setAttribute("transform", `translate(${x} ${y})`);
      // Connections are redrawn with the spheres rather than anchored to
      // their resting places, so a dragged node pulls its thread with it.
      const link = linkRefs.current.get(body.id);
      if (link) {
        link.setAttribute("x2", x);
        link.setAttribute("y2", y);
      }
    }
  }, []);

  // ---- The loop ------------------------------------------------------------
  const wake = useCallback(() => {
    if (still) return;
    if (rafRef.current !== null) return;

    let last = performance.now() / 1000;
    let acc = 0;
    let quiet = 0;

    const tick = (ts: number) => {
      const world = worldRef.current;
      if (!world) {
        rafRef.current = null;
        return;
      }
      const now = ts / 1000;
      // A backgrounded tab can return with an enormous gap. Clamping the frame
      // means a thirty-second absence advances the simulation by at most 50ms:
      // no explosion, and no jarring snap to a settled state either.
      acc += Math.min(now - last, MAX_FRAME);
      last = now;

      const samples: PointerSample[] = [];
      for (const p of pointers.current.values()) {
        samples.push({ x: p.x, y: p.y, vx: p.vx, vy: p.vy, bodyId: p.bodyId, grabDx: p.grabDx, grabDy: p.grabDy });
      }

      let steps = 0;
      while (acc >= DT && steps < MAX_STEPS) {
        for (const p of pointers.current.values()) {
          if (!p.bodyId) continue;
          const body = world.byId.get(p.bodyId);
          if (!body || body.pinned) continue;
          body.x = p.x + p.grabDx;
          body.y = p.y + p.grabDy;
          body.vx = p.vx;
          body.vy = p.vy;
        }
        stepWorld(world, DT, samples);
        acc -= DT;
        steps++;
      }
      if (steps === MAX_STEPS) acc = 0; // drop the debt rather than spiral

      draw();

      // In normal use this never fires, and that is expected: the idle float
      // is a continuous animation, so the world always carries some energy and
      // the loop keeps running. It is here for the cases where nothing is
      // actually animating — motion held still, an empty canvas, every sphere
      // focused — where it does stop the loop outright. A backgrounded tab is
      // handled separately, by the visibilitychange listener below.
      if (pointers.current.size === 0 && worldEnergy(world) < SLEEP_ENERGY) {
        quiet++;
      } else {
        quiet = 0;
      }
      if (quiet >= SLEEP_FRAMES) {
        rafRef.current = null;
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [draw, still]);

  useEffect(() => {
    if (still) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      const world = worldRef.current;
      if (world) {
        settleWorld(world);
        draw();
      }
      return;
    }
    wake();
    const onVisibility = () => {
      if (document.hidden) {
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      } else {
        wake();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [wake, still, draw, layout]);

  // ---- Pointer -------------------------------------------------------------
  const toCanvas = (clientX: number, clientY: number) => {
    const { left, top, scale } = rectRef.current;
    return { x: (clientX - left) * scale, y: (clientY - top) * scale };
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const world = worldRef.current;
    if (!world) return;
    measure();
    const { x, y } = toCanvas(e.clientX, e.clientY);
    const body = hitBody(world, x, y);
    const grabbable = body && !body.pinned && !still;

    pointers.current.set(e.pointerId, {
      bodyId: grabbable ? body!.id : null,
      grabDx: grabbable ? body!.x - x : 0,
      grabDy: grabbable ? body!.y - y : 0,
      x,
      y,
      vx: 0,
      vy: 0,
      lastX: x,
      lastY: y,
      lastT: e.timeStamp,
      downX: x,
      downY: y,
      downT: e.timeStamp,
      moved: false,
    });

    if (grabbable) {
      body!.dragging = true;
      e.currentTarget.style.cursor = "grabbing";
    }
    // Capture on the root so a fast drag that leaves a sphere keeps delivering
    // moves, and pointerup arrives even outside the window.
    e.currentTarget.setPointerCapture(e.pointerId);
    wake();
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    const { x, y } = toCanvas(e.clientX, e.clientY);
    const dt = Math.max(1, e.timeStamp - p.lastT) / 1000;
    // Record only. The simulation step consumes this, so a 240Hz pointer
    // cannot inject several times the force a 60Hz one does.
    p.vx = (x - p.lastX) / dt;
    p.vy = (y - p.lastY) / dt;
    p.lastX = x;
    p.lastY = y;
    p.lastT = e.timeStamp;
    p.x = x;
    p.y = y;
    if (Math.hypot(x - p.downX, y - p.downY) > 8) p.moved = true;
    wake();
  };

  const endPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    pointers.current.delete(e.pointerId);
    e.currentTarget.style.cursor = "";

    const world = worldRef.current;
    if (world && p.bodyId) {
      const body = world.byId.get(p.bodyId);
      if (body) releaseBody(body, p.vx, p.vy);
    }

    // Tap versus drag. Without this, every drag would also open the panel.
    const quick = e.timeStamp - p.downT < 350;
    if (quick && !p.moved && p.bodyId) {
      const node = nodes.find((n) => n.id === p.bodyId);
      if (node) onSelect(node);
      const bridge = bridges.find((b) => b.id === p.bodyId);
      if (bridge) onSelectBridge(bridge);
    }
    wake();
  };

  // ---- Keyboard ------------------------------------------------------------
  // Roving tabindex: one stop for the whole canvas, arrows move through the
  // spheres in rank order, which is the ordering the page is already about.
  const onKeyDown = (e: React.KeyboardEvent<SVGGElement>, index: number, node: CanvasNode) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(node);
      return;
    }
    let next = index;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = Math.min(nodes.length - 1, index + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = Math.max(0, index - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = nodes.length - 1;
    else return;
    e.preventDefault();
    setFocusIndex(next);
    const el = nodeRefs.current.get(nodes[next].id);
    el?.focus();
  };

  const setFocused = (id: string, focused: boolean) => {
    const body = worldRef.current?.byId.get(id);
    if (body) body.focused = focused;
  };

  const describe = () => {
    if (fields.length === 0) return `${nodes.length} suggested connections.`;
    return (
      `${fields.length} overlapping interest areas: ${fields.map((f) => f.label).join(", ")}. ` +
      `Each person sits where the interests they share with you overlap. ` +
      `${nodes.length} shown.`
    );
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${frame.width} ${frame.height}`}
      width="100%"
      role="group"
      aria-label="Your interest map"
      aria-describedby="canvas-desc"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      style={{
        display: "block",
        maxWidth: frame.width,
        margin: "0 auto",
        // pan-y keeps vertical page scroll working on touch; once a sphere is
        // grabbed, pointer capture takes the gesture and a drag works in any
        // direction anyway.
        touchAction: "pan-y",
        userSelect: "none",
        WebkitTapHighlightColor: "transparent",
        overflow: "visible",
      }}
    >
      <desc id="canvas-desc">{describe()}</desc>

      <defs>
        {/* Translucent throughout — the highlight is opacity, not a lighter
            colour, so whatever the sphere sits on still reads through it. */}
        <radialGradient id="sphere-glass" cx="0.34" cy="0.28" r="0.85">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="45%" stopColor="#ffffff" stopOpacity="0.62" />
          <stop offset="100%" stopColor="#dbe4ec" stopOpacity="0.5" />
        </radialGradient>
        <radialGradient id="bridge-glass" cx="0.34" cy="0.28" r="0.85">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="50%" stopColor="var(--bridge-mid)" />
          <stop offset="100%" stopColor="var(--bridge-deep)" stopOpacity="0.55" />
        </radialGradient>
      </defs>

      {/* Fields. Multiply blending is what makes the overlaps legible — the
          compositor renders the depth of each region for free, so no region
          polygons ever have to be computed. */}
      <g style={{ mixBlendMode: "multiply" }} aria-hidden="true">
        {layout.fields.map((f, i) => {
          const color = FIELD_COLORS[fields[f.index]?.colorIndex ?? f.index] ?? FIELD_COLORS[0];
          return (
            <path
              key={f.index}
              ref={(el) => {
                blobRefs.current[i] = el;
              }}
              fill={color}
              fillOpacity="var(--field-fill-alpha)"
              stroke={color}
              strokeOpacity="var(--field-stroke-alpha)"
              strokeWidth={1.5}
            />
          );
        })}
      </g>

      {/* Field labels sit just outside the rim, so an interest is never
          conveyed by fill alone — and never lands on top of the crowd inside. */}
      <g aria-hidden="true">
        {layout.fields.map((f) => {
          const angle = Math.atan2(f.cy - layout.viewerY, f.cx - layout.viewerX);
          // Centre-anchored and clamped by an estimated half-width, so a long
          // label can never run off the edge of the canvas. Estimating from
          // the character count is crude, but SVG gives no text metrics
          // before paint and erring wide only costs a little inset.
          const text = fields[f.index]?.shownAs ?? fields[f.index]?.label ?? "";
          // Estimated from the character count, because SVG offers no text
          // metrics before paint. Erring wide costs a little inset; erring
          // narrow lets a long label run off the edge of the canvas, so the
          // per-character figure is deliberately generous.
          const halfWidth = (text.length * 7.1 * frame.fontScale) / 2 + 16;
          const lx = Math.min(
            frame.width - halfWidth,
            Math.max(halfWidth, f.cx + Math.cos(angle) * (f.r + 18)),
          );
          const ly = Math.min(
            frame.height - 14,
            Math.max(14, f.cy + Math.sin(angle) * (f.r + 18)),
          );
          const color = FIELD_COLORS[fields[f.index]?.colorIndex ?? f.index] ?? FIELD_COLORS[0];
          const fs = 13 * frame.fontScale;
          return (
            <g key={f.index}>
              {/* The label wears ink, not the field's hue — the swatch beside
                  it carries the identity. Two of the five hues sit under 3:1
                  against white, so coloured label text would be the weakest
                  part of the whole picture. */}
              <circle
                cx={lx - halfWidth + fs * 0.34}
                cy={ly}
                r={fs * 0.3}
                fill={color}
                stroke="var(--surface)"
                strokeWidth={1.5}
              />
              <text
                x={lx - halfWidth + fs * 1.1}
                y={ly}
                textAnchor="start"
                dominantBaseline="middle"
                fill="var(--ink-900)"
                fontSize={fs}
                fontWeight={600}
                style={{ pointerEvents: "none", paintOrder: "stroke", letterSpacing: "0.01em" }}
                stroke="var(--surface)"
                strokeWidth={4}
                strokeLinejoin="round"
              >
                {fields[f.index]?.shownAs ?? fields[f.index]?.label ?? ""}
              </text>
            </g>
          );
        })}
      </g>

      {/* Connections. Every sphere is joined back to the profile at the
          centre, so the canvas reads as one network rather than scattered
          dots. Drawn under everything, weighted by rank so the strongest
          matches have the most substantial thread. */}
      <g aria-hidden="true">
        {placed.map((p) => {
          const node = nodes.find((n) => n.id === p.id);
          const strength = node ? 1 - node.rank / Math.max(1, nodes.length - 1) : 0.5;
          return (
            <line
              key={`link-${p.id}`}
              ref={(el) => {
                if (el) linkRefs.current.set(p.id, el);
                else linkRefs.current.delete(p.id);
              }}
              x1={layout.viewerX}
              y1={layout.viewerY}
              x2={p.x}
              y2={p.y}
              stroke="var(--link)"
              strokeWidth={0.6 + strength * 1.1}
              strokeLinecap="round"
            />
          );
        })}
        {bridgePlacements.map((bp) => (
          <line
            key={`tether-${bp.bridge.id}`}
            x1={layout.viewerX}
            y1={layout.viewerY}
            x2={bp.targetX}
            y2={bp.targetY}
            stroke="var(--link)"
            strokeWidth={1.4}
          />
        ))}
      </g>

      {/* The profile at the centre. Smaller than the spheres around it, a flat
          dark blue rather than glass, and unnamed — it is the anchor every
          thread runs back to, and it does not compete for attention. It never
          moves, and no field ever reaches it. */}
      <g transform={`translate(${layout.viewerX} ${layout.viewerY})`}>
        <title>{viewerName}</title>
        <circle r={layout.viewerRadius * 0.62} fill="var(--viewer-fill)" />
      </g>

      {/* Bridges: pinned, ink-toned, visibly not part of the drifting crowd. */}
      <g style={{ filter: "drop-shadow(0 2px 3px var(--sphere-shadow))" }}>
        {bridgePlacements.map((bp) => (
          <g
            key={bp.bridge.id}
            ref={(el) => {
              if (el) nodeRefs.current.set(bp.bridge.id, el);
              else nodeRefs.current.delete(bp.bridge.id);
            }}
            transform={`translate(${bp.x} ${bp.y})`}
            tabIndex={0}
            role="button"
            aria-label={`${bp.bridge.actor.displayName}, a connection in common — ${bp.bridge.via}`}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectBridge(bp.bridge);
              }
            }}
            style={{ cursor: "pointer" }}
          >
            <circle r={17 * frame.scale} fill="url(#bridge-glass)" />
            <circle
              r={17 * frame.scale}
              fill="none"
              stroke={selectedId === bp.bridge.id ? "var(--tq-600)" : "var(--ink-200)"}
              strokeWidth={selectedId === bp.bridge.id ? 2.5 : 1}
            />
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fill="var(--ink-900)"
              fontSize={11 * frame.fontScale}
              fontWeight={600}
              style={{ pointerEvents: "none" }}
            >
              {initials(bp.bridge.actor.displayName)}
            </text>
            {frame.names && (
            <text
              y={17 * frame.scale + 14}
              textAnchor="middle"
              fill="var(--ink-600)"
              fontSize={11 * frame.fontScale}
              style={{ pointerEvents: "none", paintOrder: "stroke" }}
              stroke="var(--surface)"
              strokeWidth={3.5}
              strokeLinejoin="round"
            >
              {bp.bridge.actor.displayName}
            </text>
            )}
          </g>
        ))}
      </g>

      {/* People, societies or events. */}
      <g style={{ filter: "drop-shadow(0 3px 5px var(--sphere-shadow))" }}>
        {nodes.map((node, i) => {
          const placed = placedById.get(node.id);
          if (!placed) return null;
          const r = node.radius * frame.scale;
          const selected = selectedId === node.id;
          // A node whose real combination of interests the geometry could not
          // express is ringed, so position is never quietly taken as truth.
          const approximate = placed.partial || node.relatedOnly;
          return (
            <g
              key={node.id}
              ref={(el) => {
                if (el) nodeRefs.current.set(node.id, el);
                else nodeRefs.current.delete(node.id);
              }}
              transform={`translate(${placed.x} ${placed.y})`}
              tabIndex={i === focusIndex ? 0 : -1}
              role="button"
              aria-label={ariaLabel(node, approximate)}
              onKeyDown={(e) => onKeyDown(e, i, node)}
              onFocus={() => {
                setFocusIndex(i);
                setFocused(node.id, true);
              }}
              onBlur={() => setFocused(node.id, false)}
              onPointerEnter={() => setHovered(node.id)}
              onPointerLeave={() => setHovered((h) => (h === node.id ? null : h))}
              style={{ cursor: still ? "pointer" : "grab" }}
            >
              {selected && <circle r={r + 6} fill="none" stroke="var(--tq-600)" strokeWidth={2.5} />}
              {/* Glass, not a solid ball: the field colour underneath shows
                  through, which matters because a sphere can sit in two
                  fields at once and its own fill must not contradict that. */}
              <circle r={r} fill="url(#sphere-glass)" />
              <circle
                r={r}
                fill="none"
                stroke={approximate ? "var(--ink-400)" : "var(--sphere-rim)"}
                strokeWidth={approximate ? 1.5 : 1}
                strokeDasharray={approximate ? "3 3" : undefined}
              />
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fill="var(--ink-900)"
                fontSize={Math.round(r * 0.58)}
                fontWeight={600}
                style={{ pointerEvents: "none" }}
              >
                {initials(node.label)}
              </text>
              {/* A stroke painted behind the glyphs keeps a name readable
                  wherever it lands — over a field edge, over the wash, or
                  over a neighbouring sphere. On the portrait frame the name
                  only appears for the sphere under attention: see the note on
                  PORTRAIT for why it cannot be shown for everyone there. */}
              {(frame.names || hovered === node.id || selected) && (
              <text
                y={r + 15}
                textAnchor="middle"
                fill="var(--ink-900)"
                fontSize={12 * frame.fontScale}
                fontWeight={500}
                style={{ pointerEvents: "none", paintOrder: "stroke" }}
                stroke="var(--surface)"
                strokeWidth={3.5}
                strokeLinejoin="round"
              >
                {node.label}
              </text>
              )}
              {/* The second line is the main source of clutter, so it only
                  appears for the sphere actually under attention. */}
              {node.sublabel && (hovered === node.id || selected) && (
                <text
                  y={r + 29}
                  textAnchor="middle"
                  fill="var(--ink-500)"
                  fontSize={11 * frame.fontScale}
                  style={{ pointerEvents: "none", paintOrder: "stroke" }}
                  stroke="var(--surface)"
                  strokeWidth={3.5}
                  strokeLinejoin="round"
                >
                  {node.sublabel}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

interface BridgePlacement {
  bridge: BridgeNode;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
}

/**
 * A bridge sits on the line between the viewer and the person it connects you
 * to — nominally at the midpoint, with successive bridges sliding a little
 * further out so two never stack. The distance is then clamped: far enough
 * from the centre to clear the profile, and far enough from the target to
 * stay a clearly separate node. If those two bounds cross there is genuinely
 * no room, and the bridge is left out rather than drawn on top of something.
 */
function placeBridges(
  bridges: BridgeNode[],
  placed: Placed[],
  layout: LayoutResult,
  bridgeRadius: number,
): BridgePlacement[] {
  const byId = new Map(placed.map((p) => [p.id, p]));
  const out: BridgePlacement[] = [];

  for (const b of bridges) {
    const target = byId.get(b.targetId);
    if (!target) continue;

    const dx = target.x - layout.viewerX;
    const dy = target.y - layout.viewerY;
    const span = Math.hypot(dx, dy);
    if (span === 0) continue;

    const minDist = layout.viewerRadius + bridgeRadius + 48;
    const maxDist = span - (target.radius + bridgeRadius + 28);
    if (maxDist < minDist) continue;

    const want = span * (0.52 + out.length * 0.07);
    const d = Math.min(maxDist, Math.max(minDist, want));
    out.push({
      bridge: b,
      x: layout.viewerX + (dx / span) * d,
      y: layout.viewerY + (dy / span) * d,
      targetX: target.x,
      targetY: target.y,
    });
  }
  return out;
}

function ariaLabel(node: CanvasNode, approximate: boolean): string {
  const parts = [node.label];
  if (node.matchedLabels.length > 0) {
    parts.push(`shares ${node.matchedLabels.join(" and ")} with you`);
  } else if (node.relatedOnly) {
    parts.push("related interests, but none of your top five");
  } else {
    parts.push("no shared interest in your top five");
  }
  parts.push(`rank ${node.rank + 1}`);
  if (approximate) parts.push("position approximate");
  return parts.join(", ");
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
