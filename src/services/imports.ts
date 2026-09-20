import { pool, withTransaction } from "../db.js";
import type { Queryable } from "../db.js";
import { enqueue } from "../queue.js";
import { extractInterests, ingestExtractedItems } from "./extraction.js";
import { fetchGithubProfile, profileToSourceText, type GithubRepo } from "./github.js";
import { findOffering, parseCourseLines } from "./courses.js";
import type { CourseOffering, ImportKind, ImportSummary } from "../types.js";

// Strength, by how direct a statement of interest the source is. Declared
// interests are 1.0 and coursework is ~0.4 (data model handoff,
// actor_concept.strength); everything here sits on that scale.
const STRENGTH = {
  resume: 0.7,
  linkedin: 0.7,
  github: 0.6,
  courses: 0.4,
} as const satisfies Record<ImportKind, number>;

export interface CreateImportInput {
  actorId: string;
  kind: ImportKind;
  origin?: string;
  rawText?: string;
  /** Courses only: the offerings the person confirmed they are enrolled in. */
  courses?: CourseOffering[];
}

// The import row and its job are written in one transaction, same rule as
// every other enqueue in this codebase: a crash never leaves an import
// sitting 'pending' with nothing behind it.
export async function createImport(input: CreateImportInput): Promise<string> {
  return withTransaction(async (client) => {
    const payloadText =
      input.kind === "courses" && input.courses
        ? JSON.stringify(input.courses)
        : (input.rawText ?? "");

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO import_source (actor_id, kind, origin, raw_text)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [input.actorId, input.kind, input.origin ?? null, payloadText],
    );
    const importId = rows[0].id;
    await enqueue(client, "ingest_import", { importId });
    return importId;
  });
}

interface ImportRow {
  id: string;
  actor_id: string;
  kind: ImportKind;
  origin: string | null;
  raw_text: string | null;
  status: "pending" | "running" | "done" | "failed";
}

export async function getImportRow(importId: string): Promise<ImportRow | null> {
  const { rows } = await pool.query<ImportRow>(
    `SELECT id, actor_id, kind, origin, raw_text, status FROM import_source WHERE id = $1`,
    [importId],
  );
  return rows[0] ?? null;
}

async function setStatus(
  importId: string,
  status: "running" | "done" | "failed",
  detail?: string,
): Promise<void> {
  await pool.query(
    `UPDATE import_source
     SET status = $2, detail = $3,
         completed_at = CASE WHEN $2 IN ('done', 'failed') THEN now() ELSE NULL END
     WHERE id = $1`,
    [importId, status, detail ?? null],
  );
}

// One row per import, with the counts that make the pipeline legible:
// extraction and resolution are separate async stages, so "found" and
// "resolved" are counted separately rather than averaged into a percentage.
export async function listImports(actorId: string): Promise<ImportSummary[]> {
  const { rows } = await pool.query(
    `SELECT i.id, i.kind, i.origin, i.status, i.detail, i.created_at, i.completed_at,
            (SELECT count(*) FROM actor_concept ac WHERE ac.import_id = i.id) AS concepts_found,
            (SELECT count(*) FROM actor_concept ac
              WHERE ac.import_id = i.id AND ac.concept_id IS NOT NULL) AS concepts_resolved,
            (SELECT count(*) FROM edge e WHERE e.import_id = i.id) AS contexts_linked
     FROM import_source i
     WHERE i.actor_id = $1
     ORDER BY i.created_at DESC`,
    [actorId],
  );

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    origin: row.origin ?? undefined,
    status: row.status,
    detail: row.detail ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : undefined,
    conceptsFound: Number(row.concepts_found),
    conceptsResolved: Number(row.concepts_resolved),
    contextsLinked: Number(row.contexts_linked),
  }));
}

// ---------------------------------------------------------------------------
// Processing — called by the worker, kept here so it is testable without one.
// ---------------------------------------------------------------------------

