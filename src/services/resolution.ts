import { pool } from "../db.js";
import { config } from "../config.js";
import { embed, runStructuredPrompt } from "../modelRuntime.js";
import { getActivePrompt } from "../promptRegistry.js";
import { enqueue } from "../queue.js";
import { normalizeSurface } from "./normalize.js";

export type ResolutionResult =
  | { status: "resolved"; conceptId: string; via: "exact" | "fuzzy" | "vector" | "llm_adjudicate" | "llm_propose" }
  | { status: "needs_review"; reason: string };

interface ConceptCandidate {
  id: string;
  pref_label: string;
  definition: string;
  similarity: number;
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

function formatCandidateList(candidates: ConceptCandidate[]): string {
  if (candidates.length === 0) return "(none)";
  return candidates.map((c, i) => `[${i}] ${c.pref_label} — ${c.definition}`).join("\n");
}

async function insertAlias(
  surface: string,
  surfaceNorm: string,
  conceptId: string,
  source: string,
  confidence: number,
  promptVersion: number | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO concept_alias (surface, surface_norm, concept_id, source, confidence, prompt_version)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (surface_norm) DO NOTHING`,
    [surface, surfaceNorm, conceptId, source, confidence, promptVersion],
  );
}

// Exact alias + fuzzy trigram only — no model call, safe to run inline on a
// read path (e.g. aspiration search) that must never block on the GPU.
export async function tryFastResolve(
  rawText: string,
): Promise<{ conceptId: string; via: "exact" | "fuzzy" } | null> {
  const surfaceNorm = normalizeSurface(rawText);

  const exact = await pool.query<{ concept_id: string }>(
    `SELECT concept_id FROM concept_alias WHERE surface_norm = $1`,
    [surfaceNorm],
  );
  if (exact.rows.length > 0) return { conceptId: exact.rows[0].concept_id, via: "exact" };

  const fuzzy = await pool.query<{ concept_id: string; sim: number }>(
    `SELECT concept_id, similarity(surface_norm, $1) AS sim
     FROM concept_alias
     WHERE surface_norm % $1
     ORDER BY sim DESC
     LIMIT 1`,
    [surfaceNorm],
  );
  const fuzzyMatch = fuzzy.rows[0];
  if (fuzzyMatch && fuzzyMatch.sim >= 0.6) {
    await insertAlias(rawText, surfaceNorm, fuzzyMatch.concept_id, "fuzzy", fuzzyMatch.sim, null);
    return { conceptId: fuzzyMatch.concept_id, via: "fuzzy" };
  }

  return null;
}

// Resolves one raw string (from actor_concept.raw_text or ask_concept.raw_text)
// to a concept id, following the pipeline from the data model handoff,
// section 4: exact alias -> fuzzy trigram -> embedding kNN -> LLM
// adjudication -> LLM proposal. Every LLM decision is written back as an
// alias row so the same raw string never re-reaches the model.
export async function resolveRawText(rawText: string): Promise<ResolutionResult> {
  const fast = await tryFastResolve(rawText);
  if (fast) {
    return { status: "resolved", conceptId: fast.conceptId, via: fast.via };
  }
  const surfaceNorm = normalizeSurface(rawText);

  // Everything past this point needs the model runtime. Without one, a
  // string that no alias covers is parked for review rather than failing the
  // job: the raw_text is already written, and re-running resolution over it
  // once the GPU host is back is exactly the recovery path the data model
  // doc describes.
  if (!config.llm.baseUrl) {
    return { status: "needs_review", reason: "model runtime unavailable (LLM_BASE_URL unset)" };
  }

  const [embedding] = await embed([rawText]);
  const vectorLiteral = toVectorLiteral(embedding);
  const candidates = await pool.query<ConceptCandidate>(
    `SELECT id, pref_label, definition, 1 - (embedding <=> $1::vector) AS similarity
     FROM concept
     WHERE embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [vectorLiteral, config.resolution.candidateCount],
  );

  const top = candidates.rows[0];
  if (top && top.similarity >= config.resolution.vectorAcceptThreshold) {
    await insertAlias(rawText, surfaceNorm, top.id, "vector", top.similarity, null);
    return { status: "resolved", conceptId: top.id, via: "vector" };
  }

  if (top && top.similarity >= config.resolution.vectorAdjudicateFloor) {
    const prompt = await getActivePrompt("concept_adjudication");
    const { parsed } = await runStructuredPrompt(prompt, {
      raw_text: rawText,
      candidate_list: formatCandidateList(candidates.rows),
    });
    const verdict = parsed.verdict as string;
    const choice = parsed.choice as number;

    if (verdict === "unsure" || verdict === "unrelated" || choice < 0 || choice >= candidates.rows.length) {
      return { status: "needs_review", reason: JSON.stringify(parsed) };
    }

    const chosen = candidates.rows[choice];
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;
    await insertAlias(rawText, surfaceNorm, chosen.id, "llm", confidence, prompt.version);
    return { status: "resolved", conceptId: chosen.id, via: "llm_adjudicate" };
  }

  // No candidate cleared the adjudication floor: propose a new concept.
  const proposePrompt = await getActivePrompt("concept_propose");
  const { parsed } = await runStructuredPrompt(proposePrompt, {
    raw_text: rawText,
    candidate_list: formatCandidateList(candidates.rows),
  });

  const label = parsed.label as string;
  const definition = parsed.definition as string;
  const parentChoice = typeof parsed.parent_choice === "number" ? parsed.parent_choice : -1;
  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;

  if (!label || !definition) {
    return { status: "needs_review", reason: `concept_propose returned no label/definition: ${JSON.stringify(parsed)}` };
  }

  const created = await pool.query<{ id: string }>(
    `INSERT INTO concept (pref_label, definition) VALUES ($1, $2) RETURNING id`,
    [label, definition],
  );
  const conceptId = created.rows[0].id;

  await enqueue(pool, "embed", { conceptId });

  if (parentChoice >= 0 && candidates.rows[parentChoice]) {
    await pool.query(
      `INSERT INTO concept_relation (src_id, dst_id, kind) VALUES ($1, $2, 'broader')
       ON CONFLICT (src_id, dst_id, kind) DO NOTHING`,
      [conceptId, candidates.rows[parentChoice].id],
    );
  }

  await insertAlias(rawText, surfaceNorm, conceptId, "llm", confidence, proposePrompt.version);
  return { status: "resolved", conceptId, via: "llm_propose" };
}

export async function embedConceptDefinition(conceptId: string): Promise<void> {
  const { rows } = await pool.query<{ definition: string }>(
    `SELECT definition FROM concept WHERE id = $1`,
    [conceptId],
  );
  if (rows.length === 0) return;
  const [embedding] = await embed([rows[0].definition]);
  await pool.query(`UPDATE concept SET embedding = $2::vector WHERE id = $1`, [
    conceptId,
    toVectorLiteral(embedding),
  ]);
}
