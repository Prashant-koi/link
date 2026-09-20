import fs from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { config } from "../config.js";
import { pool, withTransaction } from "../db.js";
import { acceptedCounterparties } from "./conversations.js";
import { publish } from "./events.js";
import { HttpError } from "./httpError.js";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_WORKSPACE_BYTES = 200 * 1024 * 1024;
export const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_NODES = 2000;
const UUID = /^[0-9a-f-]{36}$/i;

// Hook so the collab server can drop live connections when access ends
// (registered by src/collab/server.ts; a no-op when running without it).
export const collabHooks = {
  closeNodes: (_nodeIds: string[]) => {},
  kickActor: (_workspaceId: string, _actorId: string) => {},
};

export interface WorkspaceListItem {
  id: string;
  name: string;
  role: "owner" | "member";
  memberCount: number;
  updatedAt: string;
}
export interface WorkspaceInvite {
  workspaceId: string;
  name: string;
  invitedBy: { id: string; displayName: string } | null;
}
export interface NodeView {
  id: string;
  parentId: string | null;
  kind: "folder" | "file";
  name: string;
  mime: string | null;
  size: number;
  isText: boolean;
  updatedAt: string;
}
export interface MemberView {
  actorId: string;
  displayName: string;
  role: "owner" | "member";
  state: "invited" | "active";
}

function assertUuid(id: string): void {
  if (!UUID.test(id)) throw new HttpError(404, "not_found");
}

// ---------- membership ----------

async function membership(actorId: string, workspaceId: string, opts: { allowInvited?: boolean } = {}) {
  assertUuid(workspaceId);
  const { rows } = await pool.query<{ role: "owner" | "member"; state: "invited" | "active" }>(
    `SELECT role, state FROM workspace_member WHERE workspace_id = $1 AND actor_id = $2`,
    [workspaceId, actorId],
  );
  const m = rows[0];
  // Non-members get 404 — don't reveal that the workspace exists.
  if (!m || (m.state !== "active" && !opts.allowInvited)) throw new HttpError(404, "not_found");
  return m;
}

async function requireOwner(actorId: string, workspaceId: string): Promise<void> {
  const m = await membership(actorId, workspaceId);
  if (m.role !== "owner") throw new HttpError(403, "owner_only");
}

async function activeMemberIds(workspaceId: string): Promise<string[]> {
  const { rows } = await pool.query<{ actor_id: string }>(
    `SELECT actor_id FROM workspace_member WHERE workspace_id = $1 AND state = 'active'`,
    [workspaceId],
  );
  return rows.map((r) => r.actor_id);
}

async function touch(workspaceId: string): Promise<void> {
  await pool.query(`UPDATE workspace SET updated_at = now() WHERE id = $1`, [workspaceId]);
  publish(await activeMemberIds(workspaceId), { type: "workspace_update", workspaceId });
}

// ---------- workspaces ----------

function cleanName(raw: unknown, what: string, max: number): string {
  if (typeof raw !== "string") throw new HttpError(400, `${what}_required`);
  const name = raw.trim();
  if (!name) throw new HttpError(400, `${what}_required`);
  if (name.length > max) throw new HttpError(400, `${what}_too_long`);
  return name;
}

function cleanNodeName(raw: unknown): string {
  const name = cleanNameRaw(raw);
  return name;
}
function cleanNameRaw(raw: unknown): string {
  const name = cleanName(raw, "name", 255);
  // No path separators or control characters; "." and ".." are reserved.
  if (/[/\\\u0000-\u001f]/.test(name) || name === "." || name === "..") throw new HttpError(400, "invalid_name");
  return name;
}

async function filterInvitees(actorId: string, ids: unknown): Promise<string[]> {
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.some((i) => typeof i !== "string" || !UUID.test(i))) throw new HttpError(400, "invalid_invitees");
  const allowed = new Set(await acceptedCounterparties(actorId));
  const unique = [...new Set(ids as string[])].filter((i) => i !== actorId);
  // Only people you already have an accepted conversation with: consent is
  // established and there is no user directory to enumerate.
  if (unique.some((i) => !allowed.has(i))) throw new HttpError(403, "invitee_not_a_contact");
  return unique;
}

