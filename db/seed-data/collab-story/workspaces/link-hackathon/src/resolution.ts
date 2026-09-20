// resolution.ts
// Owner: John Doe (tech lead)
// Last updated: Mon 31 Aug 2026
//
// This is the core of the "concept resolution" pipeline.
// Goal: take a user's free-text interest (e.g., "distributed systems") and map it to a canonical concept in our ontology (subset of CSO).
//
// Strategy (D2, 28 Jul): cheap-to-expensive. We only hit the local LLM (qwen3.8) if exact/fuzzy/embedding fails or is ambiguous.
// All model decisions are cached as aliases so we never pay for the same string twice.

import { db } from '../db'; // Postgres client
import { ollamaClient } from '../ai/ollama'; // Local Ollama wrapper
import { Concept, Alias } from '../types';

const EMBEDDING_ACCEPT_THRESHOLD = 0.92; // High confidence auto-accept (rarely fires)
const EMBEDDING_ADJUDICATE_FLOOR = 0.60; // Below this, we definitely need LLM adjudication
const TRIGRAM_FUZZY_THRESHOLD = 0.6;     // pg_trgm similarity floor
const MIN_PROPOSE_LENGTH = 5;            // Don't propose new concepts for "AI", etc.

export interface ResolutionResult {
  concept: Concept | null;
  isNewProposal: boolean;
  confidence: number;
  method: 'alias' | 'trigram' | 'embedding' | 'llm_adjudication' | 'llm_proposal';
}

// Helper: check if we've seen this exact string before (case-insensitive)
async function getAliasByString(rawText: string): Promise<Alias | null> {
  const lower = rawText.trim().toLowerCase();
  return db.query.one('SELECT * FROM aliases WHERE alias_string = $1', [lower]);
}

// Helper: cache a new alias mapping
async function cacheAlias(rawText: string, conceptId: number, method: string): Promise<void> {
  const lower = rawText.trim().toLowerCase();
  await db.query.run(
    'INSERT INTO aliases (alias_string, concept_id, source) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [lower, conceptId, method]
  );
}

// Stage 1: Exact alias match
async function tryExactAlias(rawText: string): Promise<Concept | null> {
  const alias = await getAliasByString(rawText);
  if (!alias) return null;
  
  const concept = await db.query.one('SELECT * FROM concepts WHERE id = $1', [alias.concept_id]);
  if (concept) {
    console.log(`[Resolution] Exact alias hit: "${rawText}" -> ${concept.name}`);
    return concept;
  }
  return null;
}

// Stage 2: Trigram fuzzy match (Postgres pg_trgm)
async function tryTrigramFuzzy(rawText: string): Promise<Concept | null> {
  const lower = rawText.trim().toLowerCase();
  
  // Find concepts with similar names or existing aliases
  const results = await db.query.all(`
    SELECT c.id, c.name, 
           GREATEST(
             similarity(c.name, $1),
             COALESCE(max(similarity(a.alias_string, $1)), 0)
           ) as score
    FROM concepts c
    LEFT JOIN aliases a ON a.concept_id = c.id
    WHERE similarity(c.name, $1) >= $2 OR EXISTS (SELECT 1 FROM aliases a WHERE a.concept_id = c.id AND similarity(a.alias_string, $1) >= $2)
    ORDER BY score DESC
    LIMIT 5
  `, [lower, TRIGRAM_FUZZY_THRESHOLD]);

  if (results.length === 0) return null;
  
  // If the top match is significantly better than the second, accept it.
  // Otherwise, pass to next stage for disambiguation.
  const top = results[0];
  const second = results[1] || { score: 0 };
  
  if (top.score - second.score > 0.2) {
    console.log(`[Resolution] Trigram fuzzy hit: "${rawText}" -> ${top.name} (score: ${top.score.toFixed(2)})`);
    await cacheAlias(rawText, top.id, 'trigram');
    return db.query.one('SELECT * FROM concepts WHERE id = $1', [top.id]);
  }
  
  return null; // Ambiguous, needs embedding/LLM
}

