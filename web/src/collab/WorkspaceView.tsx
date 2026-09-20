import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tree, type NodeApi, type NodeRendererProps, type TreeApi } from "react-arborist";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Download,
  File as FileIcon,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  Settings,
  Upload,
  X,
} from "lucide-react";
import { ApiError, collabApi } from "../api/collab";
import { useAuth } from "../auth/AuthContext";
import { useCollab } from "./CollabContext";
import { SettingsDialog } from "./Dialogs";
import { CollabEditor } from "./Editor";
import type { NodeView, WorkspaceDetail } from "./types";
import { Avatar, Dialog, formatBytes, useMedia } from "./ui";

interface TreeNode {
  id: string;
  name: string;
  data: NodeView;
  children?: TreeNode[];
}

function buildTree(nodes: NodeView[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const n of nodes) byId.set(n.id, { id: n.id, name: n.name, data: n, children: n.kind === "folder" ? [] : undefined });
  const roots: TreeNode[] = [];
  for (const n of nodes) {
    const tn = byId.get(n.id)!;
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    (parent?.children ?? roots).push(tn);
  }
  return roots;
}

// Callback-ref based: the element mounts after the workspace has loaded, not
// with the component, so an effect keyed on a plain ref would never see it.
function useSize<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.floor(width), height: Math.floor(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, size] as const;
}

function iconFor(n: NodeView, open: boolean) {
  if (n.kind === "folder") return open ? <FolderOpen size={16} /> : <Folder size={16} />;
  if (n.mime?.startsWith("image/")) return <ImageIcon size={16} />;
  return n.isText ? <FileText size={16} /> : <FileIcon size={16} />;
}

