import { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { python } from "@codemirror/lang-python";
import { tags as t } from "@lezer/highlight";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { yCollab } from "y-codemirror.next";
import { formatBytes } from "./ui";

// Cursor colours must be distinguishable from each other, so this is the one
// place the page steps outside the single turquoise accent (the first entry
// is the accent itself).
const CURSOR_COLORS = ["#0e7c86", "#b45309", "#7c3aed", "#be185d", "#15803d", "#1d4ed8"];
function colorFor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CURSOR_COLORS[h % CURSOR_COLORS.length];
}

// Editor chrome comes from the app's tokens so it reads as part of the page.
const theme = EditorView.theme({
  "&": { color: "var(--ink-900)", backgroundColor: "var(--surface)", fontSize: "var(--fs-sm)" },
  "&.cm-focused": { outline: "none" },
  ".cm-content": { fontFamily: "var(--cl-mono)", caretColor: "var(--tq-600)", padding: "8px 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--tq-600)" },
  ".cm-gutters": {
    backgroundColor: "var(--tq-050)",
    color: "var(--ink-500)",
    border: "none",
    borderRight: "1px solid var(--ink-200)",
    fontFamily: "var(--cl-mono)",
  },
  ".cm-activeLine": { backgroundColor: "var(--tq-050)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--tq-100)", color: "var(--tq-700)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--tq-100)",
  },
  ".cm-scroller": { fontFamily: "var(--cl-mono)", lineHeight: "1.6" },
});

const highlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword], color: "var(--tq-700)", fontWeight: "600" },
    { tag: [t.string, t.special(t.string), t.regexp], color: "var(--tq-600)" },
    { tag: [t.number, t.bool, t.null, t.atom], color: "var(--ink-600)" },
    { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--ink-500)", fontStyle: "italic" },
    { tag: [t.function(t.variableName), t.definition(t.variableName), t.className, t.typeName], color: "var(--ink-900)", fontWeight: "600" },
    { tag: [t.heading], fontWeight: "700", color: "var(--tq-700)" },
    { tag: [t.link, t.url], color: "var(--tq-600)", textDecoration: "underline" },
    { tag: [t.propertyName, t.attributeName, t.tagName], color: "var(--tq-700)" },
    { tag: t.strong, fontWeight: "700" },
    { tag: t.emphasis, fontStyle: "italic" },
  ]),
);

function languageFor(name: string) {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "js":
    case "mjs":
    case "cjs":
      return [javascript()];
    case "jsx":
      return [javascript({ jsx: true })];
    case "ts":
      return [javascript({ typescript: true })];
    case "tsx":
      return [javascript({ typescript: true, jsx: true })];
    case "json":
      return [json()];
    case "md":
    case "markdown":
      return [markdown()];
    case "html":
    case "htm":
      return [html()];
    case "css":
      return [css()];
    case "py":
      return [python()];
    default:
      return [];
  }
}

type Status = "connecting" | "connected" | "disconnected" | "denied";
interface Peer {
  clientId: number;
  name: string;
  color: string;
}

export function CollabEditor({
  nodeId,
  name,
  user,
}: {
  nodeId: string;
  name: string;
  user: { id: string; name: string };
}) {
  const [status, setStatus] = useState<Status>("connecting");
  const [synced, setSynced] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [chars, setChars] = useState(0);

  // One Yjs doc + provider per open file, created and destroyed with the
  // effect (safe under StrictMode's double invoke). The session cookie
  // authenticates the socket; the token is unused by the server.
  const [session, setSession] = useState<{ provider: HocuspocusProvider; ytext: Y.Text } | null>(null);

  useEffect(() => {
    setStatus("connecting");
    setSynced(false);
    setPeers([]);
    const doc = new Y.Doc();
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/collab`;
    const provider = new HocuspocusProvider({ url, name: nodeId, document: doc, token: "cookie" });
    const color = colorFor(user.id);
    provider.awareness?.setLocalStateField("user", { name: user.name, color, colorLight: `${color}33` });
    const ytext = doc.getText("content");

    const onStatus = ({ status: s }: { status: string }) => setStatus(s as Status);
    const onSynced = () => setSynced(true);
    const onDenied = () => setStatus("denied");
    const onPeers = () => {
      const states = provider.awareness?.getStates() ?? new Map();
      const me = provider.awareness?.clientID;
      const list: Peer[] = [];
      states.forEach((st, clientId) => {
        const u = (st as { user?: { name: string; color: string } }).user;
        if (u && clientId !== me) list.push({ clientId, name: u.name, color: u.color });
      });
      setPeers(list);
    };
    const onText = () => setChars(ytext.length);
    provider.on("status", onStatus);
    provider.on("synced", onSynced);
    provider.on("authenticationFailed", onDenied);
    provider.awareness?.on("change", onPeers);
    ytext.observe(onText);
    onText();
    setSession({ provider, ytext });
    return () => {
      provider.awareness?.off("change", onPeers);
      ytext.unobserve(onText);
      provider.destroy();
      doc.destroy();
      setSession(null);
    };
  }, [nodeId, user.id, user.name]);

  const extensions = useMemo(
    () =>
      session
        ? [theme, highlight, EditorView.lineWrapping, ...languageFor(name), yCollab(session.ytext, session.provider.awareness, { undoManager: new Y.UndoManager(session.ytext) })]
        : [],
    [session, name],
  );

  const label =
    status === "denied" ? "No access" : status === "connected" ? (synced ? "Synced" : "Syncing…") : status === "connecting" ? "Connecting…" : "Offline — reconnecting";

  return (
    <div className="cl-editor-pane">
      <div className="cl-editor-host">
        {/* uncontrolled on purpose: the Yjs doc is the source of truth, and
            history is off because yCollab brings its own undo manager */}
        {session && (
        <CodeMirror
          height="100%"
          extensions={extensions}
          basicSetup={{ history: false, foldGutter: false, highlightSelectionMatches: false }}
          editable={status !== "denied"}
          aria-label={`Editing ${name}`}
        />
        )}
      </div>
      <div className="cl-statusbar" role="status">
        <span>{label}</span>
        <span className="grow" />
        {peers.length > 0 && (
          <span className="cl-presence" title={peers.map((p) => p.name).join(", ")}>
            {peers.map((p) => (
              <span key={p.clientId} className="dot" style={{ background: p.color }} />
            ))}
          </span>
        )}
        <span>{peers.length === 0 ? "Only you" : `${peers.map((p) => p.name).join(", ")} here`}</span>
        <span>{formatBytes(chars)}</span>
      </div>
    </div>
  );
}