export async function processImport(importId: string): Promise<void> {
  const row = await getImportRow(importId);
  if (!row) throw new Error(`import ${importId} not found`);

  await setStatus(importId, "running");
  try {
    const detail = await runImport(row);
    await setStatus(importId, "done", detail);
  } catch (err) {
    // An import failing is a normal outcome (a bad GitHub handle, a scanned
    // PDF, a rate limit) and belongs on the person's screen, not only in a
    // worker log — so the message is written to the row before rethrowing.
    const message = err instanceof Error ? err.message : String(err);
    await setStatus(importId, "failed", message);
    throw err;
  }
}

async function runImport(row: ImportRow): Promise<string> {
  switch (row.kind) {
    case "resume":
    case "linkedin":
      return runTextImport(row);
    case "github":
      return runGithubImport(row);
    case "courses":
      return runCoursesImport(row);
  }
}

async function runTextImport(row: ImportRow): Promise<string> {
  const sourceText = (row.raw_text ?? "").trim();
  if (!sourceText) {
    throw new Error("no readable text in the upload (a scanned PDF has no text layer — paste the text instead)");
  }

  const { items, via } = await extractInterests(sourceText);
  if (items.length === 0) {
    throw new Error("no interests could be extracted from this source");
  }

  await withTransaction((client) =>
    ingestExtractedItems(client, row.actor_id, items, {
      source: row.kind,
      strength: STRENGTH[row.kind],
      importId: row.id,
    }),
  );

  return `${items.length} interest(s) extracted (${via})`;
}

async function runGithubImport(row: ImportRow): Promise<string> {
  const login = (row.origin ?? row.raw_text ?? "").trim().replace(/^@/, "");
  if (!login) throw new Error("no GitHub username given");

  const profile = await fetchGithubProfile(login);
  const sourceText = profileToSourceText(profile);
  const { items, via } = await extractInterests(sourceText);

  // Repositories are projects, and a project is a context: two people on the
  // same repo is a shared context, scored by the same recency-weighted term
  // as a shared lab. Forks are excluded — someone else's work is not
  // evidence of yours.
  const owned = profile.repos.filter((repo) => !repo.fork);

  await withTransaction(async (client) => {
    await client.query(`UPDATE import_source SET raw_text = $2 WHERE id = $1`, [row.id, sourceText]);
    await ingestExtractedItems(client, row.actor_id, items, {
      source: "github",
      strength: STRENGTH.github,
      importId: row.id,
    });
    for (const repo of owned) {
      await linkRepoContext(client, row.actor_id, repo, row.id);
    }
  });

  return `${items.length} interest(s) extracted (${via}), ${owned.length} repo(s) linked`;
}

async function runCoursesImport(row: ImportRow): Promise<string> {
  const offerings = parseCoursePayload(row.raw_text ?? "");
  if (offerings.length === 0) throw new Error("no courses given");

  // One extraction call over the combined descriptions rather than one per
  // course: the same reason the instruct pool is capped at two, and the
  // model sees more context this way.
  const sourceText = offerings
    .map((c) => `${c.code} ${c.title} (${c.term}): ${c.description}`)
    .join("\n");
  const { items, via } = await extractInterests(sourceText);

  await withTransaction(async (client) => {
    for (const course of offerings) {
      await linkCourseContext(client, row.actor_id, course, row.id);
    }
    // The course titles themselves are interests too — "Introduction to
    // Machine Learning" resolves to the same concept a typed "ML" does, and
    // at coursework strength it never outweighs a declared one.
    await ingestExtractedItems(
      client,
      row.actor_id,
      dedupe([...offerings.map((c) => c.title), ...items]),
      { source: "course", strength: STRENGTH.courses, importId: row.id },
    );
  });

  return `${offerings.length} course(s) linked, ${items.length} topic(s) extracted (${via})`;
}

