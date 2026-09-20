// src/scoring.ts
// Author: Noor Rahman
// First written: Sat 1 Aug 2026
// Last updated: Thu 3 Sep 2026

import { Concept, Person } from "./types";

/**
 * Tuned from 0.5 down to 0.15 on Wed 26 Aug.
 * At 0.5, hierarchy-adjacent overlaps (e.g., "algorithms" -> "sorting") were
 * outranking rare direct matches (e.g., "distributed consensus"). 
 * We want rare direct hits to dominate, so we dampen the hop bonus significantly.
 */
const HOP_DECAY = 0.15;

/**
 * Penalties for "connected" concepts.
 * If two people are already known to each other (e.g., same course, same club),
 * we slightly penalize their score so the app surfaces *new* connections first.
 * This is a soft penalty, not a hard filter.
 */
const CONNECTED_PENALTY = 0.85;

/**
 * Max number of "reasons" to return in the explanation.
 * Capped at 3 to keep the UI clean (Mei's design constraint).
 */
const MAX_REASONS = 3;

interface ScoredCandidate {
  person: Person;
  score: number;
  reasons: string[];
}

/**
 * Calculates the IDF weight for a concept.
 * idf = log(total_people / people_with_concept)
 * 
 * Note: We use a pseudo-count of 1 to avoid log(0) if a concept is very rare,
 * though in our seed data (2,946 strings), most concepts have >5 users.
 */
function idfWeight(conceptId: string, totalUsers: number, docFreqs: Map<string, number>): number {
  const freq = docFreqs.get(conceptId) || 1;
  return Math.log(totalUsers / (freq + 1));
}

/**
 * Scores a candidate person against the target user.
 * 
 * Logic:
 * 1. Find shared direct concepts. Weight by IDf.
 * 2. Find shared one-hop related concepts. Weight by IDf * HOP_DECAY.
 * 3. Apply connected penalty if they are already in each other's network.
 * 4. Generate top 3 human-readable reasons.
 */
export function scoreCandidates(
  target: Person,
  candidates: Person[],
  conceptGraph: Map<string, string[]>, // conceptId -> relatedConceptIds (1-hop)
  docFreqs: Map<string, number>,       // conceptId -> count of users who have it
  totalUsers: number
): ScoredCandidate[] {
  const targetConcepts = new Set(target.concepts);
  
  // Pre-compute IDF for all concepts in the target's set for efficiency
  const targetIdfs = new Map<string, number>();
  for (const cid of targetConcepts) {
    targetIdfs.set(cid, idfWeight(cid, totalUsers, docFreqs));
  }

  return candidates
    .filter(c => c.id !== target.id) // Don't score yourself
    .map(candidate => {
      const candidateConcepts = new Set(candidate.concepts);
      let directScore = 0;
      let hopScore = 0;
      const reasons: string[] = [];

      // 1. Direct shared concepts
      for (const cid of targetConcepts) {
        if (candidateConcepts.has(cid)) {
          const w = targetIdfs.get(cid)!;
          directScore += w;
          reasons.push(`shared "${cid}"`);
        }
      }

      // 2. One-hop related concepts
      // For each target concept, check if candidate has any of its 1-hop neighbors.
      // We only count each neighbor once to avoid double-counting if multiple
      // target concepts point to the same neighbor.
      const countedNeighbors = new Set<string>();
      for (const cid of targetConcepts) {
        const neighbors = conceptGraph.get(cid) || [];
        for (const nId of neighbors) {
          if (countedNeighbors.has(nId)) continue;
          if (candidateConcepts.has(nId)) {
            countedNeighbors.add(nId);
            // Weight by the IDF of the *neighbor* concept, not the target.
            // This ensures rare neighbors contribute more.
            const nIdf = idfWeight(nId, totalUsers, docFreqs);
            hopScore += nIdf * HOP_DECAY;
            reasons.push(`related to "${cid}" via "${nId}"`);
          }
        }
      }

      // 3. Connected penalty
      let finalScore = directScore + hopScore;
      if (target.connectedTo.has(candidate.id)) {
        finalScore *= CONNECTED_PENALTY;
      }

      return {
        person: candidate,
        score: finalScore,
        reasons: reasons.slice(0, MAX_REASONS) // Cap reasons for UI
      };
    })
    .filter(c => c.score > 0) // Exclude zero-score candidates
    .sort((a, b) => b.score - a.score);
}
