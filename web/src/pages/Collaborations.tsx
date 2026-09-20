import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import { useCollab } from "../collab/CollabContext";
import { NewWorkspaceDialog } from "../collab/Dialogs";
import { Messages } from "../collab/Messages";
import { WorkspaceRailItem } from "../collab/WorkspaceFlyout";
import { WorkspaceView } from "../collab/WorkspaceView";
import "../collab/collab.css";

// /collaborations?tab=messages&c=<conversation> | ?tab=workspaces&w=<workspace>
// Selection lives in the URL so a refresh (or a shared link) lands in the
// same place.
export function Collaborations() {
  const [params, setParams] = useSearchParams();
  const { unreadTotal, workspaceList } = useCollab();
  const [creating, setCreating] = useState(false);

  const tab = params.get("tab") === "workspaces" ? "workspaces" : "messages";
  const conversationId = params.get("c");
  const workspaceId = params.get("w");

  const go = useCallback(
    (next: Record<string, string | null>) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
      setParams(p, { replace: false });
    },
    [setParams],
  );

  const onGone = useCallback(() => go({ tab: "workspaces" }), [go]);

  return (
    <div className="cl-root">
      <nav className="cl-rail" aria-label="Collaboration sections">
        <div className="cl-rail-item">
          <button
            className="cl-rail-btn"
            aria-label="Messages"
            aria-pressed={tab === "messages"}
            onClick={() => go({ tab: "messages", c: conversationId })}
          >
            <MessageSquare size={20} />
            {unreadTotal > 0 && <span className="cl-badge">{unreadTotal > 9 ? "9+" : unreadTotal}</span>}
          </button>
        </div>
        <WorkspaceRailItem
          active={tab === "workspaces"}
          currentId={workspaceId}
          onOpenTab={() => tab !== "workspaces" && go({ tab: "workspaces", w: workspaceId })}
          onSelect={(id) => go({ tab: "workspaces", w: id })}
          onNew={() => setCreating(true)}
        />
      </nav>

      {tab === "messages" ? (
        <Messages selectedId={conversationId} onSelect={(id) => go({ tab: "messages", c: id })} />
      ) : workspaceId ? (
        <WorkspaceView key={workspaceId} id={workspaceId} onGone={onGone} />
      ) : (
        <div className="cl-pane">
          <div className="cl-empty">
            <p style={{ marginBottom: 12 }}>
              {workspaceList.workspaces.length === 0
                ? "Workspaces are shared folders you edit together, live. Create one and invite people you've messaged."
                : "Hover the book icon to pick a workspace, or create a new one."}
            </p>
            <button className="cl-btn" onClick={() => setCreating(true)}>
              New workspace
            </button>
          </div>
        </div>
      )}

      {creating && (
        <NewWorkspaceDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            go({ tab: "workspaces", w: id });
          }}
        />
      )}
    </div>
  );
}
