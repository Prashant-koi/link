"use client";

import { Rnd } from "react-rnd";
import { useOS, type WindowState } from "@/lib/client/store";

export function WindowFrame({ win, children }: { win: WindowState; children: React.ReactNode }) {
  const { close, focus, move, resize, toggleMinimize } = useOS();

  if (win.minimized) return null;

  return (
    <Rnd
      size={{ width: win.width, height: win.height }}
      position={{ x: win.x, y: win.y }}
      bounds="parent"
      minWidth={340}
      minHeight={220}
      dragHandleClassName="os-titlebar"
      style={{ zIndex: win.z }}
      onDragStart={() => focus(win.key)}
      onMouseDown={() => focus(win.key)}
      onDragStop={(_, d) => move(win.key, d.x, d.y)}
      onResizeStop={(_, __, ref, ___, pos) =>
        resize(win.key, ref.offsetWidth, ref.offsetHeight, pos.x, pos.y)
      }
    >
      <div className="panel flex h-full w-full flex-col overflow-hidden rounded-xl shadow-2xl shadow-black/50">
        <div className="os-titlebar flex cursor-grab items-center gap-2 border-b border-white/10 bg-white/5 px-3 py-2 active:cursor-grabbing">
          <button
            aria-label="Close"
            onClick={() => close(win.key)}
            className="h-3 w-3 rounded-full bg-[#ff5f57] transition hover:brightness-125"
          />
          <button
            aria-label="Minimize"
            onClick={() => toggleMinimize(win.key)}
            className="h-3 w-3 rounded-full bg-[#febc2e] transition hover:brightness-125"
          />
          <span className="h-3 w-3 rounded-full bg-[#28c840]/70" />
          <span className="ml-2 truncate text-xs font-medium tracking-wide text-slate-200">
            {win.title}
          </span>
        </div>
        <div className="flex-1 overflow-auto">{children}</div>
      </div>
    </Rnd>
  );
}
