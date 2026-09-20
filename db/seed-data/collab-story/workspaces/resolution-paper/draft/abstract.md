# Abstract Draft

> **Status:** Draft v3 — Fri 18 Sep 2026.
> **Owner:** John (first author). Noor reviewing next pass.
> **Target:** NLP-for-Education workshop. Abstract due **Fri 25 Sep**.
> **Word count:** ~148 words (excluding title/TODOs). Aim for <150.

---

**Small local language models for resolving free-text interests to a concept ontology**

People express their academic and professional interests as short, free-text strings—“distributed systems,” “LLM evals,” “quantum computing”—that rarely align with the canonical vocabulary of a discipline ontology. We present a four-stage resolution pipeline that maps such strings onto a Computer Science Ontology without requiring users to pick from menus. The pipeline cascades from exact alias matching, through trigram fuzzy matching (similarity ≥ 0.6), to embedding nearest-neighbour search over 768-d vectors, and finally to LLM adjudication among the top-5 candidate concepts. A key design constraint is privacy: all model inference runs locally on a single workstation using Ollama, with nomic-embed-text for embeddings and qwen3.8 (27B) for adjudication. No user data leaves the machine.

On a corpus of 2,946 seeded interest strings collected from campus members, 96.4% of strings are resolved by the three non-model stages alone; only 3.6% reach the LLM. qwen3.8 agrees with human-labeled ground truth on 39/40 ambiguous cases and correctly rejects all 10 deliberately malformed inputs (e.g., “vacation photos” → no concept). A 4B instruct model is 3.6× faster but accepts 2 of those 10 junk strings, confirming that adjudication quality degrades below ~14B parameters. We discuss the latency–accuracy trade-off of local inference and present a keep-warm scheduling strategy that reduces p95 resolution time from 4.2 s to 0.9 s.

<!-- TODO (Noor): insert human-eval number once 100-string eval is done. Target: Wed 23 Sep. -->
<!-- TODO (John): confirm "96.4%" phrasing — Noor wants to say "only 3.6% require LLM" instead, to lead with the win. -->
<!-- TODO (Mei): pipeline figure is still a rough sketch; need clean diagram before full paper (Fri 2 Oct). -->
<!-- TODO (John): related-work section not started. Need to cite at least 3 papers on ontology alignment / concept extraction. Ask Sofia for suggestions Mon. -->
<!-- TODO (Noor): ablation removing the trigram stage — do we have numbers? If not, run by Thu 24 Sep. -->
<!-- NOTE: Sofia asked (email, Wed 16 Sep) to make sure we explicitly state the privacy constraint in sentence 1 or 2. Done above. Double-check she's happy with "single workstation" vs "local machine". -->