// The courses payload is either the JSON the picker submitted or the lines a
// person pasted; both end up as offerings.
function parseCoursePayload(rawText: string): CourseOffering[] {
  const trimmed = rawText.trim();
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as CourseOffering[];
    return parsed.map((course) => {
      const known = findOffering(course.code);
      return {
        code: course.code,
        title: course.title || known?.title || course.code,
        term: course.term || known?.term || "",
        description: course.description || known?.description || course.title,
        startsOn: course.startsOn || known?.startsOn || "",
        endsOn: course.endsOn || known?.endsOn || "",
      };
    });
  }
  return parseCourseLines(trimmed);
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Contexts are shared, not per-person: `external_key` is what makes two
// students who took the same section land on one context row, which is the
// entire point of the shared-context signal.
async function upsertContext(
  client: Queryable,
  params: { externalKey: string; kind: string; title: string; startsOn?: string; endsOn?: string },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO context (kind, title, starts_on, ends_on, external_key)
     VALUES ($1, $2, nullif($3, '')::date, nullif($4, '')::date, $5)
     ON CONFLICT (external_key) WHERE external_key IS NOT NULL
     DO UPDATE SET title = EXCLUDED.title
     RETURNING id`,
    [params.kind, params.title, params.startsOn ?? "", params.endsOn ?? "", params.externalKey],
  );
  return rows[0].id;
}

async function linkCourseContext(
  client: Queryable,
  actorId: string,
  course: CourseOffering,
  importId: string,
): Promise<void> {
  const externalKey = `course:${course.code}:${course.term}`.toLowerCase();
  const contextId = await upsertContext(client, {
    externalKey,
    kind: "course",
    title: `${course.code} ${course.title}`.trim(),
    startsOn: course.startsOn,
    endsOn: course.endsOn,
  });

  await upsertEdge(client, {
    srcId: actorId,
    dstId: contextId,
    relation: "enrolled_in",
    weight: 1,
    // A finished course still counts, just less: valid_to is what lets
    // scoring decay it against a currently-running one.
    validFrom: course.startsOn,
    validTo: course.endsOn,
    evidence: { source: "simulated_registrar", code: course.code, term: course.term },
    importId,
  });
}

async function linkRepoContext(
  client: Queryable,
  actorId: string,
  repo: GithubRepo,
  importId: string,
): Promise<void> {
  const contextId = await upsertContext(client, {
    externalKey: `github:${repo.fullName}`.toLowerCase(),
    kind: "project",
    title: repo.name,
    startsOn: repo.createdAt ? repo.createdAt.slice(0, 10) : "",
  });

  await upsertEdge(client, {
    srcId: actorId,
    dstId: contextId,
    relation: "authored",
    // Stars are a weak popularity signal, not a strength one; a lightly
    // starred repo you actually wrote still counts as authorship.
    weight: 1,
    validFrom: repo.createdAt ? repo.createdAt.slice(0, 10) : "",
    validTo: "", // still yours; null valid_to means current
    evidence: { source: "github", url: repo.htmlUrl, language: repo.language },
    importId,
  });
}

async function upsertEdge(
  client: Queryable,
  params: {
    srcId: string;
    dstId: string;
    relation: string;
    weight: number;
    validFrom?: string;
    validTo?: string;
    evidence: Record<string, unknown>;
    importId: string;
  },
): Promise<void> {
  // Re-importing is a normal thing to do on stage, so the same enrolment
  // must not stack up duplicate edges (which would multiply its score).
  await client.query(
    `INSERT INTO edge (src_id, src_type, dst_id, dst_type, relation, weight,
                       valid_from, valid_to, evidence, import_id)
     SELECT $1, 'actor', $2, 'context', $3, $4,
            nullif($5, '')::date, nullif($6, '')::date, $7::jsonb, $8
     WHERE NOT EXISTS (
       SELECT 1 FROM edge
       WHERE src_id = $1 AND src_type = 'actor' AND dst_id = $2 AND dst_type = 'context'
         AND relation = $3
     )`,
    [
      params.srcId,
      params.dstId,
      params.relation,
      params.weight,
      params.validFrom ?? "",
      params.validTo ?? "",
      JSON.stringify(params.evidence),
      params.importId,
    ],
  );
}
