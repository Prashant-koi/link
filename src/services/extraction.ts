import { config } from "../config.js";
import { withTransaction } from "../db.js";
import { runStructuredPrompt } from "../modelRuntime.js";
import { getActivePrompt } from "../promptRegistry.js";
import { enqueue } from "../queue.js";
import type { Queryable } from "../db.js";

export interface ExtractedItems {
  items: string[];
  via: "model" | "heuristic";
}

const MAX_ITEMS = 40;
const MAX_ITEM_LENGTH = 60;

// bio_extract already does exactly this job (messy source text in, raw
// surface strings out), so an import never gets its own prompt — it reuses
// the registered one and stays traceable through the same llm_call ledger.
//
// The fallback matters for a live demo: if the model runtime is unreachable
// (LLM_BASE_URL unset, GPU host down), an upload still produces interests
// from the source text instead of failing on stage. It is visibly worse
// than the model path, and the import row says which one ran.
export async function extractInterests(sourceText: string): Promise<ExtractedItems> {
  if (config.llm.baseUrl) {
    try {
      const prompt = await getActivePrompt("bio_extract");
      const { parsed } = await runStructuredPrompt(prompt, { source_text: sourceText });
      const items = Array.isArray(parsed.items) ? (parsed.items as unknown[]) : [];
      const cleaned = cleanItems(items.filter((i): i is string => typeof i === "string"));
      if (cleaned.length > 0) return { items: cleaned, via: "model" };
    } catch (err) {
      console.warn("bio_extract unavailable, falling back to heuristic extraction:", err);
    }
  }
  return { items: heuristicExtract(sourceText), via: "heuristic" };
}

// Skills/interests sections in a resume or profile are delimited lists far
// more often than they are prose, which is the whole of this heuristic: find
// the labelled sections, split them, and take nothing from anywhere else
// rather than inventing items out of sentences.
const SECTION_HEADING =
  /^\s*(technical\s+skills|skills|core\s+competencies|technologies|tools|languages|frameworks|interests|research\s+interests|areas?\s+of\s+(?:interest|expertise)|specialties|topics)\s*[:\-—]?\s*$/i;
const INLINE_SECTION =
  /^\s*(?:technical\s+skills|skills|technologies|tools|languages|frameworks|interests|research\s+interests|specialties|topics)\s*[:\-—]\s*(.+)$/i;

export function heuristicExtract(sourceText: string): string[] {
  const lines = sourceText.split(/\r?\n/);
  const collected: string[] = [];
  let inSection = false;

  for (const line of lines) {
    const inline = line.match(INLINE_SECTION);
    if (inline) {
      collected.push(...splitList(inline[1]));
      inSection = false;
      continue;
    }

    if (SECTION_HEADING.test(line)) {
      inSection = true;
      continue;
    }

    if (!inSection) continue;

    // A blank line ends the run, and so does a line that reads like the
    // next section heading (all-caps, or Title Case with no list in it).
    const trimmed = line.trim();
    if (!trimmed || (!trimmed.includes(",") && /^[A-Z][A-Za-z ]{2,30}$/.test(trimmed))) {
      inSection = false;
      continue;
    }

    collected.push(...splitList(line));
  }

  return cleanItems(collected);
}

function splitList(text: string): string[] {
  return text
    .replace(/^[\s•·\-*—]+/, "")
    .split(/[,;|•·]|\s{3,}|\s+\/\s+/)
    .map((part) => part.trim());
}

function cleanItems(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of items) {
    const item = raw.replace(/^[\s•·\-*—]+/, "").replace(/[.;,]+$/, "").trim();
    if (item.length < 2 || item.length > MAX_ITEM_LENGTH) continue;
    if (!/[a-zA-Z]/.test(item)) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= MAX_ITEMS) break;
  }

  return out;
}

export interface IngestOptions {
  /** actor_concept.source — 'resume', 'github', 'course', … */
  source: string;
  /**
   * Declared interests are 1.0 and coursework ~0.4 (data model handoff,
   * actor_concept.strength). Extracted items sit between: the person did
   * write the source, but not as a statement of interest.
   */
  strength: number;
  importId?: string;
}

// Writes each extracted string as raw_text and enqueues its resolution in
// the same transaction — identical to the hand-typed path in
// workers/ingest.ts, so imports resolve through the same pipeline and are
// improved by the same re-runs.
export async function ingestExtractedItems(
  db: Queryable,
  actorId: string,
  items: string[],
  options: IngestOptions,
): Promise<number> {
  for (const rawText of items) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO actor_concept (actor_id, raw_text, source, strength, import_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [actorId, rawText, options.source, options.strength, options.importId ?? null],
    );
    await enqueue(db, "resolve_concept", {
      target: "actor_concept",
      targetId: rows[0].id,
      rawText,
    });
  }
  return items.length;
}

export async function ingestExtractedItemsInTransaction(
  actorId: string,
  items: string[],
  options: IngestOptions,
): Promise<number> {
  return withTransaction((client) => ingestExtractedItems(client, actorId, items, options));
}
