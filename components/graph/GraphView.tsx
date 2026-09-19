"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { colorFor } from "@/lib/client/api";
import type { Subgraph } from "@/lib/graph/types";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

interface Props {
  data: Subgraph;
  onNodeClick?: (id: string) => void;
  highlight?: string | null;
  height?: number;
}

export function GraphView({ data, onNodeClick, highlight, height }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: height ?? 400 });

  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  /* react-force-graph mutates its input, so hand it a fresh copy per render set */
  const graph = useMemo(
    () => ({
      nodes: data.nodes.map((n) => ({ ...n })),
      links: data.links.map((l) => ({ ...l })),
    }),
    [data],
  );

  const labels = useMemo(
    () => [...new Set(data.nodes.map((n) => n.label))].sort(),
    [data.nodes],
  );

  return (
    <div ref={box} className="relative h-full w-full">
      {data.nodes.length === 0 ? (
        <div className="flex h-full items-center justify-center px-8 text-center text-sm text-slate-400">
          Nothing rendered yet — ask a question, or open a node from another app.
        </div>
      ) : (
        <>
          <ForceGraph2D
            width={size.w}
            height={size.h}
            graphData={graph}
            backgroundColor="rgba(0,0,0,0)"
            cooldownTicks={90}
            nodeRelSize={5}
            linkColor={() => "rgba(148,163,220,0.26)"}
            linkDirectionalArrowLength={3}
            linkDirectionalArrowRelPos={1}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onNodeClick={(n: any) => onNodeClick?.(n.id as string)}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, scale: number) => {
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
              if (scale > 1.1 || isHot) {
                ctx.font = `${Math.max(9, 11 / scale)}px ui-sans-serif, system-ui`;
                ctx.fillStyle = "rgba(230,235,255,0.9)";
                ctx.textAlign = "center";
                ctx.fillText(String(node.name).slice(0, 34), node.x, node.y + r + 9);
              }
            }}
          />
          <div className="pointer-events-none absolute left-2 top-2 flex max-w-[70%] flex-wrap gap-1.5">
            {labels.map((l) => (
              <span
                key={l}
                className="rounded-full bg-black/40 px-2 py-0.5 text-[10px] text-slate-200"
              >
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
