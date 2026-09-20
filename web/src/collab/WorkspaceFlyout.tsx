import { useEffect, useRef, useState } from "react";
import { BookOpen, Plus } from "lucide-react";
import { collabApi } from "../api/collab";
import { useCollab } from "./CollabContext";

// Opens on hover, keyboard focus and click — hover alone is unusable on touch
// and for keyboard users. Esc or a click outside closes it.
export function WorkspaceRailItem({
  active,
  currentId,
  onOpenTab,
  onSelect,
  onNew,
}: {
  active: boolean;
  currentId: string | null;
  onOpenTab: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const { workspaceList, inviteCount, refresh } = useCollab();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = () => {
    window.clearTimeout(timer.current);
    setOpen(true);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), 180);
  };

  useEffect(() => {
    if (!open) return;
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

  async function respond(id: string, accept: boolean) {
    setError(null);
    try {
      await collabApi.respondInvite(id, accept);
      refresh();
      if (accept) {
        onSelect(id);
        setOpen(false);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div
      className="cl-rail-item"
      ref={wrap}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={(e) => {
        if (!wrap.current?.contains(e.relatedTarget as Node)) hide();
      }}
    >
      <button
        className="cl-rail-btn"
        aria-label="Workspaces"
        aria-pressed={active}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => {
          onOpenTab();
          setOpen((o) => !o);
        }}
      >
        <BookOpen size={20} />
        {inviteCount > 0 && <span className="cl-badge">{inviteCount}</span>}
      </button>

      {open && (
        <div className="cl-flyout" role="menu" aria-label="Workspaces">
          {workspaceList.invites.length > 0 && <h3>Invitations</h3>}
          {workspaceList.invites.map((inv) => (
            <div key={inv.workspaceId} style={{ padding: "4px 8px 8px" }}>
              <div style={{ fontWeight: 600 }}>{inv.name}</div>
              <div className="cl-sub">{inv.invitedBy ? `From ${inv.invitedBy.displayName}` : "Invitation"}</div>
              <div className="cl-actions" style={{ justifyContent: "flex-start", marginTop: 6 }}>
                <button className="cl-btn" onClick={() => respond(inv.workspaceId, true)}>
                  Accept
                </button>
                <button className="cl-btn secondary" onClick={() => respond(inv.workspaceId, false)}>
                  Decline
                </button>
              </div>
            </div>
          ))}
          <h3>Your workspaces</h3>
          {workspaceList.workspaces.length === 0 && <p className="cl-sub" style={{ padding: "4px 8px 8px" }}>None yet.</p>}
          {workspaceList.workspaces.map((w) => (
            <button
              key={w.id}
              role="menuitem"
              className="cl-flyout-row"
              aria-current={w.id === currentId}
              onClick={() => {
                onSelect(w.id);
                setOpen(false);
              }}
            >
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.name}</span>
              <span className="cl-sub">{w.memberCount} {w.memberCount === 1 ? "person" : "people"}</span>
            </button>
          ))}
          <button
            role="menuitem"
            className="cl-flyout-row"
            style={{ color: "var(--tq-600)", fontWeight: 600 }}
            onClick={() => {
              setOpen(false);
              onNew();
            }}
          >
            <Plus size={16} /> New workspace
          </button>
          {error && <div className="cl-error" role="alert">{error}</div>}
        </div>
      )}
    </div>
  );
}

