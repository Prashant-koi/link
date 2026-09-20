import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import multer from "multer";
import { Router } from "express";
import { HttpError } from "../../services/httpError.js";
import {
  MAX_FILE_BYTES,
  createNode,
  createWorkspace,
  deleteNode,
  deleteWorkspace,
  getWorkspace,
  inviteMembers,
  leaveWorkspace,
  listWorkspaces,
  openRaw,
  removeMember,
  renameWorkspace,
  respondToInvite,
  saveUpload,
  transferOwnership,
  updateNode,
} from "../../services/workspaces.js";
import { wrap } from "./conversations.js";

export const workspacesRouter = Router();

const uploadDir = path.join(os.tmpdir(), "link-uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: MAX_FILE_BYTES, files: 20 } });

type Body = Record<string, unknown>;

workspacesRouter.get("/workspaces", wrap(async (req, res) => res.json(await listWorkspaces(req.actorId!))));

workspacesRouter.post(
  "/workspaces",
  wrap(async (req, res) => {
    const b = req.body as Body;
    res.status(201).json(await createWorkspace(req.actorId!, b.name, b.inviteeIds));
  }),
);

workspacesRouter.get("/workspaces/:id", wrap(async (req, res) => res.json(await getWorkspace(req.actorId!, req.params.id))));

workspacesRouter.patch(
  "/workspaces/:id",
  wrap(async (req, res) => {
    await renameWorkspace(req.actorId!, req.params.id, (req.body as Body).name);
    res.status(204).end();
  }),
);

workspacesRouter.delete(
  "/workspaces/:id",
  wrap(async (req, res) => {
    await deleteWorkspace(req.actorId!, req.params.id);
    res.status(204).end();
  }),
);

workspacesRouter.post(
  "/workspaces/:id/leave",
  wrap(async (req, res) => res.json({ result: await leaveWorkspace(req.actorId!, req.params.id) })),
);

workspacesRouter.post(
  "/workspaces/:id/invites",
  wrap(async (req, res) => {
    await inviteMembers(req.actorId!, req.params.id, (req.body as Body).actorIds);
    res.status(204).end();
  }),
);
workspacesRouter.post(
  "/workspaces/:id/invite/accept",
  wrap(async (req, res) => {
    await respondToInvite(req.actorId!, req.params.id, true);
    res.status(204).end();
  }),
);
workspacesRouter.post(
  "/workspaces/:id/invite/decline",
  wrap(async (req, res) => {
    await respondToInvite(req.actorId!, req.params.id, false);
    res.status(204).end();
  }),
);

workspacesRouter.delete(
  "/workspaces/:id/members/:actorId",
  wrap(async (req, res) => {
    await removeMember(req.actorId!, req.params.id, req.params.actorId);
    res.status(204).end();
  }),
);
workspacesRouter.post(
  "/workspaces/:id/owner",
  wrap(async (req, res) => {
    const target = (req.body as Body).actorId;
    if (typeof target !== "string") throw new HttpError(400, "actorId_required");
    await transferOwnership(req.actorId!, req.params.id, target);
    res.status(204).end();
  }),
);

workspacesRouter.post(
  "/workspaces/:id/nodes",
  wrap(async (req, res) => res.status(201).json(await createNode(req.actorId!, req.params.id, req.body as Body))),
);
workspacesRouter.patch(
  "/workspaces/:id/nodes/:nodeId",
  wrap(async (req, res) => {
    await updateNode(req.actorId!, req.params.id, req.params.nodeId, req.body as Body);
    res.status(204).end();
  }),
);
workspacesRouter.delete(
  "/workspaces/:id/nodes/:nodeId",
  wrap(async (req, res) => {
    await deleteNode(req.actorId!, req.params.id, req.params.nodeId);
    res.status(204).end();
  }),
);

workspacesRouter.post(
  "/workspaces/:id/upload",
  (req, res, next) =>
    upload.array("files", 20)(req, res, (err) => {
      if (!err) return next();
      const code = (err as { code?: string }).code;
      res.status(code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: code === "LIMIT_FILE_SIZE" ? "file_too_large" : "upload_failed" });
    }),
  wrap(async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const parentId = typeof req.body?.parentId === "string" && req.body.parentId ? req.body.parentId : null;
    const created = [];
    const failed: { name: string; error: string }[] = [];
    for (const f of files) {
      try {
        created.push(await saveUpload(req.actorId!, req.params.id, f, parentId));
      } catch (err) {
        if (!(err instanceof HttpError)) throw err;
        failed.push({ name: f.originalname, error: err.code });
      }
    }
    // Nothing saved because access was refused: surface it as the error.
    if (created.length === 0 && failed.length > 0 && files.length === failed.length) {
      const first = failed[0].error;
      return res.status(first === "not_found" ? 404 : first === "name_taken" ? 409 : first.includes("full") || first.includes("many") ? 413 : 400).json({ error: first, failed });
    }
    res.status(201).json({ created, failed });
  }),
);

// Only magic-byte-verified images render inline; everything else (SVG, HTML,
// scripts, ...) is a download, with nosniff and a sandbox CSP as a backstop.
workspacesRouter.get(
  "/workspaces/:id/nodes/:nodeId/raw",
  wrap(async (req, res) => {
    const raw = await openRaw(req.actorId!, req.params.id, req.params.nodeId);
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cache-Control": "private, no-store",
      "Content-Type": raw.inline ? raw.mime : "application/octet-stream",
      "Content-Disposition": `${raw.inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(raw.name)}`,
    });
    if ("text" in raw) return res.send(raw.text);
    res.sendFile(raw.file, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: "not_found" });
    });
  }),
);