export async function createWorkspace(actorId: string, rawName: unknown, inviteeIds: unknown): Promise<{ id: string }> {
  const name = cleanName(rawName, "name", 80);
  const invitees = await filterInvitees(actorId, inviteeIds);
  const id = await withTransaction(async (client) => {
    const ws = await client.query<{ id: string }>(
      `INSERT INTO workspace (name, created_by) VALUES ($1, $2) RETURNING id`,
      [name, actorId],
    );
    const wsId = ws.rows[0].id;
    await client.query(
      `INSERT INTO workspace_member (workspace_id, actor_id, role, state, joined_at)
       VALUES ($1, $2, 'owner', 'active', now())`,
      [wsId, actorId],
    );
    for (const inv of invitees) {
      await client.query(
        `INSERT INTO workspace_member (workspace_id, actor_id, role, state, invited_by) VALUES ($1, $2, 'member', 'invited', $3)`,
        [wsId, inv, actorId],
      );
    }
    return wsId;
  });
  for (const inv of invitees) publish([inv], { type: "workspace_invite", workspaceId: id });
  return { id };
}

export async function listWorkspaces(actorId: string): Promise<{ workspaces: WorkspaceListItem[]; invites: WorkspaceInvite[] }> {
  const ws = await pool.query(
    `SELECT w.id, w.name, m.role, w.updated_at,
            (SELECT count(*) FROM workspace_member x WHERE x.workspace_id = w.id AND x.state = 'active') AS members
     FROM workspace_member m JOIN workspace w ON w.id = m.workspace_id
     WHERE m.actor_id = $1 AND m.state = 'active'
     ORDER BY w.updated_at DESC`,
    [actorId],
  );
  const inv = await pool.query(
    `SELECT w.id, w.name, a.id AS by_id, a.display_name AS by_name
     FROM workspace_member m JOIN workspace w ON w.id = m.workspace_id
     LEFT JOIN actor a ON a.id = m.invited_by
     WHERE m.actor_id = $1 AND m.state = 'invited'
     ORDER BY m.created_at DESC`,
    [actorId],
  );
  return {
    workspaces: ws.rows.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      memberCount: Number(r.members),
      updatedAt: r.updated_at.toISOString(),
    })),
    invites: inv.rows.map((r) => ({
      workspaceId: r.id,
      name: r.name,
      invitedBy: r.by_id ? { id: r.by_id, displayName: r.by_name } : null,
    })),
  };
}

export async function getWorkspace(actorId: string, workspaceId: string) {
  const me = await membership(actorId, workspaceId);
  const ws = await pool.query(`SELECT id, name, created_at FROM workspace WHERE id = $1`, [workspaceId]);
  const members = await pool.query(
    `SELECT m.actor_id, a.display_name, m.role, m.state
     FROM workspace_member m JOIN actor a ON a.id = m.actor_id
     WHERE m.workspace_id = $1 ORDER BY (m.role = 'owner') DESC, a.display_name`,
    [workspaceId],
  );
  const nodes = await pool.query(
    `SELECT id, parent_id, kind, name, mime, size, (kind = 'file' AND storage_key IS NULL) AS is_text, updated_at
     FROM workspace_node WHERE workspace_id = $1 ORDER BY kind, lower(name)`,
    [workspaceId],
  );
  const usage = await pool.query(`SELECT COALESCE(sum(size), 0) AS used FROM workspace_node WHERE workspace_id = $1`, [workspaceId]);
  return {
    id: ws.rows[0].id as string,
    name: ws.rows[0].name as string,
    role: me.role,
    members: members.rows.map(
      (r): MemberView => ({ actorId: r.actor_id, displayName: r.display_name, role: r.role, state: r.state }),
    ),
    nodes: nodes.rows.map(
      (r): NodeView => ({
        id: r.id,
        parentId: r.parent_id,
        kind: r.kind,
        name: r.name,
        mime: r.mime,
        size: Number(r.size),
        isText: r.is_text,
        updatedAt: r.updated_at.toISOString(),
      }),
    ),
    usedBytes: Number(usage.rows[0].used),
    limits: { file: MAX_FILE_BYTES, workspace: MAX_WORKSPACE_BYTES },
  };
}

