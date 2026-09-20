import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { Server } from "@hocuspocus/server";
import * as Y from "yjs";
import { readSessionIdFromCookies, resolveSession } from "../auth/session.js";
import { pool } from "../db.js";
import { collabHooks, MAX_TEXT_BYTES } from "../services/workspaces.js";

// Live co-editing of text files. One Yjs document per workspace_node (the
// document name is the node id). Auth is the same signed session cookie as
// the REST API — the WebSocket handshake carries it — plus an Origin check,
// since browsers don't apply SameSite/CORS rules to WebSocket handshakes.
// Access is re-checked against the database on every connect.

interface Ctx {
  actorId: string;
  workspaceId: string;
}

const PATH = "/collab";

function originAllowed(origin: string | null | undefined, host: string | null | undefined): boolean {
  if (!origin) return false; // browsers always send one; scripts must set it deliberately
  try {
    const extra = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return new URL(origin).host === host || extra.includes(origin);
  } catch {
    return false;
  }
}

// Hocuspocus 4 owns its own http.Server + WebSocket adapter; we never listen
// on it, and instead forward matching upgrade requests from the API's server.
const collab = new Server({
  // Persist 2s after the last edit, and at least every 10s during a long burst.
  websocketOptions: { maxPayload: 4 * 1024 * 1024 },
  debounce: 2000,
  maxDebounce: 10000,

  async onAuthenticate({ documentName, request }): Promise<Ctx> {
    // The client's token is ignored: identity comes from the cookie only.
    if (!originAllowed(request.headers.get("origin"), request.headers.get("host"))) throw new Error("forbidden");
    const sid = readSessionIdFromCookies(request.headers.get("cookie") ?? undefined);
    const session = sid ? await resolveSession(sid) : null;
    if (!session) throw new Error("unauthenticated");
    if (!/^[0-9a-f-]{36}$/i.test(documentName)) throw new Error("not_found");

    const { rows } = await pool.query<{ workspace_id: string }>(
      `SELECT n.workspace_id FROM workspace_node n
       JOIN workspace_member m ON m.workspace_id = n.workspace_id AND m.actor_id = $2 AND m.state = 'active'
       WHERE n.id = $1 AND n.kind = 'file' AND n.storage_key IS NULL`,
      [documentName, session.actorId],
    );
    // Same answer for "no such file" and "not yours".
    if (!rows[0]) throw new Error("not_found");
    return { actorId: session.actorId, workspaceId: rows[0].workspace_id };
  },

  async onLoadDocument({ document, documentName }) {
    const { rows } = await pool.query<{ ydoc: Buffer | null; text_content: string | null }>(
      `SELECT ydoc, text_content FROM workspace_node WHERE id = $1`,
      [documentName],
    );
    const row = rows[0];
    if (!row) return;
    if (row.ydoc) Y.applyUpdate(document, new Uint8Array(row.ydoc));
    else if (row.text_content) document.getText("content").insert(0, row.text_content);
  },

  async onStoreDocument({ document, documentName }) {
    const text = document.getText("content").toString();
    const bytes = Buffer.byteLength(text);
    if (bytes > MAX_TEXT_BYTES) {
      // Live editing continues but the oversized state is not persisted, so a
      // runaway paste cannot bloat the database.
      console.warn(`collab: ${documentName} is ${bytes} bytes (> ${MAX_TEXT_BYTES}); not persisted`);
      return;
    }
    await pool.query(
      `UPDATE workspace_node SET ydoc = $2, text_content = $3, size = $4, updated_at = now() WHERE id = $1`,
      [documentName, Buffer.from(Y.encodeStateAsUpdate(document)), text, bytes],
    );
  },
});

// Access ended (file deleted, member removed): drop the live connections.
collabHooks.closeNodes = (nodeIds) => {
  for (const id of nodeIds) collab.hocuspocus.closeConnections(id);
};
collabHooks.kickActor = (workspaceId, actorId) => {
  for (const doc of collab.hocuspocus.documents.values()) {
    for (const conn of doc.getConnections()) {
      const ctx = conn.context as Ctx | undefined;
      if (ctx?.workspaceId === workspaceId && ctx.actorId === actorId) conn.close();
    }
  }
};

export function attachCollab(server: HttpServer): void {
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== PATH) {
      socket.destroy();
      return;
    }
    if (!originAllowed(req.headers.origin, req.headers.host)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    collab.httpServer.emit("upgrade", req, socket, head);
  });
}
