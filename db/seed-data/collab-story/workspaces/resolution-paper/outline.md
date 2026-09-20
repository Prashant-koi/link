# Paper Outline — Small local LMs for interest resolution

**Working title:** *Small local language models for resolving free-text interests to a concept ontology*
**Target venue:** NLP-for-Education workshop (abstract due Fri 25 Sep, full due Fri 2 Oct)
**Authors:** John Doe (first), Noor Rahman, Prof. Sofia Petrov
**Last updated:** Mon 31 Aug 2026

## Status legend
- `[done]` — drafted, needs light polish
- `[draft]` — skeleton exists, content partial
- `[todo]` — not started

---

## 1. Introduction `[draft]`
- Problem: free-text interests are messy; we need canonical concepts to match people.
- Our setting: campus app "Link" (HackMIT/Dropbox), CS ontology subset.
- Why local models: privacy (interests + messages are personal data); Diego's push; no cloud API for PII.
- Contributions list (3 bullets): pipeline design, adjudication with qwen3.8, evaluation on 2,946 strings.
- **TODO:** tighten the "why not just use embeddings directly" sentence — Noor has a counter-example from early runs.

## 2. Related Work `[todo]`
- Entity linking / canonicalization (alias matching, fuzzy).
- LLM-based extraction/adjudication in education contexts.
- Local/small LLMs for privacy-sensitive NLP (cite 2–3 placeholder refs).
- **Owner:** John + Noor. Sofia to suggest 1–2 more papers by Wed 2 Sep.

## 3. Method `[done]`
- 3.1 Ontology: CS Ontology subset, ~[N] concepts (fill exact count from `concepts.json`).
- 3.2 Resolution pipeline (4 stages):
  1. Exact alias match
  2. Trigram fuzzy (≥0.6)
  3. Embedding NN (nomic-embed-text, auto-accept ≥0.92 — note: rarely fires in practice)
  4. LLM adjudication (qwen3.8, reasoning off; top-5 candidates; new-concept proposal if string ≥5 chars)
- 3.3 Caching: every model decision becomes an alias → no string hits the model twice.
- 3.4 Scoring: idf-weighted shared concepts + one-hop decay (0.15, tuned down from 0.5 on 26 Aug).
- **TODO:** Mei to draw the pipeline figure by Thu 3 Sep.

## 4. Experiments `[draft]`
- Dataset: 2,946 seeded interest strings (mix of real + synthetic junk).
- Hardware: ASUS GX10, 128 GB unified memory, Ollama.
- Models tested: qwen2.5-14b (early), qwen3.8 (final), qwen3-4B-instruct (ablation, Mon 14 Sep — *not yet written up*).
- Metrics: % resolved without human, % reaching LLM, adjudication agreement, junk-rejection rate.
- **TODO:** Noor to finalize the 4B-model table; John to add the latency numbers (p95 0.9 s after keep-warm fix).

## 5. Results `[draft]`
- Pipeline resolves 99.1% of strings without a human.
- Only 3.6% reach the LLM stage.
- qwen3.8: 39/40 agreement, 10/10 junk rejected.
- qwen3-4B: 37/40 agreement, 8/10 junk rejected (accepted "vacation photos" → "real scenes" in 2 cases).
- **TODO:** Noor's human eval of 100 strings due Wed 23 Sep — add as Table 3.

## 6. Ethics & Privacy `[todo]`
- All inference local; no data leaves the machine.
- Double opt-in messaging (D4, 11 Aug).
- **Owner:** John + Sofia. Keep it short — one paragraph max.

## 7. Limitations `[todo]`
- Ontology is CS-only; generalization unknown.
- Adjudication latency still non-trivial (~0.9 s p95) vs cloud (<100 ms).
- No multilingual eval.
- **TODO:** add the 4B-model trade-off discussion here.

---

## Open items (as of 31 Aug)
- [ ] Related work section (John/Noor) — by Fri 4 Sep
- [ ] Pipeline figure (Mei) — Thu 3 Sep
- [ ] Ablation: remove trigram stage, re-run (Noor) — by Tue 8 Sep
- [ ] Human eval, 100 strings (Noor) — due Wed 23 Sep
- [ ] Abstract draft (John) — due Fri 25 Sep