export async function renameWorkspace(actorId: string, workspaceId: string, rawName: unknown): Promise<void> {
  await requireOwner(actorId, workspaceId);
  await pool.query(`UPDATE workspace SET name = $2 WHERE id = $1`, [workspaceId, cleanName(rawName, "name", 80)]);
  await touch(workspaceId);
}

export async function inviteMembers(actorId: string, workspaceId: string, ids: unknown): Promise<void> {
  await requireOwner(actorId, workspaceId);
  const invitees = await filterInvitees(actorId, ids);
  for (const inv of invitees) {
    // A declined invite is deleted (below), so re-inviting is allowed.
    await pool.query(
      `INSERT INTO workspace_member (workspace_id, actor_id, role, state, invited_by)
       VALUES ($1, $2, 'member', 'invited', $3) ON CONFLICT DO NOTHING`,
      [workspaceId, inv, actorId],
    );
    publish([inv], { type: "workspace_invite", workspaceId });
  }
  await touch(workspaceId);
}

export async function respondToInvite(actorId: string, workspaceId: string, accept: boolean): Promise<void> {
  const m = await membership(actorId, workspaceId, { allowInvited: true });
  if (m.state !== "invited") throw new HttpError(409, "not_invited");
  if (accept) {
    await pool.query(
      `UPDATE workspace_member SET state = 'active', joined_at = now() WHERE workspace_id = $1 AND actor_id = $2`,
      [workspaceId, actorId],
    );
    await touch(workspaceId);
  } else {
    await pool.query(`DELETE FROM workspace_member WHERE workspace_id = $1 AND actor_id = $2`, [workspaceId, actorId]);
  }
  publish([actorId], { type: "workspace_update", workspaceId });
}

async function dropMember(workspaceId: string, targetId: string): Promise<void> {
  await pool.query(`DELETE FROM workspace_member WHERE workspace_id = $1 AND actor_id = $2`, [workspaceId, targetId]);
  collabHooks.kickActor(workspaceId, targetId);
  publish([targetId], { type: "workspace_update", workspaceId });
  await touch(workspaceId);
}

export async function removeMember(actorId: string, workspaceId: string, targetId: string): Promise<void> {
  await requireOwner(actorId, workspaceId);
  assertUuid(targetId);
  if (targetId === actorId) throw new HttpError(400, "use_leave_or_delete");
  await dropMember(workspaceId, targetId);
}

export async function transferOwnership(actorId: string, workspaceId: string, targetId: string): Promise<void> {
  await requireOwner(actorId, workspaceId);
  assertUuid(targetId);
  await withTransaction(async (client) => {
    const t = await client.query(
      `SELECT 1 FROM workspace_member WHERE workspace_id = $1 AND actor_id = $2 AND state = 'active'`,
      [workspaceId, targetId],
    );
    if (!t.rows[0] || targetId === actorId) throw new HttpError(400, "invalid_new_owner");
    // The partial unique index allows one owner: demote first.
    await client.query(`UPDATE workspace_member SET role = 'member' WHERE workspace_id = $1 AND actor_id = $2`, [workspaceId, actorId]);
    await client.query(`UPDATE workspace_member SET role = 'owner' WHERE workspace_id = $1 AND actor_id = $2`, [workspaceId, targetId]);
  });
  await touch(workspaceId);
}

export async function leaveWorkspace(actorId: string, workspaceId: string): Promise<"left" | "deleted"> {
  const m = await membership(actorId, workspaceId);
  if (m.role === "owner") {
    const others = (await activeMemberIds(workspaceId)).filter((i) => i !== actorId);
    if (others.length > 0) throw new HttpError(409, "owner_must_transfer");
    await deleteWorkspace(actorId, workspaceId);
    return "deleted";
  }
  await dropMember(workspaceId, actorId);
  return "left";
}

export async function deleteWorkspace(actorId: string, workspaceId: string): Promise<void> {
  await requireOwner(actorId, workspaceId);
  const members = await pool.query<{ actor_id: string }>(`SELECT actor_id FROM workspace_member WHERE workspace_id = $1`, [workspaceId]);
  const nodes = await pool.query<{ id: string }>(`SELECT id FROM workspace_node WHERE workspace_id = $1`, [workspaceId]);
  collabHooks.closeNodes(nodes.rows.map((n) => n.id));
  await pool.query(`DELETE FROM workspace WHERE id = $1`, [workspaceId]); // cascades members + nodes
  await fs.rm(path.join(config.workspaceDir, workspaceId), { recursive: true, force: true });
  publish(
    members.rows.map((r) => r.actor_id),
    { type: "workspace_update", workspaceId },
  );
}

