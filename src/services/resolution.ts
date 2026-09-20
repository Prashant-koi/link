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

// A string this short has too little signal to found a concept on. Measured
// on the first live run: every one of 17 proposals from 2-4 character strings
// was the model inventing an expansion ("dk" -> "Denmark", "mol" -> "Mole")
// at 0.95 confidence, so confidence is no defence. Adjudication against real
// candidates is still allowed for short strings ("auv" -> the AUV concept);
// only *minting* is refused.
const MIN_MINT_LENGTH = 5;

// Embeddings can't fix a typo ("robtics" embeds nearest to "random oracle
// model"), but trigram similarity gets it within reach of the right concept
// ("robotics", 0.50) — just under the cutoff for accepting it unchecked. Near
// misses are put in front of the model as candidates instead.
const NEAR_MISS_TRIGRAM = 0.4;

async function trigramNearMisses(surfaceNorm: string): Promise<ConceptCandidate[]> {
  const { rows } = await pool.query<ConceptCandidate>(
    `SELECT c.id, c.pref_label, c.definition, max(similarity(a.surface_norm, $1)) AS similarity
     FROM concept_alias a JOIN concept c ON c.id = a.concept_id
     WHERE similarity(a.surface_norm, $1) >= $2
     GROUP BY c.id, c.pref_label, c.definition
     ORDER BY similarity DESC
     LIMIT 3`,
    [surfaceNorm, NEAR_MISS_TRIGRAM],
  );
  return rows;
}

function mergeCandidates(first: ConceptCandidate[], second: ConceptCandidate[], limit: number): ConceptCandidate[] {
  const seen = new Set<string>();
  const out: ConceptCandidate[] = [];
  for (const c of [...first, ...second]) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
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

  // Everything past this point needs the model runtime. Without one, a
  // string that no alias covers is parked for review rather than failing the
  // job: the raw_text is already written, and re-running resolution over it
  // once the GPU host is back is exactly the recovery path the data model
  // doc describes. --strict (RESOLUTION_STRICT) makes this a hard failure
  // instead, once there's a runtime to point at.
  if (!config.llm.baseUrl && !config.resolution.strict) {
    return { status: "needs_review", reason: "model runtime unavailable (LLM_BASE_URL unset)" };
  }

  const surfaceNorm = normalizeSurface(rawText);

  const [embedding] = await embed([rawText], "query");
  const vectorLiteral = toVectorLiteral(embedding);
  const vectorResult = await pool.query<ConceptCandidate>(
    `SELECT id, pref_label, definition, 1 - (embedding <=> $1::vector) AS similarity
     FROM concept
     WHERE embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [vectorLiteral, config.resolution.candidateCount],
  );
  const vectorCandidates = vectorResult.rows;

  // No embedded concepts means the index isn't built (or is being rebuilt),
  // not that this string is novel. Falling through to "propose a new concept"
  // here would mint a duplicate concept for every string that reaches this
  // point, so park it for review instead.
  if (vectorCandidates.length === 0) {
    return { status: "needs_review", reason: "no embedded concepts to match against (run `npm run reprocess`)" };
  }

  const top = vectorCandidates[0];
  if (top.similarity >= config.resolution.vectorAcceptThreshold) {
    await insertAlias(rawText, surfaceNorm, top.id, "vector", top.similarity, null);
    return { status: "resolved", conceptId: top.id, via: "vector" };
  }

  const nearMisses = await trigramNearMisses(surfaceNorm);
  if (nearMisses.length > 0 || top.similarity >= config.resolution.vectorAdjudicateFloor) {
    const candidates = mergeCandidates(nearMisses, vectorCandidates, config.resolution.candidateCount);
    const prompt = await getActivePrompt("concept_adjudication");
    const { parsed } = await runStructuredPrompt(prompt, {
      raw_text: rawText,
      candidate_list: formatCandidateList(candidates),
    });
    const verdict = parsed.verdict as string;
    const choice = parsed.choice as number;

    if (verdict === "unsure" || verdict === "unrelated" || choice < 0 || choice >= candidates.length) {
      return { status: "needs_review", reason: JSON.stringify(parsed) };
    }

    const chosen = candidates[choice];
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;
    await insertAlias(rawText, surfaceNorm, chosen.id, "llm", confidence, prompt.version);
    return { status: "resolved", conceptId: chosen.id, via: "llm_adjudicate" };
  }

  // Nothing close enough to adjudicate: the string may genuinely be new — but
  // only strings with enough signal are allowed to found a concept.
  if (surfaceNorm.length < MIN_MINT_LENGTH) {
    return { status: "needs_review", reason: `"${rawText}" is too short and ambiguous to create a concept from` };
  }

  const proposePrompt = await getActivePrompt("concept_propose");
  const { parsed } = await runStructuredPrompt(proposePrompt, {
    raw_text: rawText,
    candidate_list: formatCandidateList(vectorCandidates),
  });

  const label = parsed.label as string;
  const definition = parsed.definition as string;
  const parentChoice = typeof parsed.parent_choice === "number" ? parsed.parent_choice : -1;
  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;

  if (!label || !definition) {
    return { status: "needs_review", reason: `concept_propose returned no label/definition: ${JSON.stringify(parsed)}` };
  }

  // The model's label may already be a concept we have (it minted a duplicate
  // "robotics" on the first live run). Collapse onto the existing one.
  const existing = await pool.query<{ concept_id: string }>(
    `SELECT concept_id FROM concept_alias WHERE surface_norm = $1`,
    [normalizeSurface(label)],
  );
  if (existing.rows.length > 0) {
    await insertAlias(rawText, surfaceNorm, existing.rows[0].concept_id, "llm", confidence, proposePrompt.version);
    return { status: "resolved", conceptId: existing.rows[0].concept_id, via: "llm_propose" };
  }

  const created = await pool.query<{ id: string }>(
    `INSERT INTO concept (pref_label, definition) VALUES ($1, $2) RETURNING id`,
    [label, definition],
  );
  const conceptId = created.rows[0].id;

  await enqueue(pool, "embed", { conceptId });

  if (parentChoice >= 0 && vectorCandidates[parentChoice]) {
    // Same direction as the seeded CSO relations: src is the broader term.
    await pool.query(
      `INSERT INTO concept_relation (src_id, dst_id, kind) VALUES ($1, $2, 'broader')
       ON CONFLICT (src_id, dst_id, kind) DO NOTHING`,
      [vectorCandidates[parentChoice].id, conceptId],
    );
  }

  // Both the raw string and the label resolve to the new concept from now on
  // (the label alias is what lets the duplicate check above find it).
  await insertAlias(rawText, surfaceNorm, conceptId, "llm", confidence, proposePrompt.version);
  await insertAlias(label, normalizeSurface(label), conceptId, "llm", confidence, proposePrompt.version);
  return { status: "resolved", conceptId, via: "llm_propose" };
}

export async function embedConceptDefinition(conceptId: string): Promise<void> {
  const { rows } = await pool.query<{ definition: string }>(
    `SELECT definition FROM concept WHERE id = $1`,
    [conceptId],
  );
  if (rows.length === 0) return;
  const [embedding] = await embed([rows[0].definition], "document");
  await pool.query(`UPDATE concept SET embedding = $2::vector WHERE id = $1`, [
    conceptId,
    toVectorLiteral(embedding),
  ]);
}