// Stage 3: Embedding kNN (pgvector)
async function tryEmbedding(rawText: string): Promise<{ concept: Concept | null, candidates: { id: number, distance: number }[] }> {
  const lower = rawText.trim().toLowerCase();
  
  // Generate embedding locally via Ollama
  const embedding = await ollamaClient.embed(lower);
  
  // Find nearest neighbors in concepts table
  const candidates = await db.query.all(`
    SELECT id, name, 
           1 - (embedding <=> $1::vector) as similarity
    FROM concepts
    ORDER BY embedding <=> $1::vector
    LIMIT 5
  `, [embedding]);

  if (candidates.length === 0) return { concept: null, candidates: [] };

  const top = candidates[0];
  
  // Auto-accept if very high confidence
  if (top.similarity >= EMBEDDING_ACCEPT_THRESHOLD) {
    console.log(`[Resolution] Embedding auto-accept: "${rawText}" -> ${top.name} (sim: ${top.similarity.toFixed(3)})`);
    await cacheAlias(rawText, top.id, 'embedding');
    const concept = await db.query.one('SELECT * FROM concepts WHERE id = $1', [top.id]);
    return { concept, candidates };
  }

  // If below adjudication floor, we have low confidence but still have candidates for LLM
  if (top.similarity < EMBEDDING_ADJUDICATE_FLOOR) {
     console.log(`[Resolution] Embedding low confidence: "${rawText}" (top sim: ${top.similarity.toFixed(3)})`);
  }

  return { concept: null, candidates };
}

// Stage 4: LLM Adjudication
async function adjudicateWithLLM(rawText: string, candidates: { id: number, name: string }[]): Promise<{ conceptId: number | null, isNewProposal: boolean }> {
  if (candidates.length === 0) {
    // If no candidates at all, check if we should propose a new one
    if (rawText.trim().length >= MIN_PROPOSE_LENGTH) {
      console.log(`[Resolution] No candidates. Proposing new concept for: "${rawText}"`);
      return { conceptId: null, isNewProposal: true };
    }
    return { conceptId: null, isNewProposal: false };
  }

  const prompt = `
    User interest: "${rawText}"
    
    Candidate concepts from our ontology:
    ${candidates.map((c, i) => `${i+1}. ${c.name}`).join('\n')}
    
    Task: Select the best matching concept number. If none match well, reply with "0".
    Reply with ONLY the number.
  `;

  const response = await ollamaClient.generate(prompt, { model: 'qwen3.8', reasoning_effort: 'none' });
  const choice = parseInt(response.trim(), 10);

  if (isNaN(choice) || choice < 0 || choice > candidates.length) {
    return { conceptId: null, isNewProposal: rawText.trim().length >= MIN_PROPOSE_LENGTH };
  }

  if (choice === 0) {
    return { conceptId: null, isNewProposal: rawText.trim().length >= MIN_PROPOSE_LENGTH };
  }

  const selected = candidates[choice - 1];
  console.log(`[Resolution] LLM adjudication: "${rawText}" -> ${selected.name}`);
  return { conceptId: selected.id, isNewProposal: false };
}

// Main Entry Point
export async function resolveRawText(rawText: string): Promise<ResolutionResult> {
  // 1. Exact Alias
  const aliasConcept = await tryExactAlias(rawText);
  if (aliasConcept) {
    return { concept: aliasConcept, isNewProposal: false, confidence: 1.0, method: 'alias' };
  }

  // 2. Trigram Fuzzy
  const fuzzyConcept = await tryTrigramFuzzy(rawText);
  if (fuzzyConcept) {
    return { concept: fuzzyConcept, isNewProposal: false, confidence: 0.85, method: 'trigram' };
  }

  // 3. Embedding kNN
  const { concept: embConcept, candidates } = await tryEmbedding(rawText);
  if (embConcept) {
    return { concept: embConcept, isNewProposal: false, confidence: 0.95, method: 'embedding' };
  }

  // 4. LLM Adjudication
  const { conceptId, isNewProposal } = await adjudicateWithLLM(rawText, candidates);
  
  if (conceptId) {
    await cacheAlias(rawText, conceptId, 'llm');
    const concept = await db.query.one('SELECT * FROM concepts WHERE id = $1', [conceptId]);
    return { concept, isNewProposal: false, confidence: 0.8, method: 'llm_adjudication' };
  }

  // 5. Propose New Concept (handled by worker, not here)
  if (isNewProposal) {
     console.log(`[Resolution] Queued new concept proposal for: "${rawText}"`);
     // TODO: Insert into proposals table
  }

  return { concept: null, isNewProposal, confidence: 0.0, method: 'llm_proposal' };
}
