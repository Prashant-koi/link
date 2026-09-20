# Method

**Status:** Draft v0.4 — John, Thu 10 Sep 2026
**TODO:** Noor to review section 3.2 for clarity; Mei to draw the pipeline figure (due before abstract Fri 25 Sep).

This section describes how free-text interest strings from users are resolved to canonical concepts in our ontology (a subset of the Computer Science Ontology). The core design goal is to minimize calls to the local LLM: we only invoke the model when cheap, deterministic matching fails. This keeps latency low and avoids exposing user data to a cloud API (see D3, privacy constraints from Diego).

## 1. Pipeline Overview

Resolution proceeds through four stages in order. The first match wins; if no stage produces a confident result, we fall back to LLM adjudication. If the string is too short or ambiguous, we mark it `unresolved` and cache that decision.

1. **Exact alias match** – Look up the normalized string (lowercased, trimmed) in the `aliases` table. O(1).
2. **Trigram fuzzy match** – Compute trigram similarity against existing concept labels and aliases. Accept if similarity ≥ 0.6.
3. **Embedding nearest-neighbour** – Embed the input string using `nomic-embed-text` (768-d, local via Ollama). Query pgvector for top-5 candidates. Auto-accept if cosine similarity ≥ 0.92. *Note: In practice, this threshold almost never fires because our ontology labels are short and distinct; most strings fall through to adjudication.*
4. **LLM adjudication** – Send the input string + top-5 candidates to `qwen3.8` (27B, reasoning off). The model returns a verdict and a choice index.

## 2. Thresholds & Rationale

| Stage | Threshold | Notes |
|-------|-----------|-------|
| Trigram similarity | ≥ 0.6 | Tuned on 200 sample strings; lower values caused false positives on short labels like "ai". |
| Embedding auto-accept | ≥ 0.92 | Conservative; only fires for near-duplicates (e.g., "python" vs "Python 3"). |
| Adjudication floor | ≥ 0.60 | If the LLM’s confidence score < 0.60, we mark `unresolved` rather than guessing. |

The 0.6 trigram threshold was chosen to balance recall and precision. We found that values below 0.5 introduced too many false matches for generic terms (e.g., "data" matching "database", "data science"). Values above 0.7 missed valid variations like "ml" vs "machine learning".

## 3. LLM Adjudication

### 3.1 Prompt Structure

We use a structured prompt that asks the model to classify the relationship between the input string and each candidate concept. The verdicts are:

- `same` – The string refers to the same concept.
- `narrower` – The string is a subtopic of the concept (e.g., "transformers" → "neural networks").
- `broader` – The string is a parent topic (e.g., "machine learning" → "AI").
- `unrelated` – No meaningful relationship.
- `unsure` – Ambiguous or insufficient information.

The model must also return a **choice index** (1–5) indicating the best-matching candidate, and a confidence score in [0, 1]. If all candidates are `unrelated` or `unsure`, the model may propose a new concept only if the input string is ≥ 5 characters (junk guard).

### 3.2 Junk Guard

Short strings (< 5 chars) like "ai", "ml", "cs" are often ambiguous or generic. We do not allow the LLM to create new concepts for these; they must match an existing alias or be marked `unresolved`. This prevents ontology bloat from typos or vague inputs.

## 4. Alias Caching

Every model decision is cached as an alias in Postgres. If the same string appears again, it resolves via Stage 1 without hitting the LLM. This ensures:
- **Consistency**: The same input always maps to the same concept.
- **Latency**: Repeat queries are O(1).
- **Cost**: No redundant model calls.

We track `created_by` (model vs. human) and `timestamp` for auditing.

## 5. Model Configuration

- **Model:** `qwen3.8` (27B, local via Ollama on ASUS GX10, 128 GB RAM).
- **Reasoning:** Disabled (`reasoning_effort=none`) to reduce latency and avoid overthinking simple classification tasks.
- **Concurrency:** 2 concurrent requests max; batching 256 embeddings where possible.
- **Keep-warm:** Heartbeat every 2 minutes to prevent Ollama from unloading the model (see D6, latency fix).

## 6. Open Questions

- [ ] Should we allow `narrower`/`broader` matches in scoring, or only `same`? Currently, we weight `same` at 1.0 and `narrower`/`broader` at 0.5.
- [ ] Ablation study: What happens if we remove the trigram stage entirely? (Noor to run by Fri 25 Sep.)
- [ ] Human evaluation on 100 strings to validate precision/recall of the full pipeline.

---
*References: [Placeholder for related-work section — Noor to draft]*
