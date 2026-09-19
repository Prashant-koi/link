"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { forceCollide } from "d3-force";
import { colorFor } from "@/lib/client/api";
import type { Subgraph } from "@/lib/graph/types";

/* react-force-graph touches window at import time, so it stays client-only.
   ForceGraphClient re-exports it behind a forwardRef — next/dynamic drops refs
   otherwise, and the instance is what exposes d3Force and zoomToFit. */
const ForceGraph2D = dynamic(() => import("./ForceGraphClient"), { ssr: false }) as any;

interface Props {
  data: Subgraph;
  onNodeClick?: (id: string) => void;
  highlight?: string | null;
  height?: number;
}

/* padding leaves room for the labels drawn beside each node, not just the dots */
const ANSWER_LABELS = new Set(["Lab", "Position", "Club", "Course", "Event", "Paper", "Goal"]);

const fitPadding = (w: number, h: number) => Math.max(16, Math.min(64, Math.min(w, h) * 0.13));

export function GraphView({ data, onNodeClick, highlight, height }: Props) {
  const box = useRef<HTMLDivElement>(null);
  // callback ref, so the layout effect re-runs the moment the graph mounts
  const [fg, setFg] = useState<any>(null);
  const [size, setSize] = useState({ w: 600, h: height ?? 400 });
  const [hovered, setHovered] = useState<string | null>(null);

  /* The canvas needs explicit pixel dimensions, so the pane has to be measured.
     A stale measurement shows up as a graph that looks zoomed in and cropped,
     and ResizeObserver alone proved unreliable inside the draggable windows —
     so measure on mount, on observer events, and on a cheap poll for drags. */
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;

    const measure = () => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      setSize((prev) =>
        Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1
          ? prev
          : { w: r.width, h: r.height },
      );
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    const poll = window.setInterval(measure, 500);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.clearInterval(poll);
    };
  }, []);

  /* react-force-graph mutates its input, so hand it a copy — and keep that copy
     stable, because a new graphData object restarts the whole layout. */
  const graph = useMemo(
    () => ({
      nodes: data.nodes.map((n) => ({ ...n })),
      links: data.links.map((l) => ({ ...l })),
    }),
    [data],
  );

  /* Forces: the defaults pack these subgraphs into an unreadable ball. Most of
     them are stars around one person, so a collision force sized to the label
     is what actually separates the neighbours. */
  useEffect(() => {
    if (!fg || graph.nodes.length === 0) return;
    fg.d3Force("charge")?.strength(-260).distanceMax(500);
    fg.d3Force("link")?.distance(90);
    fg.d3Force(
      "collide",
      forceCollide((n: any) => 16 + Math.min(String(n.name ?? "").length, 26) * 1.6).iterations(2),
    );
    fg.d3ReheatSimulation?.();
  }, [fg, graph]);

  /* Framing. zoomToFit before the nodes have coordinates computes a NaN
     transform the view never recovers from, so wait for finite coordinates,
     and re-frame while the layout settles and whenever the pane resizes. */
  useEffect(() => {
    if (!fg || graph.nodes.length === 0) return;

    const fit = (ms: number) => {
      const nodes = graph.nodes as any[];
      if (!nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))) return;
      if (!Number.isFinite(fg.zoom?.())) fg.zoom(1, 0);
      fg.zoomToFit(ms, fitPadding(size.w, size.h));
    };

    fit(0);
    let ticks = 0;
    const id = window.setInterval(() => {
      fit(300);
      if (++ticks >= 10) window.clearInterval(id);
    }, 350);
    return () => window.clearInterval(id);
  }, [fg, graph, size.w, size.h]);

  /* Every prop identity change makes force-graph pause and re-run its update,
     so these handlers must be stable. */
  const handleNodeClick = useCallback((n: any) => onNodeClick?.(n.id as string), [onNodeClick]);
  const handleNodeHover = useCallback((n: any) => setHovered(n ? (n.id as string) : null), []);
  const handleEngineStop = useCallback(() => {
    if (fg) fg.zoomToFit(400, fitPadding(size.w, size.h));
  }, [fg, size.w, size.h]);

  const nodeCount = graph.nodes.length;
  const paintNode = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, scale: number) => {
      const isHot = highlight === node.id;
      const r = isHot ? 7 : node.label === "Interest" ? 4 : 5.5;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = colorFor(node.label);
      ctx.fill();
      if (isHot) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#fff";
        ctx.stroke();
      }

      /* Only label what the eye can read: a small graph, a zoomed-in one, the
         highlighted node, whatever is under the cursor — and, in a crowded
         graph, the things that answer the question rather than every person. */
      const isAnswer = ANSWER_LABELS.has(node.label);
      const showLabel =
        isHot ||
        hovered === node.id ||
        nodeCount <= 22 ||
        scale > 1.5 ||
        (isAnswer && nodeCount <= 70);
      if (!showLabel) return;

      const text = String(node.name).slice(0, 32);
      const font = Math.max(9, 11 / scale);
      ctx.font = `${font}px ui-sans-serif, system-ui`;
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(6,10,24,0.85)";
      ctx.strokeText(text, node.x, node.y + r + font);
      ctx.fillStyle = isHot || hovered === node.id ? "#fff" : "rgba(230,235,255,0.88)";
      ctx.fillText(text, node.x, node.y + r + font);
    },
    [highlight, hovered, nodeCount],
  );

  const labels = useMemo(() => [...new Set(data.nodes.map((n) => n.label))].sort(), [data.nodes]);

  return (
    <div ref={box} className="relative h-full min-h-0 w-full min-w-0 overflow-hidden">
      {data.nodes.length === 0 ? (
        <div className="flex h-full items-center justify-center px-8 text-center text-sm text-slate-400">
          Nothing rendered yet — ask a question, or open a node from another app.
        </div>
      ) : (
        <>
          {/* absolutely positioned so the fixed-size canvas can never widen the
              container that measures it — that loop grows the graph every frame */}
          <div className="absolute inset-0">
            <ForceGraph2D
              ref={setFg}
              width={size.w}
              height={size.h}
              graphData={graph}
              backgroundColor="rgba(0,0,0,0)"
              /* force-graph pauses its simulation on every prop update and runs
                 warmupTicks synchronously, so doing the layout work there makes
                 it settle deterministically rather than depending on the
                 animation loop still being alive. */
              warmupTicks={120}
              cooldownTicks={40}
              cooldownTime={3000}
              d3VelocityDecay={0.3}
              nodeRelSize={5}
              linkColor={() => "rgba(148,163,220,0.26)"}
              linkDirectionalArrowLength={3}
              linkDirectionalArrowRelPos={1}
              onNodeClick={handleNodeClick}
              onNodeHover={handleNodeHover}
              onEngineStop={handleEngineStop}
              nodeCanvasObject={paintNode}
            />
          </div>
          <div className="pointer-events-none absolute left-2 top-2 flex max-w-[70%] flex-wrap gap-1.5">
            {labels.map((l) => (
              <span key={l} className="rounded-full bg-black/40 px-2 py-0.5 text-[10px] text-slate-200">
                <span
                  className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                  style={{ background: colorFor(l) }}
                />
                {l}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