// ---------- nodes ----------

async function getNode(workspaceId: string, nodeId: string) {
  assertUuid(nodeId);
  const { rows } = await pool.query(
    `SELECT id, parent_id, kind, name, mime, size, storage_key, text_content FROM workspace_node WHERE id = $1 AND workspace_id = $2`,
    [nodeId, workspaceId],
  );
  if (!rows[0]) throw new HttpError(404, "not_found");
  return rows[0];
}

async function assertFolder(client: Pick<PoolClient, "query">, workspaceId: string, parentId: string | null): Promise<void> {
  if (parentId === null) return;
  assertUuid(parentId);
  const { rows } = await client.query(`SELECT kind FROM workspace_node WHERE id = $1 AND workspace_id = $2`, [parentId, workspaceId]);
  if (!rows[0] || rows[0].kind !== "folder") throw new HttpError(400, "parent_not_a_folder");
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

async function assertRoom(client: Pick<PoolClient, "query">, workspaceId: string, addBytes: number): Promise<void> {
  const { rows } = await client.query(
    `SELECT count(*) AS n, COALESCE(sum(size), 0) AS used FROM workspace_node WHERE workspace_id = $1`,
    [workspaceId],
  );
  if (Number(rows[0].n) >= MAX_NODES) throw new HttpError(413, "too_many_files");
  if (Number(rows[0].used) + addBytes > MAX_WORKSPACE_BYTES) throw new HttpError(413, "workspace_full");
}

export async function createNode(
  actorId: string,
  workspaceId: string,
  input: { kind?: unknown; name?: unknown; parentId?: unknown },
): Promise<NodeView> {
  await membership(actorId, workspaceId);
  if (input.kind !== "file" && input.kind !== "folder") throw new HttpError(400, "invalid_kind");
  const name = cleanNodeName(input.name);
  const parentId = typeof input.parentId === "string" ? input.parentId : null;
  try {
    const node = await withTransaction(async (client) => {
      await assertFolder(client, workspaceId, parentId);
      await assertRoom(client, workspaceId, 0);
      const { rows } = await client.query(
        `INSERT INTO workspace_node (workspace_id, parent_id, kind, name, mime, text_content, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
         RETURNING id, parent_id, kind, name, mime, size, updated_at`,
        [workspaceId, parentId, input.kind, name, input.kind === "file" ? "text/plain" : null, input.kind === "file" ? "" : null, actorId],
      );
      return rows[0];
    });
    await touch(workspaceId);
    return { id: node.id, parentId: node.parent_id, kind: node.kind, name: node.name, mime: node.mime, size: 0, isText: node.kind === "file", updatedAt: node.updated_at.toISOString() };
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, "name_taken");
    throw err;
  }
}

