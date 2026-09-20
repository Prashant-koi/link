import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Plus, Send } from "lucide-react";
import { api } from "../api/client";
import { collabApi } from "../api/collab";
import { useAuth } from "../auth/AuthContext";
import type { ActorSummary } from "../types/api";
import { useCollab } from "./CollabContext";
import type { Conversation, Message } from "./types";
import { Avatar, groupByDay, relTime } from "./ui";

type Selection = { kind: "thread"; id: string } | { kind: "new" } | null;

export function Messages({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { conversations } = useCollab();
  const [composing, setComposing] = useState(false);
  const selection: Selection = composing ? { kind: "new" } : selectedId ? { kind: "thread", id: selectedId } : null;

  const requests = conversations.filter((c) => c.incomingRequest);
  const sent = conversations.filter((c) => c.state === "requested" && !c.incomingRequest);
  const threads = conversations.filter((c) => c.state === "accepted");

  const open = (id: string) => {
    setComposing(false);
    onSelect(id);
  };

  return (
    <div className={`cl-main${selection ? " has-selection" : ""}`}>
      <section className="cl-list" aria-label="Conversations">
        <div className="cl-list-head">
          <h2>Messages</h2>
          <button className="cl-icon-btn" aria-label="New message" title="New message" onClick={() => setComposing(true)}>
            <Plus size={18} />
          </button>
        </div>
        <div className="cl-scroll">
          {conversations.length === 0 && (
            <p className="cl-empty">
              No conversations yet. Start one with the <strong>+</strong> button, or from anyone's profile.
            </p>
          )}
          {requests.length > 0 && <div className="cl-section">Requests</div>}
          {requests.map((c) => (
            <Row key={c.id} c={c} active={selectedId === c.id && !composing} onOpen={() => open(c.id)} />
          ))}
          {threads.length > 0 && <div className="cl-section">Conversations</div>}
          {threads.map((c) => (
            <Row key={c.id} c={c} active={selectedId === c.id && !composing} onOpen={() => open(c.id)} />
          ))}
          {sent.length > 0 && <div className="cl-section">Waiting for a reply</div>}
          {sent.map((c) => (
            <Row key={c.id} c={c} active={selectedId === c.id && !composing} onOpen={() => open(c.id)} />
          ))}
        </div>
      </section>

      {selection?.kind === "new" ? (
        <NewMessage
          onCancel={() => setComposing(false)}
          onStarted={(id) => {
            setComposing(false);
            onSelect(id);
          }}
        />
      ) : selection?.kind === "thread" ? (
        <Thread key={selection.id} id={selection.id} onBack={() => onSelect(null)} />
      ) : (
        <div className="cl-pane">
          <p className="cl-empty">Select a conversation to read it, or start a new one.</p>
        </div>
      )}
    </div>
  );
}

function Row({ c, active, onOpen }: { c: Conversation; active: boolean; onOpen: () => void }) {
  const { actor } = useAuth();
  const mine = c.lastMessage?.senderId === actor?.id;
  const unread = c.incomingRequest || c.unread > 0;
  return (
    <button className="cl-thread-row" aria-current={active} onClick={onOpen}>
      <Avatar name={c.counterparty.displayName} />
      <span className="cl-row-body">
        <span className="cl-row-top">
          <span className="cl-row-name">{c.counterparty.displayName}</span>
          {c.lastMessage && <span className="cl-row-time">{relTime(c.lastMessage.createdAt)}</span>}
        </span>
        <span className="cl-row-preview" style={unread ? { color: "var(--ink-900)", fontWeight: 600 } : undefined}>
          {c.lastMessage ? `${mine ? "You: " : ""}${c.lastMessage.body}` : ""}
        </span>
      </span>
      {unread && <span className="cl-dot" aria-label={c.incomingRequest ? "New request" : `${c.unread} unread`} />}
    </button>
  );
}

function Thread({ id, onBack }: { id: string; onBack: () => void }) {
  const { actor } = useAuth();
  const { conversations, refresh, subscribe } = useCollab();
  const conv = conversations.find((c) => c.id === id);
  const [messages, setMessages] = useState<Message[]>([]);
  const [state, setState] = useState<Conversation["state"] | null>(null);
  const [incoming, setIncoming] = useState(false);
  const [gone, setGone] = useState(false);
  const [more, setMore] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const load = useCallback(async () => {
    try {
      const page = await collabApi.messages(id);
      setMessages((prev) => {
        // keep any older pages already loaded above the newest 50
        const oldest = page.messages[0] ? BigInt(page.messages[0].id) : 0n;
        const older = prev.filter((m) => BigInt(m.id) < oldest);
        return [...older, ...page.messages];
      });
      setMore((m) => m || page.messages.length === 50);
      setState(page.state);
      setIncoming(page.incomingRequest);
    } catch {
      setGone(true);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load, conv?.updatedAt, conv?.lastMessage?.createdAt]);
  useEffect(() => subscribe((_t, cid) => cid === id && load()), [subscribe, id, load]);

  // Mark read whenever the thread is open and something is unread.
  useEffect(() => {
    if (conv && conv.unread > 0) collabApi.read(id).then(refresh, () => {});
  }, [id, conv, refresh]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function loadEarlier() {
    if (!messages[0]) return;
    const el = scroller.current;
    const before = el?.scrollHeight ?? 0;
    stick.current = false;
    const page = await collabApi.messages(id, messages[0].id);
    setMessages((prev) => [...page.messages, ...prev]);
    setMore(page.messages.length === 50);
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - before;
    });
  }

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      await collabApi.send(id, body);
      setText("");
      stick.current = true;
      await load();
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function respond(accept: boolean) {
    setError(null);
    try {
      await (accept ? collabApi.accept(id) : collabApi.decline(id));
      await load();
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const days = useMemo(() => groupByDay(messages), [messages]);
  const name = conv?.counterparty.displayName ?? "Conversation";

  if (gone)
    return (
      <div className="cl-pane">
        <p className="cl-empty">This conversation isn't available.</p>
      </div>
    );

  const iAsked = state === "requested" && !incoming;

  return (
    <div className="cl-pane">
      <div className="cl-pane-head">
        <button className="cl-icon-btn cl-back" aria-label="Back to conversations" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <Avatar name={name} />
        <div>
          <h2>{name}</h2>
          {conv && (
            <p className="cl-sub">
              {[conv.counterparty.personKind, conv.counterparty.homeUnit?.name].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      </div>

      <div
        className="cl-messages"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        role="log"
        aria-live="polite"
        aria-label={`Messages with ${name}`}
      >
        {more && (
          <button className="cl-btn secondary" style={{ alignSelf: "center" }} onClick={loadEarlier}>
            Load earlier messages
          </button>
        )}
        {days.map((d) => (
          <div key={d.day} style={{ display: "contents" }}>
            <div className="cl-day">{d.day}</div>
            {d.items.map((m) => (
              <div key={m.id} className={`cl-bubble${m.senderId === actor?.id ? " mine" : ""}`}>
                {m.body}
                <time dateTime={m.createdAt}>
                  {new Date(m.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </time>
              </div>
            ))}
          </div>
        ))}
      </div>

      {error && <div className="cl-error" role="alert">{error}</div>}

      {incoming ? (
        <div className="cl-banner">
          <span>{name} wants to message you. Accept to start the conversation.</span>
          <span className="cl-actions">
            <button className="cl-btn secondary" onClick={() => respond(false)}>
              Decline
            </button>
            <button className="cl-btn" onClick={() => respond(true)}>
              Accept
            </button>
          </span>
        </div>
      ) : iAsked ? (
        <div className="cl-banner">Request sent. You can keep talking once {name} accepts.</div>
      ) : state === "declined" ? (
        <div className="cl-banner">This conversation was declined.</div>
      ) : (
        <form
          className="cl-composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            className="cl-input"
            rows={1}
            value={text}
            maxLength={4000}
            aria-label={`Message ${name}`}
            placeholder={`Message ${name}`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="cl-btn" type="submit" disabled={busy || !text.trim()}>
            <Send size={16} /> Send
          </button>
        </form>
      )}
    </div>
  );
}

// Pick someone from your suggested connections (people with a login), write
// the first message. It is sent as a request; they accept or decline.
function NewMessage({ onCancel, onStarted }: { onCancel: () => void; onStarted: (id: string) => void }) {
  const { conversations, refresh } = useCollab();
  const [people, setPeople] = useState<ActorSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<ActorSummary | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .getSuggestions(60)
      .then((s) => setPeople(s.map((x) => x.actor).filter((a) => a.contact.hasAccount)))
      .catch(() => setPeople([]));
  }, []);

  const shown = (people ?? []).filter((p) => p.displayName.toLowerCase().includes(q.trim().toLowerCase()));

  async function submit() {
    if (!picked || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await collabApi.start(picked.id, text.trim());
      refresh();
      onStarted(r.conversationId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const existing = picked ? conversations.find((c) => c.counterparty.id === picked.id) : undefined;

  return (
    <div className="cl-pane">
      <div className="cl-pane-head">
        <button className="cl-icon-btn cl-back" aria-label="Cancel" onClick={onCancel}>
          <ArrowLeft size={18} />
        </button>
        <h2>New message</h2>
      </div>
      {!picked ? (
        <>
          <div style={{ padding: 16 }}>
            <input
              className="cl-input"
              placeholder="Search your suggested connections"
              aria-label="Search people"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
          </div>
          <div className="cl-scroll">
            {people === null && <p className="cl-empty">Loading…</p>}
            {people !== null && shown.length === 0 && <p className="cl-empty">No one matches.</p>}
            {shown.map((p) => (
              <button key={p.id} className="cl-thread-row" onClick={() => setPicked(p)}>
                <Avatar name={p.displayName} />
                <span className="cl-row-body">
                  <span className="cl-row-name">{p.displayName}</span>
                  <span className="cl-row-preview">
                    {[p.personKind, p.homeUnit?.name].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <form
          style={{ padding: 16, display: "grid", gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <p>
            To <strong>{picked.displayName}</strong>{" "}
            <button type="button" className="cl-btn secondary" onClick={() => setPicked(null)}>
              Change
            </button>
          </p>
          {existing ? (
            <p className="cl-sub">
              You already have a conversation with {picked.displayName}. Sending continues it.
            </p>
          ) : (
            <p className="cl-sub">
              This is sent as a request. {picked.displayName} chooses whether to accept before you can keep talking.
            </p>
          )}
          <textarea
            className="cl-input"
            rows={4}
            maxLength={4000}
            aria-label="Your message"
            placeholder="Say hello, and why you're reaching out"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          {error && <div className="cl-error" role="alert" style={{ padding: 0 }}>{error}</div>}
          <div className="cl-actions">
            <button type="button" className="cl-btn secondary" onClick={onCancel}>
              Cancel
            </button>
            <button className="cl-btn" type="submit" disabled={busy || !text.trim()}>
              <Send size={16} /> Send
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
