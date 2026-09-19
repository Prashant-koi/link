"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** shown in the fallback so the user knows which window failed */
  label?: string;
}
interface State {
  error: Error | null;
}

const isChunkError = (e: Error) =>
  e.name === "ChunkLoadError" || /Loading chunk .* failed|dynamically imported module/i.test(e.message);

/**
 * Keeps one bad window from taking down the whole desktop.
 *
 * The common case in dev (and after a deploy in prod) is a ChunkLoadError: the
 * page is holding chunk names from a build that no longer exists. That is fixed
 * by reloading, so we do it once — guarded, so a genuinely broken chunk cannot
 * put the shell in a reload loop.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (!isChunkError(error)) return;
    const KEY = "studentos:chunk-reloaded";
    try {
      if (sessionStorage.getItem(KEY)) return;
      sessionStorage.setItem(KEY, "1");
      window.location.reload();
    } catch {
      /* storage unavailable — fall through to the manual retry button */
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const stale = isChunkError(error);
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="text-sm text-slate-200">
          {stale ? "This window is running an outdated build." : `${this.props.label ?? "This window"} hit an error.`}
        </div>
        <div className="max-w-md text-xs text-slate-500">{error.message}</div>
        <div className="flex gap-2">
          <button
            onClick={() => this.setState({ error: null })}
            className="rounded border border-white/15 bg-white/5 px-3 py-1 text-xs transition hover:border-sky-400/50"
          >
            Retry
          </button>
          <button
            onClick={() => {
              try {
                sessionStorage.removeItem("studentos:chunk-reloaded");
              } catch {
                /* ignore */
              }
              window.location.reload();
            }}
            className="rounded bg-sky-500/80 px-3 py-1 text-xs font-medium text-white transition hover:bg-sky-400"
          >
            Reload StudentOS
          </button>
        </div>
      </div>
    );
  }
}