export function WorkspaceView({ id, onGone, initialFileId }: { id: string; onGone: () => void; initialFileId?: string | null }) {
  const { actor } = useAuth();
  const { subscribe, live } = useCollab();
  const narrow = useMedia("(max-width: 700px)");
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ kind: "file" | "folder"; parentId: string | null } | null>(null);
  const [newName, setNewName] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; node: NodeView } | null>(null);
  const [deleting, setDeleting] = useState<NodeView[] | null>(null);
  const [settings, setSettings] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mobileTree, setMobileTree] = useState(true);
  const tree = useRef<TreeApi<TreeNode> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadParent = useRef<string | null>(null);
  const [hostRef, size] = useSize<HTMLDivElement>();

  const load = useCallback(async () => {
    try {
      setDetail(await collabApi.workspace(id));
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 401)) onGone();
    }
  }, [id, onGone]);

  useEffect(() => {
    setDetail(null);
    setOpenIds([]);
    setActiveId(null);
    setSelectedId(null);
    load();
  }, [id, load]);
  useEffect(() => subscribe((t, wid) => t === "workspace_update" && wid === id && load()), [subscribe, id, load]);
  useEffect(() => {
    if (live) load(); // resync after the event stream reconnects
  }, [live, load]);

  // Close tabs whose file was deleted (by anyone).
  useEffect(() => {
    if (!detail) return;
    const ids = new Set(detail.nodes.map((n) => n.id));
    setOpenIds((prev) => prev.filter((x) => ids.has(x)));
    setActiveId((prev) => (prev && ids.has(prev) ? prev : null));
    setSelectedId((prev) => (prev && ids.has(prev) ? prev : null));
  }, [detail]);

  // Deep link from an AI source chip: open that file once the tree has loaded.
  const openedInitial = useRef(false);
  useEffect(() => {
    if (!detail || !initialFileId || openedInitial.current) return;
    if (detail.nodes.some((n) => n.id === initialFileId && n.kind === "file")) {
      openedInitial.current = true;
      openFile(initialFileId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, initialFileId]);

  // Context menu: Esc or any click elsewhere dismisses it.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const nodesById = useMemo(() => new Map((detail?.nodes ?? []).map((n) => [n.id, n])), [detail]);
  const data = useMemo(() => buildTree(detail?.nodes ?? []), [detail]);

  const fail = (e: unknown) => setNotice((e as Error).message);
  const targetParent = (): string | null => {
    const sel = selectedId ? nodesById.get(selectedId) : undefined;
    if (!sel) return null;
    return sel.kind === "folder" ? sel.id : sel.parentId;
  };

  function openFile(nodeId: string) {
    setOpenIds((prev) => (prev.includes(nodeId) ? prev : [...prev, nodeId]));
    setActiveId(nodeId);
    setMobileTree(false);
  }
  function closeTab(nodeId: string) {
    setOpenIds((prev) => {
      const next = prev.filter((x) => x !== nodeId);
      if (activeId === nodeId) setActiveId(next[next.length - 1] ?? null);
      return next;
    });
  }

  async function submitNew(e: React.FormEvent) {
    e.preventDefault();
    if (!creating || !newName.trim()) return;
    try {
      const node = await collabApi.createNode(id, creating.kind, newName.trim(), creating.parentId);
      setCreating(null);
      setNewName("");
      await load();
      if (node.kind === "file") openFile(node.id);
    } catch (err) {
      fail(err);
    }
  }

  async function doUpload(files: File[], parentId: string | null) {
    if (files.length === 0) return;
    setNotice(`Uploading ${files.length} file${files.length > 1 ? "s" : ""}…`);
    try {
      const { failed } = await collabApi.upload(id, files, parentId);
      setNotice(failed.length ? `Some files were skipped: ${failed.map((f) => `${f.name} (${f.error})`).join(", ")}` : null);
    } catch (err) {
      fail(err);
    }
    load();
  }

  async function confirmDelete() {
    const nodes = deleting ?? [];
    setDeleting(null);
    try {
      for (const n of nodes) await collabApi.deleteNode(id, n.id);
    } catch (err) {
      fail(err);
    }
    load();
  }

  const Row = useCallback(
    ({ node, style, dragHandle }: NodeRendererProps<TreeNode>) => {
      const n = node.data.data;
      return (
        <div
          ref={dragHandle}
          style={style}
          className={`cl-node${node.isSelected ? " selected" : ""}${node.state.isDragging ? " dragging" : ""}${node.state.willReceiveDrop ? " willReceiveDrop" : ""}`}
          onClick={() => n.kind === "folder" && node.toggle()}
          onContextMenu={(e) => {
            e.preventDefault();
            node.select();
            setMenu({ x: e.clientX, y: e.clientY, node: n });
          }}
        >
          {n.kind === "folder" ? (node.isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span style={{ width: 14 }} />}
          {iconFor(n, node.isOpen)}
          {node.isEditing ? (
            <input
              autoFocus
              defaultValue={n.name}
              aria-label={`Rename ${n.name}`}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => node.reset()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Escape") node.reset();
                if (e.key === "Enter") node.submit(e.currentTarget.value);
              }}
            />
          ) : (
            <span className="name">{n.name}</span>
          )}
        </div>
      );
    },
    [],
  );

  if (!detail || !actor) {
    return (
      <div className="cl-pane">
        <p className="cl-empty">Loading workspace…</p>
      </div>
    );
  }

  const active = activeId ? nodesById.get(activeId) : undefined;
  const parentLabel = (() => {
    const p = creating?.parentId ? nodesById.get(creating.parentId) : undefined;
    return p ? p.name : "root";
  })();

  const treePane = (
    <div className="cl-tree-pane">
      <div className="cl-tree-tools">
        <span className="cl-sub">Files</span>
        <button className="cl-icon-btn" aria-label="New file" title="New file" onClick={() => { setCreating({ kind: "file", parentId: targetParent() }); setNewName(""); }}>
          <FilePlus size={16} />
        </button>
        <button className="cl-icon-btn" aria-label="New folder" title="New folder" onClick={() => { setCreating({ kind: "folder", parentId: targetParent() }); setNewName(""); }}>
          <FolderPlus size={16} />
        </button>
        <button className="cl-icon-btn" aria-label="Upload files" title="Upload files" onClick={() => { uploadParent.current = targetParent(); fileInput.current?.click(); }}>
          <Upload size={16} />
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            doUpload([...(e.target.files ?? [])], uploadParent.current);
            e.target.value = "";
          }}
        />
      </div>
      {creating && (
        <form className="cl-newrow" onSubmit={submitNew}>
          {creating.kind === "file" ? <FilePlus size={14} /> : <FolderPlus size={14} />}
          <input
            className="cl-input"
            style={{ padding: "2px 6px", fontSize: "var(--fs-sm)" }}
            autoFocus
            aria-label={`New ${creating.kind} name`}
            placeholder={`New ${creating.kind} in ${parentLabel}`}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setCreating(null)}
          />
        </form>
      )}
      <div
        ref={hostRef}
        className={`cl-tree-host${dropping ? " dropping" : ""}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDropping(true);
          }
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => {
          setDropping(false);
          if (e.dataTransfer.files.length > 0) {
            e.preventDefault();
            doUpload([...e.dataTransfer.files], targetParent());
          }
        }}
      >
        {detail.nodes.length === 0 && (
          <p className="cl-sub" style={{ padding: 16 }}>
            Empty. Create a file, or drop files here to upload.
          </p>
        )}
        {size.width > 0 && (
          <Tree<TreeNode>
            ref={tree}
            data={data}
            width={size.width}
            height={size.height}
            rowHeight={28}
            indent={16}
            openByDefault={false}
            disableMultiSelection
            selection={selectedId ?? undefined}
            onSelect={(nodes) => setSelectedId(nodes[0]?.id ?? null)}
            onActivate={(node: NodeApi<TreeNode>) => node.data.data.kind === "file" && openFile(node.id)}
            onRename={async ({ id: nodeId, name }) => {
              try {
                await collabApi.updateNode(id, nodeId, { name });
              } catch (err) {
                fail(err);
              }
              load();
            }}
            onMove={async ({ dragIds, parentId }) => {
              try {
                for (const d of dragIds) await collabApi.updateNode(id, d, { parentId });
              } catch (err) {
                fail(err);
              }
              load();
            }}
            onDelete={({ ids }) => setDeleting(ids.map((i) => nodesById.get(i)).filter((n): n is NodeView => !!n))}
            disableDrop={({ parentNode }) => !!parentNode.data && parentNode.data.data.kind !== "folder"}
          >
            {Row}
          </Tree>
        )}
      </div>
    </div>
  );

  const editorPane = (
    <div className="cl-editor-pane">
      {(openIds.length > 0 || narrow) && (
        <div className="cl-tabs" role="tablist" aria-label="Open files">
          {narrow && (
            <button className="cl-tab" onClick={() => setMobileTree(true)} aria-label="Back to files">
              <ArrowLeft size={14} /> Files
            </button>
          )}
          {openIds.map((oid) => {
            const n = nodesById.get(oid);
            if (!n) return null;
            return (
              <button key={oid} role="tab" aria-selected={oid === activeId} className="cl-tab" onClick={() => setActiveId(oid)}>
                {iconFor(n, false)}
                {n.name}
                <span
                  className="x"
                  role="button"
                  aria-label={`Close ${n.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(oid);
                  }}
                >
                  <X size={12} />
                </span>
              </button>
            );
          })}
        </div>
      )}
      {!active ? (
        <p className="cl-empty">Open a file from the tree to start editing. Everyone in the workspace edits the same live copy.</p>
      ) : active.isText ? (
        <CollabEditor key={active.id} nodeId={active.id} name={active.name} user={{ id: actor.id, name: actor.displayName }} />
      ) : active.mime?.startsWith("image/") ? (
        <div className="cl-viewer">
          <img src={collabApi.rawUrl(id, active.id)} alt={active.name} />
        </div>
      ) : (
        <div className="cl-viewer">
          <div style={{ textAlign: "center", display: "grid", gap: 8, justifyItems: "center" }}>
            <FileIcon size={40} color="var(--ink-500)" />
            <strong>{active.name}</strong>
            <span className="cl-sub">{formatBytes(active.size)} · can't be previewed</span>
            <a className="cl-btn" style={{ textDecoration: "none" }} href={collabApi.rawUrl(id, active.id)} download={active.name}>
              <Download size={16} /> Download
            </a>
          </div>
        </div>
      )}
    </div>
  );

  const activeMembers = detail.members.filter((m) => m.state === "active");

  return (
    <div className="cl-pane">
      <div className="cl-pane-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail.name}</h2>
          <p className="cl-sub">
            {formatBytes(detail.usedBytes)} of {formatBytes(detail.limits.workspace)} used
          </p>
        </div>
        <div style={{ display: "flex" }} aria-label="Members">
          {activeMembers.slice(0, 5).map((m) => (
            <span key={m.actorId} title={m.displayName} style={{ marginLeft: -6 }}>
              <Avatar name={m.displayName} small />
            </span>
          ))}
        </div>
        <button className="cl-icon-btn" aria-label="Workspace settings" title="Workspace settings" onClick={() => setSettings(true)}>
          <Settings size={18} />
        </button>
      </div>

      {notice && (
        <div className="cl-banner" role="status">
          <span>{notice}</span>
          <button className="cl-icon-btn" aria-label="Dismiss" onClick={() => setNotice(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="cl-ws-body">
        {narrow ? (
          <div className="cl-group">{mobileTree ? treePane : editorPane}</div>
        ) : (
          <Group orientation="horizontal" className="cl-group">
            <Panel defaultSize="24%" minSize="160px" maxSize="50%">
              {treePane}
            </Panel>
            <Separator className="cl-sep" />
            <Panel minSize="30%">{editorPane}</Panel>
          </Group>
        )}
      </div>

      {menu && (
        <div className="cl-menu" style={{ left: menu.x, top: menu.y }} role="menu">
          {menu.node.kind === "folder" && (
            <>
              <button role="menuitem" onClick={() => { setCreating({ kind: "file", parentId: menu.node.id }); setNewName(""); }}>New file here</button>
              <button role="menuitem" onClick={() => { setCreating({ kind: "folder", parentId: menu.node.id }); setNewName(""); }}>New folder here</button>
              <button role="menuitem" onClick={() => { uploadParent.current = menu.node.id; fileInput.current?.click(); }}>Upload here</button>
            </>
          )}
          <button role="menuitem" onClick={() => tree.current?.get(menu.node.id)?.edit()}>Rename</button>
          <button role="menuitem" onClick={() => setDeleting([menu.node])}>Delete</button>
        </div>
      )}

      {deleting && (
        <Dialog title="Delete?" onClose={() => setDeleting(null)}>
          <p>
            Delete <strong>{deleting.map((n) => n.name).join(", ")}</strong>
            {deleting.some((n) => n.kind === "folder") ? " and everything inside it" : ""} for everyone in this workspace? This can't be undone.
          </p>
          <div className="cl-actions">
            <button className="cl-btn secondary" onClick={() => setDeleting(null)}>
              Cancel
            </button>
            <button className="cl-btn danger" onClick={confirmDelete}>
              Delete
            </button>
          </div>
        </Dialog>
      )}

      {settings && (
        <SettingsDialog
          detail={detail}
          meId={actor.id}
          onClose={() => setSettings(false)}
          onChanged={load}
          onLeft={() => {
            setSettings(false);
            onGone();
          }}
        />
      )}
    </div>
  );
}
