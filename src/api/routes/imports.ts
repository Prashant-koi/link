import { Router } from "express";
import { pool } from "../../db.js";
import { COURSE_CATALOG } from "../../services/courses.js";
import { decodeUpload } from "../../services/documents.js";
import { createImport, listImports } from "../../services/imports.js";
import { getActorSummary } from "../../services/viewModels.js";
import type { CourseOffering, ImportKind } from "../../types.js";

export const importsRouter = Router();

const TEXT_KINDS: ImportKind[] = ["resume", "linkedin"];

// Auth is unresolved (backend handoff open questions), so actorId is passed
// explicitly here exactly as it is on /me/interests and /asks.

// Onboarding needs somewhere for a person who has never existed in the graph
// to come from — a demo starts with someone who has no actor row at all.
// has_account is true because they are sitting in front of the app; that is
// what routes an intro request to them rather than to a contact method.
importsRouter.post("/actors", async (req, res) => {
  const { displayName, personKind, discoverable } = req.body as {
    displayName?: string;
    personKind?: "student" | "faculty" | "staff" | "alum";
    discoverable?: boolean;
  };
  if (!displayName || !displayName.trim()) {
    return res.status(400).json({ error: "displayName is required" });
  }

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO actor (kind, person_kind, display_name, discoverable, has_account)
     VALUES ('person', $1, $2, $3, true)
     RETURNING id`,
    [personKind ?? "student", displayName.trim(), discoverable ?? true],
  );
  res.status(201).json(await getActorSummary(rows[0].id));
});

// The simulated course system. A real Canvas/SIS integration is out of
// scope; this is the feed it would replace, in the shape the import path
// already accepts.
importsRouter.get("/courses/catalog", (_req, res) => {
  res.json(COURSE_CATALOG);
});

importsRouter.get("/me/imports", async (req, res) => {
  const actorId = typeof req.query.actorId === "string" ? req.query.actorId : "";
  if (!actorId) return res.status(400).json({ error: "actorId is required" });
  res.json(await listImports(actorId));
});

// One endpoint for all four sources: the differences between them are which
// payload field is filled, not which pipeline runs. Everything is accepted
// immediately (202) and processed by the worker — an upload never blocks on
// the model, same rule as every other write in this API.
importsRouter.post("/me/imports", async (req, res) => {
  const { actorId, kind, origin, text, filename, contentBase64, courses } = req.body as {
    actorId?: string;
    kind?: ImportKind;
    origin?: string;
    text?: string;
    filename?: string;
    contentBase64?: string;
    courses?: CourseOffering[];
  };

  if (!actorId || !kind) {
    return res.status(400).json({ error: "actorId and kind are required" });
  }
  if (!["resume", "linkedin", "github", "courses"].includes(kind)) {
    return res.status(400).json({ error: "kind must be resume, linkedin, github, or courses" });
  }

  if (kind === "github") {
    const login = (origin ?? text ?? "").trim();
    if (!login) return res.status(400).json({ error: "a GitHub username is required" });
    const id = await createImport({ actorId, kind, origin: login });
    return res.status(202).json({ id });
  }

  if (kind === "courses") {
    const hasList = Array.isArray(courses) && courses.length > 0;
    if (!hasList && !text?.trim()) {
      return res.status(400).json({ error: "courses or pasted course text is required" });
    }
    const id = await createImport({
      actorId,
      kind,
      origin: hasList ? "simulated course system" : "pasted",
      rawText: hasList ? undefined : text,
      courses: hasList ? courses : undefined,
    });
    return res.status(202).json({ id });
  }

  if (TEXT_KINDS.includes(kind)) {
    let sourceText = text?.trim() ?? "";
    let decodedVia: string | undefined;

    if (!sourceText && contentBase64) {
      // Decoding happens here rather than in the worker so an unreadable
      // file is rejected while the person is still looking at the upload
      // box, instead of surfacing thirty seconds later as a failed import.
      const decoded = await decodeUpload(contentBase64, filename);
      sourceText = decoded.text.trim();
      decodedVia = decoded.via;
      if (!sourceText) {
        return res.status(422).json({
          error:
            decodedVia === "pdf"
              ? "that PDF has no text layer (it looks scanned) — paste the text instead"
              : "no readable text in that file",
        });
      }
    }

    if (!sourceText) return res.status(400).json({ error: "text or contentBase64 is required" });

    const id = await createImport({
      actorId,
      kind,
      origin: origin ?? filename ?? "pasted",
      rawText: sourceText,
    });
    return res.status(202).json({ id });
  }

  return res.status(400).json({ error: "unsupported kind" });
});
