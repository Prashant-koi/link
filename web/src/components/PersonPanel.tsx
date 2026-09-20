import { useState } from "react";
import { Link } from "react-router-dom";
import type { ActorSummary, Reason } from "../types/api";
import { collabApi } from "../api/collab";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "./ImportCard";
import { ConceptChip } from "./ConceptChip";
import { ReasonList } from "./ReasonList";
import { ContactBlock } from "./ContactBlock";
import { AiSummary } from "./AiSummary";

// The §5 detail panel: opens beside the constellation/list rather than
// navigating away, so "why this person" never disappears.
export function PersonPanel({
  actor,
  reasons,
  onClose,
}: {
  actor: ActorSummary;
  reasons: Reason[];
  onClose: () => void;
}) {
  // "Send a message" is a request: the first message is what the other
  // person accepts or declines, so it is written here rather than sent blank.
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState("");
  const [sent, setSent] = useState<{ id: string; state: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await collabApi.start(actor.id, text.trim());
      setSent({ id: r.conversationId, state: r.state });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside
      role="dialog"
      aria-label={`Details for ${actor.displayName}`}
      className="person-panel"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "min(360px, 100vw)",
        background: "var(--surface)",
        borderLeft: "1px solid var(--ink-200)",
        padding: 24,
        overflowY: "auto",
        display: "grid",
        gap: 16,
        alignContent: "start",
      }}
    >
      <button
        onClick={onClose}
        aria-label="Close panel"
        style={{
          justifySelf: "end",
          background: "none",
          border: "none",
          fontSize: "var(--fs-base)",
          color: "var(--ink-500)",
          cursor: "pointer",
        }}
      >
        Close
      </button>

      <div>
        <h2 style={{ fontSize: "var(--fs-lg)", lineHeight: "var(--lh-tight)", color: "var(--ink-900)" }}>
          {actor.displayName}
        </h2>
        <p style={{ fontSize: "var(--fs-base)", color: "var(--ink-600)" }}>
          {[actor.personKind, actor.homeUnit?.name].filter(Boolean).join(" · ") || actor.kind}
        </p>
      </div>

      {actor.topConcepts.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {actor.topConcepts.map((chip) => (
            <ConceptChip key={chip.conceptId} chip={chip} />
          ))}
        </div>
      )}

      <ReasonList reasons={reasons} />

      {actor.kind === "person" && <AiSummary key={actor.id} actorId={actor.id} name={actor.displayName} />}

      <div>
        {sent ? (
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--ink-600)" }}>
            {sent.state === "accepted" ? "Message sent." : `Request sent — ${actor.displayName} will see it and can accept.`}{" "}
            <Link to={`/collaborations?tab=messages&c=${sent.id}`}>Open conversation</Link>
          </p>
        ) : composing ? (
          <form onSubmit={handleSend} style={{ display: "grid", gap: 8 }}>
            <textarea
              autoFocus
              rows={4}
              maxLength={4000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label={`Message to ${actor.displayName}`}
              placeholder="Say hello, and why you're reaching out"
              style={{ ...inputStyle, resize: "vertical" }}
            />
            <p style={{ fontSize: "var(--fs-xs)", color: "var(--ink-500)" }}>
              Sent as a request — {actor.displayName} chooses whether to accept.
            </p>
            {error && <p style={{ fontSize: "var(--fs-sm)", color: "#b3261e" }}>{error}</p>}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" disabled={busy || !text.trim()} style={buttonStyle}>
                Send request
              </button>
              <button type="button" onClick={() => setComposing(false)} style={secondaryButtonStyle}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <ContactBlock actor={actor} onRequestIntro={() => setComposing(true)} />
        )}
      </div>
    </aside>
  );
}