export async function updateNode(
  actorId: string,
  workspaceId: string,
  nodeId: string,
  input: { name?: unknown; parentId?: unknown },
): Promise<void> {
  await membership(actorId, workspaceId);
  const node = await getNode(workspaceId, nodeId);
  const name = input.name === undefined ? node.name : cleanNodeName(input.name);
  let parentId: string | null = node.parent_id;
  if (input.parentId !== undefined) parentId = typeof input.parentId === "string" ? input.parentId : null;
  try {
    await withTransaction(async (client) => {
      await assertFolder(client, workspaceId, parentId);
      if (parentId) {
        // Moving a folder into itself or one of its own descendants would orphan the subtree.
        const cycle = await client.query(
          `WITH RECURSIVE up AS (
             SELECT id, parent_id FROM workspace_node WHERE id = $1
             UNION ALL SELECT n.id, n.parent_id FROM workspace_node n JOIN up ON n.id = up.parent_id
           ) SELECT 1 FROM up WHERE id = $2`,
          [parentId, nodeId],
        );
        if (cycle.rows[0]) throw new HttpError(400, "cannot_move_into_itself");
      }
      await client.query(
        `UPDATE workspace_node SET name = $3, parent_id = $4, updated_by = $5, updated_at = now() WHERE id = $1 AND workspace_id = $2`,
        [nodeId, workspaceId, name, parentId, actorId],
      );
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, "name_taken");
    throw err;
  }
  await touch(workspaceId);
}

export async function deleteNode(actorId: string, workspaceId: string, nodeId: string): Promise<void> {
  await membership(actorId, workspaceId);
  await getNode(workspaceId, nodeId);
  const { rows } = await pool.query<{ id: string; storage_key: string | null }>(
    `WITH RECURSIVE sub AS (
       SELECT id, storage_key FROM workspace_node WHERE id = $1
       UNION ALL SELECT n.id, n.storage_key FROM workspace_node n JOIN sub ON n.parent_id = sub.id
     ) SELECT id, storage_key FROM sub`,
    [nodeId],
  );
  collabHooks.closeNodes(rows.map((r) => r.id));
  await pool.query(`DELETE FROM workspace_node WHERE id = $1`, [nodeId]); // cascades to children
  for (const r of rows) if (r.storage_key) await fs.rm(path.join(config.workspaceDir, r.storage_key), { force: true });
  await touch(workspaceId);
}

// ---------- uploads & raw ----------

// Image types are decided by magic bytes, never by the client's Content-Type
// or the filename — only these are ever served inline.
export function sniffImage(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 6 && (buf.subarray(0, 6).toString("latin1") === "GIF87a" || buf.subarray(0, 6).toString("latin1") === "GIF89a")) return "image/gif";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

function looksLikeText(buf: Buffer): boolean {
  if (buf.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

export async function saveUpload(
  actorId: string,
  workspaceId: string,
  file: { path: string; originalname: string; size: number },
  parentId: string | null,
): Promise<NodeView> {
  try {
    await membership(actorId, workspaceId);
    const name = cleanNodeName(Buffer.from(file.originalname, "latin1").toString("utf8"));
    const buf = await fs.readFile(file.path);
    const image = sniffImage(buf);
    // Small UTF-8 files (source, notes) become collaborative text documents.
    const asText = !image && buf.length <= MAX_TEXT_BYTES && looksLikeText(buf);

    const node = await withTransaction(async (client) => {
      await assertFolder(client, workspaceId, parentId);
      await assertRoom(client, workspaceId, buf.length);
      const ins = await client.query(
        `INSERT INTO workspace_node (workspace_id, parent_id, kind, name, mime, size, text_content, created_by, updated_by)
         VALUES ($1, $2, 'file', $3, $4, $5, $6, $7, $7) RETURNING id, updated_at`,
        [workspaceId, parentId, name, asText ? "text/plain" : (image ?? "application/octet-stream"), buf.length, asText ? buf.toString("utf8") : null, actorId],
      );
      const id = ins.rows[0].id as string;
      if (!asText) {
        const key = `${workspaceId}/${id}`;
        await fs.mkdir(path.join(config.workspaceDir, workspaceId), { recursive: true });
        await fs.copyFile(file.path, path.join(config.workspaceDir, key));
        await client.query(`UPDATE workspace_node SET storage_key = $2 WHERE id = $1`, [id, key]);
      }
      return { id, updatedAt: ins.rows[0].updated_at as Date, mime: asText ? "text/plain" : (image ?? "application/octet-stream") };
    });
    await touch(workspaceId);
    return { id: node.id, parentId, kind: "file", name, mime: node.mime, size: buf.length, isText: asText, updatedAt: node.updatedAt.toISOString() };
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, "name_taken");
    throw err;
  } finally {
    await fs.rm(file.path, { force: true });
  }
}

export async function openRaw(actorId: string, workspaceId: string, nodeId: string) {
  await membership(actorId, workspaceId);
  const node = await getNode(workspaceId, nodeId);
  if (node.kind !== "file") throw new HttpError(400, "not_a_file");
  if (node.storage_key) {
    const abs = path.resolve(config.workspaceDir, node.storage_key);
    // storage_key is server-generated, but never let a bad row escape the dir.
    if (!abs.startsWith(path.resolve(config.workspaceDir) + path.sep)) throw new HttpError(404, "not_found");
    return { name: node.name as string, mime: node.mime as string, file: abs, inline: node.mime?.startsWith("image/") ?? false };
  }
  return { name: node.name as string, mime: "text/plain", text: (node.text_content as string) ?? "", inline: false };
}
