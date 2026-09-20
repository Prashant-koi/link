# Architecture Notes — Resolution Pipeline (D2)

**Date:** Tue 28 Jul 2026
**Author:** John Doe
**Status:** Draft / In Discussion
**Attendees:** John, Noor, Chen, Jane, Mei

## Context
We are four weeks out from the hackathon build sprint. The core differentiator for Link is that we can explain *why* two people connect. That requires mapping free-text interests (e.g., "rust async", "machine learning") to our canonical concept ontology. We cannot afford to call an LLM for every single string, so we need a cheap-first pipeline.

## The Pipeline (4 Stages)
We agreed on the following order of operations. Each stage is cheaper and less accurate than the last.

1. **Exact Alias Match**
   - Lookup in `concept_aliases` table.
   - Cost: ~0ms.
   - Hit rate: Expected to catch ~60% of common terms (e.g., "python" -> `programming_languages/python`).

2. **Trigram Fuzzy Match**
   - Use Postgres `pg_trgm` extension.
   - Threshold: `similarity >= 0.6`.
   - Cost: Low (indexed).
   - Purpose: Catch typos and minor variations (e.g., "pythn" -> `python`).

3. **Embedding Nearest-Neighbour**
   - Use `pgvector` with `nomic-embed-text` (768-dim).
   - Threshold: Auto-accept if cosine similarity `>= 0.92`.
   - Cost: Medium (embedding generation + ANN search).
   - Purpose: Semantic matches that fuzzy string matching misses (e.g., "web dev" -> `software_engineering/frontend`).

4. **LLM Adjudication**
   - Model: `qwen2.5-14b` (local, via Ollama).
   - Input: The raw string + top-5 candidates from stages 1-3.
   - Task: Choose the best candidate OR propose a new concept if the string is 5+ characters and no candidate fits.
   - Cost: High (~2-5s latency).
   - Constraint: **Only called if stages 1-3 fail or return low confidence.**

## Key Decisions & Arguments

### Why not just use the LLM for everything?
**Noor:** Latency would be unacceptable. If a user types "react", we don't want to wait 3 seconds for the model to think about it. Plus, token costs (even local) add up if we do this for every single interest string during onboarding.

**John:** Agreed. The LLM is the "judge," not the "worker." It should only step in when cheap heuristics fail.

### Threshold Tuning
**Chen:** What about the embedding threshold? 0.92 feels high. Will we miss valid matches?

**Noor:** I ran a quick test on our seed data. 0.92 is conservative but safe. If we lower it to 0.8, we start seeing false positives like "data" matching `data_science` when the user meant `database_administration`. We can tune this later if precision drops.

**Mei:** From a UX perspective, is it better to show a slightly wrong concept or no concept?

**John:** Better to show nothing than a wrong connection. A wrong "why you connect" explanation will destroy trust in the app.

### Caching Strategy
**Chen:** Every time the LLM makes a decision (accept, reject, or propose new), we should cache that result as an alias. That way, the same string never hits the model twice.

**John:** Yes. This is critical for performance. We’ll add a `source` column to `concept_aliases` to track whether it came from `exact`, `fuzzy`, `embedding`, or `llm`.

## Action Items

| Task | Owner | Due |
| :--- | :--- | :--- |
| Implement `pg_trgm` setup and fuzzy match query | Chen | Wed 29 Jul |
| Write embedding generation service (batching) | Noor | Thu 30 Jul |
| Draft LLM prompt for adjudication (top-5 candidates) | John | Fri 31 Jul |
| Design `concept_aliases` schema with `source` tracking | Chen | Wed 29 Jul |
| Set up Ollama service in Docker Compose | John | Thu 30 Jul |
| Create test set of 50 diverse interest strings for validation | Noor | Fri 31 Jul |

## Open Questions
- How do we handle multi-word concepts? (e.g., "machine learning" vs. "ml")
- Should the LLM be allowed to create *new* concepts, or only map to existing ones? (Current plan: Allow new if string >= 5 chars, but requires human review before going live.)
- What is our fallback if the local model is down? (Graceful degradation to embedding-only?)

---
*Next sync: Fri 31 Jul, 4 PM.*
