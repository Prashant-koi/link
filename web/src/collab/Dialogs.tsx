import { useMemo, useState } from "react";
import { collabApi } from "../api/collab";
import { useCollab } from "./CollabContext";
import type { WorkspaceDetail } from "./types";
import { Avatar, Dialog } from "./ui";

// People you can invite: only those whose conversation you both accepted.
function useContacts() {
  const { conversations } = useCollab();
  return useMemo(
    () => conversations.filter((c) => c.state === "accepted").map((c) => c.counterparty),
    [conversations],
  );
}

function ContactPicker({
  contacts,
  picked,
  onToggle,
}: {
  contacts: { id: string; displayName: string }[];
  picked: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (contacts.length === 0)
    return <p className="cl-sub">No one to invite yet. Message someone and have them accept — then you can add them here.</p>;
  return (
    <div role="group" aria-label="Collaborators" style={{ maxHeight: 200, overflowY: "auto" }}>
      {contacts.map((p) => (
        <label key={p.id} className="cl-check">
          <input type="checkbox" checked={picked.has(p.id)} onChange={() => onToggle(p.id)} />
          <Avatar name={p.displayName} small />
          {p.displayName}
        </label>
      ))}
    </div>
  );
}

function useSet() {
  const [set, setSet] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return [set, toggle, () => setSet(new Set())] as const;
}

export function NewWorkspaceDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const contacts = useContacts();
  const { refresh } = useCollab();
  const [name, setName] = useState("");
  const [picked, toggle] = useSet();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await collabApi.createWorkspace(name.trim(), [...picked]);
      refresh();
      onCreated(id);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Dialog title="New workspace" onClose={onClose}>
      <form onSubmit={create} style={{ display: "grid", gap: 16 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="cl-sub">Name</span>
          <input className="cl-input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hackathon project" />
        </label>
        <div>
          <p className="cl-sub" style={{ marginBottom: 4 }}>
            Invite collaborators (they'll need to accept)
          </p>
          <ContactPicker contacts={contacts} picked={picked} onToggle={toggle} />
        </div>
        {error && <div className="cl-error" role="alert" style={{ padding: 0 }}>{error}</div>}
        <div className="cl-actions">
          <button type="button" className="cl-btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="cl-btn" disabled={busy || !name.trim()}>
            Create
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function SettingsDialog({
  detail,
  meId,
  onClose,
  onChanged,
  onLeft,
}: {
  detail: WorkspaceDetail;
  meId: string;
  onClose: () => void;
  onChanged: () => void;
  onLeft: () => void;
}) {
  const contacts = useContacts();
  const { refresh } = useCollab();
  const isOwner = detail.role === "owner";
  const [name, setName] = useState(detail.name);
  const [picked, toggle, clearPicked] = useSet();
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const memberIds = new Set(detail.members.map((m) => m.actorId));
  const invitable = contacts.filter((c) => !memberIds.has(c.id));
  const others = detail.members.filter((m) => m.actorId !== meId && m.state === "active");

  async function run(fn: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      refresh();
      after?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Workspace settings" onClose={onClose}>
      {isOwner && (
        <form
          style={{ display: "flex", gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && name.trim() !== detail.name) run(() => collabApi.renameWorkspace(detail.id, name.trim()), onChanged);
          }}
        >
          <input className="cl-input" aria-label="Workspace name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          <button className="cl-btn secondary" disabled={busy || !name.trim() || name.trim() === detail.name}>
            Rename
          </button>
        </form>
      )}

      <div>
        <p className="cl-sub" style={{ marginBottom: 4 }}>
          Members
        </p>
        {detail.members.map((m) => (
          <div key={m.actorId} className="cl-check" style={{ justifyContent: "space-between" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Avatar name={m.displayName} small />
              {m.displayName}
              {m.actorId === meId && <span className="cl-sub">(you)</span>}
              <span className="cl-sub">{m.state === "invited" ? "invited" : m.role}</span>
            </span>
            {isOwner && m.actorId !== meId && (
              <span style={{ display: "flex", gap: 4 }}>
                {m.state === "active" && (
                  <button
                    className="cl-btn secondary"
                    disabled={busy}
                    onClick={() => run(() => collabApi.transferOwner(detail.id, m.actorId), onChanged)}
                  >
                    Make owner
                  </button>
                )}
                <button
                  className="cl-btn secondary"
                  disabled={busy}
                  onClick={() => run(() => collabApi.removeMember(detail.id, m.actorId), onChanged)}
                >
                  {m.state === "invited" ? "Cancel invite" : "Remove"}
                </button>
              </span>
            )}
          </div>
        ))}
      </div>

      {isOwner && invitable.length > 0 && (
        <div>
          <p className="cl-sub" style={{ marginBottom: 4 }}>
            Invite more people
          </p>
          <ContactPicker contacts={invitable} picked={picked} onToggle={toggle} />
          <button
            className="cl-btn"
            style={{ marginTop: 8 }}
            disabled={busy || picked.size === 0}
            onClick={() => run(() => collabApi.invite(detail.id, [...picked]), () => { clearPicked(); onChanged(); })}
          >
            Send invites
          </button>
        </div>
      )}

      {error && <div className="cl-error" role="alert" style={{ padding: 0 }}>{error}</div>}

      <div style={{ borderTop: "1px solid var(--ink-200)", paddingTop: 16, display: "grid", gap: 8 }}>
        {isOwner ? (
          <>
            {others.length > 0 && (
              <p className="cl-sub">To leave instead, make someone else the owner first.</p>
            )}
            <label style={{ display: "grid", gap: 4 }}>
              <span className="cl-sub">
                Delete this workspace and all its files for everyone. Type <strong>{detail.name}</strong> to confirm.
              </span>
              <input className="cl-input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>
            <button
              className="cl-btn danger"
              style={{ justifySelf: "start" }}
              disabled={busy || confirm !== detail.name}
              onClick={() => run(() => collabApi.deleteWorkspace(detail.id), onLeft)}
            >
              Delete workspace
            </button>
          </>
        ) : (
          <>
            <p className="cl-sub">You'll lose access to this workspace's files until someone invites you again.</p>
            <button
              className="cl-btn danger"
              style={{ justifySelf: "start" }}
              disabled={busy}
              onClick={() => run(() => collabApi.leaveWorkspace(detail.id), onLeft)}
            >
              Leave workspace
            </button>
          </>
        )}
      </div>
      <div className="cl-actions">
        <button className="cl-btn secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
