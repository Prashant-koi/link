import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, BookOpen, MessageSquare, Paperclip, Plus, Send, Sparkles, Square, Trash2, X } from "lucide-react";
import { Link } from "react-router-dom";
import { ApiError, collabApi } from "../api/collab";
import type { AiAttachable, AiExcerpt, AiMessage, AiSource, AiThread } from "./types";
import { relTime } from "./ui";

const SUGGESTIONS = [
  "What's our current progress?",
  "What are the open action items, and who owns them?",
  "Summarise what happened this past week.",
  "What decisions have we made, and why?",
  "What's blocking us right now?",
];

const keyOf = (s: AiSource) => `${s.kind}:${s.refId}`;

export function AiChat({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string | null) => void }) {
  const [threads, setThreads] = useState<AiThread[]>([]);
  const isNew = selectedId === "new";

  const loadThreads = useCallback(async () => {
    try {
      setThreads(await collabApi.aiThreads());
    } catch {
      // signed out or offline — keep what we have
    }
  }, []);
  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  return (
    <div className={`cl-main${selectedId ? " has-selection" : ""}`}>
      <section className="cl-list" aria-label="AI chats">
        <div className="cl-list-head">
          <h2>AI assistant</h2>
          <button className="cl-icon-btn" aria-label="New AI chat" title="New AI chat" onClick={() => onSelect("new")}>
            <Plus size={18} />
          </button>
        </div>
        <div className="cl-scroll">
          {threads.length === 0 && (
            <p className="cl-empty">
              Ask about your projects. Attach workspaces and chats, then ask things like <em>“what's our progress?”</em>
            </p>
          )}
          {threads.map((t) => (
            <button key={t.id} className="cl-thread-row" aria-current={selectedId === t.id} onClick={() => onSelect(t.id)}>
              <span className="cl-avatar" aria-hidden="true">
                <Sparkles size={16} />
              </span>
              <span className="cl-row-body">
                <span className="cl-row-top">
                  <span className="cl-row-name">{t.title}</span>
                  <span className="cl-row-time">{relTime(t.updatedAt)}</span>
                </span>
                <span className="cl-row-preview">
                  {t.sourceCount} source{t.sourceCount === 1 ? "" : "s"}
                  {t.lastMessage ? ` · ${t.lastMessage}` : ""}
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {selectedId ? (
        <AiThreadView
          key={selectedId}
          id={isNew ? null : selectedId}
          onBack={() => onSelect(null)}
          onCreated={(id) => {
            onSelect(id);
            loadThreads();
          }}
          onChanged={loadThreads}
          onDeleted={() => {
            onSelect(null);
            loadThreads();
          }}
        />
      ) : (
        <div className="cl-pane">
          <p className="cl-empty">Pick an AI chat, or start a new one with the + button.</p>
        </div>
      )}
    </div>
  );
}

function AiThreadView({
  id,
  onBack,
  onCreated,
  onChanged,
  onDeleted,
}: {
  id: string | null;
  onBack: () => void;
  onCreated: (id: string) => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [threadId, setThreadId] = useState<string | null>(id);
  const [title, setTitle] = useState("New chat");
  const [sources, setSources] = useState<AiSource[]>([]);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [text, setText] = useState("");
  const [streaming, setStreaming] = useState<{ body: string; status: string; sources: AiExcerpt[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [dropped, setDropped] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    if (!id) return;
    let live = true;
    Promise.all([collabApi.aiThread(id), collabApi.aiMessages(id)])
      .then(([t, m]) => {
        if (!live) return;
        setTitle(t.title);
        setSources(t.sources);
        setDropped(t.droppedSources);
        setMessages(m);
      })
      .catch(() => live && setGone(true));
    return () => {
      live = false;
      abort.current?.abort();
    };
  }, [id]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  async function updateSources(next: AiSource[]) {
    setSources(next);
    setDropped(0);
    if (!threadId) return; // a draft: sent along when the chat is created
    try {
      await collabApi.setAiSources(threadId, next);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || streaming) return;
    setError(null);
    setText("");
    stick.current = true;
    let tid = threadId;
    try {
      if (!tid) {
        tid = (await collabApi.createAiThread(sources)).id;
        setThreadId(tid);
      }
      setMessages((m) => [...m, { id: `local-${Date.now()}`, role: "user", body: q, sources: [], createdAt: new Date().toISOString() }]);
      setStreaming({ body: "", status: "Starting…", sources: [] });
      const controller = new AbortController();
      abort.current = controller;
      let body = "";
      let excerpts: AiExcerpt[] = [];
      try {
        await collabApi.streamAnswer(
          tid,
          q,
          {
            onStatus: (status) => setStreaming((s) => (s ? { ...s, status } : s)),
            onSources: (s) => {
              excerpts = s;
              setStreaming((cur) => (cur ? { ...cur, sources: s } : cur));
            },
            onToken: (t) => {
              body += t;
              setStreaming((cur) => (cur ? { ...cur, body, status: "" } : cur));
            },
          },
          controller.signal,
        );
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError(e instanceof ApiError ? e.message : (e as Error).message);
      }
      // Reload the saved transcript (keeps a stopped, partial answer too).
      setMessages(await collabApi.aiMessages(tid));
      setStreaming(null);
      abort.current = null;
      if (id === null) onCreated(tid);
      else onChanged();
      void excerpts;
    } catch (e) {
      setStreaming(null);
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    }
  }

  async function remove() {
    if (!threadId || !window.confirm("Delete this AI chat?")) return;
    try {
      await collabApi.deleteAiThread(threadId);
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (gone)
    return (
      <div className="cl-pane">
        <p className="cl-empty">This AI chat isn't available.</p>
      </div>
    );

  const empty = messages.length === 0 && !streaming;

  return (
    <div className="cl-pane">
      <div className="cl-pane-head">
        <button className="cl-icon-btn cl-back" aria-label="Back to AI chats" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <span className="cl-avatar" aria-hidden="true">
          <Sparkles size={16} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</h2>
          <p className="cl-sub">Local model · reads only what you attach</p>
        </div>
        {threadId && (
          <button className="cl-icon-btn" aria-label="Delete this AI chat" title="Delete this AI chat" onClick={remove}>
            <Trash2 size={16} />
          </button>
        )}
      </div>

      <ContextBar sources={sources} onChange={updateSources} disabled={!!streaming} dropped={dropped} />

      <div
        className="cl-messages"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        role="log"
        aria-live="polite"
        aria-label="AI conversation"
      >
        {empty && (
          <div className="cl-ai-empty">
            <Sparkles size={28} color="var(--tq-500)" />
            <p>
              {sources.length === 0
                ? "Attach a workspace or a chat above, then ask a question."
                : "Ask about what's in the attached workspaces and chats."}
            </p>
            <div className="cl-suggest">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="cl-btn secondary" disabled={sources.length === 0} onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>
            <p className="cl-sub">Runs on this server's local model. Chats you attach are read by it; the other people in them aren't notified.</p>
          </div>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} m={m} />
        ))}
        {streaming && (
          <div className="cl-bubble ai">
            {streaming.body ? <Markdown text={streaming.body} sources={streaming.sources} /> : <span className="cl-sub">{streaming.status || "Thinking…"}</span>}
            {streaming.body && <span className="cl-caret" aria-hidden="true" />}
          </div>
        )}
      </div>

      {error && (
        <div className="cl-error" role="alert">
          {error}
        </div>
      )}

      <form
        className="cl-composer"
        onSubmit={(e) => {
          e.preventDefault();
          ask(text);
        }}
      >
        <textarea
          className="cl-input"
          rows={1}
          value={text}
          maxLength={2000}
          aria-label="Ask the AI assistant"
          placeholder={sources.length ? "Ask about your projects…" : "Attach something first, or just ask a general question"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              ask(text);
            }
          }}
        />
        {streaming ? (
          <button type="button" className="cl-btn secondary" onClick={() => abort.current?.abort()}>
            <Square size={14} /> Stop
          </button>
        ) : (
          <button className="cl-btn" type="submit" disabled={!text.trim()}>
            <Send size={16} /> Ask
          </button>
        )}
      </form>
    </div>
  );
}

function Bubble({ m }: { m: AiMessage }) {
  if (m.role === "user") return <div className="cl-bubble mine">{m.body}</div>;
  return (
    <div className="cl-bubble ai">
      <Markdown text={m.body} sources={m.sources} />
      <SourceList sources={m.sources} body={m.body} />
    </div>
  );
}

// [S3] in the model's text becomes a small numbered chip; everything else is
// ordinary sanitised Markdown (react-markdown never renders raw HTML).
function Markdown({ text, sources }: { text: string; sources: AiExcerpt[] }) {
  const linked = useMemo(() => text.replace(/\[S(\d+)\]/g, "[$1](#cite-$1)"), [text]);
  return (
    <div className="cl-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const cite = href?.startsWith("#cite-") ? Number(href.slice(6)) : null;
            if (cite !== null) {
              const s = sources.find((x) => x.n === cite);
              const to = s ? sourceLink(s) : null;
              return to ? (
                <Link className="cl-cite" to={to} title={s ? `${s.title}: ${s.snippet}` : undefined}>
                  {cite}
                </Link>
              ) : (
                <span className="cl-cite" title="Source not available">
                  {cite}
                </span>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            );
          },
        }}
      >
        {linked}
      </ReactMarkdown>
    </div>
  );
}

function sourceLink(s: AiExcerpt): string {
  return s.kind === "chat" ? `/collaborations?tab=messages&c=${s.refId}` : `/collaborations?tab=workspaces&w=${s.refId}${s.nodeId ? `&f=${s.nodeId}` : ""}`;
}

function SourceList({ sources, body }: { sources: AiExcerpt[]; body: string }) {
  if (sources.length === 0) return null;
  const cited = new Set([...body.matchAll(/\[S(\d+)\]/g)].map((m) => Number(m[1])));
  const list = sources.filter((s) => cited.has(s.n));
  if (list.length === 0) return null;
  return (
    <details className="cl-sources">
      <summary>
        Sources ({list.length})
      </summary>
      {list.map((s) => (
        <Link key={s.n} className="cl-source" to={sourceLink(s)}>
          <span className="cl-cite">{s.n}</span>
          <span>
            <strong>{s.title}</strong>
            <span className="cl-sub">{s.snippet}</span>
          </span>
        </Link>
      ))}
    </details>
  );
}

function ContextBar({
  sources,
  onChange,
  disabled,
  dropped,
}: {
  sources: AiSource[];
  onChange: (next: AiSource[]) => void;
  disabled: boolean;
  dropped: number;
}) {
  const [open, setOpen] = useState(false);
  const [attachable, setAttachable] = useState<AiAttachable | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    collabApi.aiSources().then(setAttachable).catch(() => setAttachable({ conversations: [], workspaces: [] }));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const chosen = new Set(sources.map(keyOf));
  const toggle = (s: AiSource) => {
    const k = keyOf(s);
    onChange(chosen.has(k) ? sources.filter((x) => keyOf(x) !== k) : [...sources, { kind: s.kind, refId: s.refId, label: s.label }]);
  };

  return (
    <div className="cl-context" ref={wrap}>
      <span className="cl-sub">Context</span>
      {sources.map((s) => (
        <span key={keyOf(s)} className="cl-chip">
          {s.kind === "workspace" ? <BookOpen size={12} /> : <MessageSquare size={12} />}
          {s.label}
          <button aria-label={`Remove ${s.label}`} disabled={disabled} onClick={() => toggle(s)}>
            <X size={12} />
          </button>
        </span>
      ))}
      {sources.length === 0 && <span className="cl-sub">nothing attached</span>}
      <button className="cl-btn secondary" style={{ padding: "4px 10px" }} disabled={disabled} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Paperclip size={14} /> Add context
      </button>
      {dropped > 0 && <span className="cl-sub">{dropped} source{dropped > 1 ? "s" : ""} no longer available</span>}
      {open && (
        <div className="cl-popover" role="dialog" aria-label="Attach context">
          {!attachable && <p className="cl-sub">Loading…</p>}
          {attachable && (
            <>
              <h3>Workspaces</h3>
              {attachable.workspaces.length === 0 && <p className="cl-sub">None you're a member of.</p>}
              {attachable.workspaces.map((w) => (
                <label key={w.refId} className="cl-check">
                  <input type="checkbox" checked={chosen.has(keyOf(w))} onChange={() => toggle(w)} />
                  <span>
                    {w.label} <span className="cl-sub">· {w.fileCount} files</span>
                  </span>
                </label>
              ))}
              <h3>Chats</h3>
              {attachable.conversations.length === 0 && <p className="cl-sub">No accepted conversations yet.</p>}
              {attachable.conversations.map((c) => (
                <label key={c.refId} className="cl-check">
                  <input type="checkbox" checked={chosen.has(keyOf(c))} onChange={() => toggle(c)} />
                  <span>
                    {c.label} <span className="cl-sub">· {c.messageCount} messages</span>
                  </span>
                </label>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
