"use client";

import { create } from "zustand";
import type { AppId, Scope } from "@/lib/auth/roles";

export interface WindowState {
  key: string;
  app: AppId | "node";
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  minimized: boolean;
  /** per-window payload: a node id, an offering filter, a seeded query */
  payload?: Record<string, unknown>;
}

interface OSState {
  scope: Scope | null;
  llm: { configured: boolean; model: string | null };
  windows: WindowState[];
  topZ: number;
  commandOpen: boolean;
  setSession: (scope: Scope | null, llm?: { configured: boolean; model: string | null }) => void;
  open: (app: AppId | "node", title: string, payload?: Record<string, unknown>) => void;
  close: (key: string) => void;
  focus: (key: string) => void;
  toggleMinimize: (key: string) => void;
  move: (key: string, x: number, y: number) => void;
  resize: (key: string, width: number, height: number, x: number, y: number) => void;
  setCommandOpen: (open: boolean) => void;
  reset: () => void;
}

let spawn = 0;

export const useOS = create<OSState>((set, get) => ({
  scope: null,
  llm: { configured: false, model: null },
  windows: [],
  topZ: 10,
  commandOpen: false,

  setSession: (scope, llm) =>
    set((s) => ({ scope, llm: llm ?? s.llm, windows: scope ? s.windows : [] })),

  open: (app, title, payload) => {
    const key = app === "node" ? `node:${String(payload?.id ?? spawn++)}` : `app:${app}`;
    const existing = get().windows.find((w) => w.key === key);
    if (existing) {
      get().focus(key);
      if (payload) {
        set((s) => ({
          windows: s.windows.map((w) => (w.key === key ? { ...w, payload, minimized: false } : w)),
        }));
      }
      return;
    }
    const n = get().windows.length;
    const z = get().topZ + 1;
    set((s) => ({
      topZ: z,
      windows: [
        ...s.windows,
        {
          key,
          app,
          title,
          x: 90 + (n % 5) * 34,
          y: 70 + (n % 5) * 28,
          width: app === "compass" ? 900 : app === "node" ? 420 : 720,
          height: app === "compass" ? 620 : app === "node" ? 460 : 520,
          z,
          minimized: false,
          payload,
        },
      ],
    }));
  },

  close: (key) => set((s) => ({ windows: s.windows.filter((w) => w.key !== key) })),

  focus: (key) =>
    set((s) => {
      const z = s.topZ + 1;
      return {
        topZ: z,
        windows: s.windows.map((w) => (w.key === key ? { ...w, z, minimized: false } : w)),
      };
    }),

  toggleMinimize: (key) =>
    set((s) => ({
      windows: s.windows.map((w) => (w.key === key ? { ...w, minimized: !w.minimized } : w)),
    })),

  move: (key, x, y) =>
    set((s) => ({ windows: s.windows.map((w) => (w.key === key ? { ...w, x, y } : w)) })),

  resize: (key, width, height, x, y) =>
    set((s) => ({
      windows: s.windows.map((w) => (w.key === key ? { ...w, width, height, x, y } : w)),
    })),

  setCommandOpen: (commandOpen) => set({ commandOpen }),

  reset: () => set({ windows: [], commandOpen: false }),
}));
