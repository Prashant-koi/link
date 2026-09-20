# Experiment Log — Interest Resolution Pipeline

**Owner:** Noor Rahman  
**Last updated:** Thu 17 Sep 2026  
**Context:** This log tracks how we got the resolution pipeline to its current state (exact → trigram → embedding → LLM adjudication). All numbers are from the seeded test set unless noted. The full seed set is 2,946 free-text interest strings collected from early signups and synthetic fills.

## Baseline: Exact + Trigram Only
**Date:** Fri 21 Aug  
**Setup:** Just alias lookup + pg_trgm fuzzy match (threshold 0.6). No vectors, no model.  
**Result:** Resolves ~82% of the seed set automatically. The remaining ~18% are either too vague ("stuff with math") or genuinely new concepts.  
**Notes:** This was our starting point before D2 (Tue 28 Jul decision to add the rest of the pipeline). We kept this as a cheap fast-path so the model isn't called for obvious cases.

## Adding Embedding Nearest-Neighbour
**Date:** Tue 4 Aug  
**Setup:** Added nomic-embed-text embeddings (768-d, pgvector). Auto-accept if cosine similarity >= 0.92. Fallback to LLM adjudication if below that but above floor 0.60.  
**Result:** Auto-accept rate was ~5% of the cases that reached the embedding stage.  
**Key observation (important!):** The 0.92 threshold **never actually fires in practice**. In every run, even the "easy" embeddings landed between 0.78 and 0.91. We suspect nomic-embed-text is conservative with phrasing variants ("machine learning" vs "ML basics"). So effectively, almost everything that gets to the embedding stage gets passed to the LLM for adjudication. The 0.92 auto-accept is basically dead code right now — leaving it in for safety but we should probably lower it or remove it in a future pass.

## Adding LLM Adjudication (qwen2.5-14b)
**Date:** Tue 11 Aug  
**Setup:** qwen2.5-14b via Ollama, reasoning off. Given top-5 candidate concepts, asked to pick the best match or propose a new one (only if string is 5+ chars).  
**Result:** ~96% of the LLM-reached cases resolved correctly on a manual spot-check of 50 strings.  
**Notes:** This was our first local model run (D3 privacy decision). Latency was high (~4–5s p95) due to model reloads — that got fixed later (see below).

## Model Comparison: qwen2.5-14b vs qwen3.8
**Date:** Thu 27 Aug  
**Setup:** Same 200-string eval set. Compared adjudication quality (human-labeled ground truth for this subset).  
**Results:**
| Model | Correct / 200 | Avg latency (s) | Notes |
|-------|---------------|-----------------|-------|
| qwen2.5-14b | 189 | 3.2 | Sometimes over-proposes new concepts |
| qwen3.8 (reasoning off) | 196 | 4.1 | Better at rejecting junk, more consistent |

**Decision:** Switched to qwen3.8 (D7). The latency hit was acceptable after the keep-warm fix (see below).

## Latency Fix: Keep-Warm + Batching
**Date:** Wed 26 Aug (problem found) → Mon 31 Aug (fixed)  
**Problem:** Ollama was unloading idle models. Reload took ~46s for qwen3.8, ~14s for nomic-embed-text. p95 latency was 4.2s.  
**Fix:**
- Heartbeat ping every 2 min to keep models warm.
- Batch embeddings in groups of 256.
- Instruct concurrency capped at 2.  
**Result:** p95 dropped to **0.9s** by Mon 31 Aug. This was the big unblock (D6).

## Small-Model Benchmark: qwen3 4B vs qwen3.8
**Date:** Mon 14 Sep  
**Setup:** Noor + John ran a head-to-head on two sets:
1. **40 real interest strings** (from seed set, known correct answers).
2. **10 junk/nonsense strings** (e.g., "vacation photos", "asdfgh", "my dog's birthday") — should be rejected or proposed as new, never matched to a real concept incorrectly.

**Results:**
| Metric | qwen3 4B | qwen3.8 |
|--------|----------|---------|
| Real strings correct | 37/40 (92.5%) | 39/40 (97.5%) |
| Junk correctly rejected | 8/10 (80%) | 10/10 (100%) |
| Avg adjudication latency | 0.5s | 1.8s |

**Analysis:**
- qwen3 4B is **3.6x faster**.
- But it accepted 2 junk strings as valid matches (e.g., "vacation photos" → matched to "real scenes", which is a stretch).
- qwen3.8 rejected all 10 junk strings cleanly.

**Decision:** Keep **qwen3.8 for adjudication**. The small model may be useful later for low-risk tasks (like generating short explanations or tagging), but not for the critical match/reject decision where false positives hurt user trust.

## Open Questions / TODOs
- [ ] Ablation study: remove trigram stage, see how much accuracy/latency changes (needed for paper).
- [ ] Human evaluation of 100 strings (due Wed 23 Sep) — will give us the "99.1% without human" number for the abstract.
- [ ] Figure of the pipeline (Mei is working on it).
- [ ] Related-work section (John + Noor, due before Fri 25 Sep abstract deadline).

## Notes on Caching
Every LLM decision (match or new-concept proposal) is cached as an alias in Postgres. So a given string never hits the model twice. This is critical for both cost (even though local) and consistency. The cache hit rate on re-runs is ~95%+.
