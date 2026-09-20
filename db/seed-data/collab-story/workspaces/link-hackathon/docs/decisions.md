# Link — Decision Log

> **Owner:** John Doe  
> **Last updated:** Fri 11 Sep 2026  
> **Status:** Living document. Add new entries at the bottom. Use `D<n>` IDs.

---

## D1 — Postgres + pgvector instead of Neo4j
**Date:** Tue 21 Jul 2026  
**Context:** We needed a graph-like structure for concepts and people, but we also need vector search for embeddings. Neo4j is a separate datastore; Postgres can do both with `pgvector` and recursive CTEs.  
**Decision:** Single Postgres 16 instance with `pgvector` (768-d). No separate graph DB.  
**Who argued what:** Chen pushed hard for this — one datastore, team knows SQL, ops are simpler. Jane wanted Neo4j’s native graph viz but accepted; we can render the graph client-side from JSON.  
**Consequences:** Simpler deployment (Docker Compose: Postgres + Node API + nginx). Recursive CTEs handle 1-hop related concepts fine for our scale. No driver maintenance for a second DB.

---

## D2 — Four-stage resolution pipeline
**Date:** Tue 28 Jul 2026  
**Context:** Free-text interests vary wildly ("rust", "Rust lang", "systems prog"). We can’t afford an LLM call for every string.  
**Decision:** Exact alias match → trigram fuzzy (≥0.6) → embedding NN (auto-accept ≥0.92, adjudication floor 0.60) → LLM adjudication (top-5 candidates). LLM proposes a new concept only if the string is 5+ chars. Every model decision cached as an alias.  
**Who argued what:** Noor and John designed it together. Key insight: cheap matching handles ~96% of cases, so the model is rarely called.  
**Consequences:** Latency is low for most strings. Cache means a string never hits the model twice. The 0.92 auto-accept threshold has never actually fired in practice (embeddings cluster tightly), so adjudication does the heavy lifting.

---

## D3 — Local model, not cloud API
**Date:** Tue 4 Aug 2026  
**Context:** People’s interests and messages are personal data. Diego flagged privacy concerns about sending them to a third-party API.  
**Decision:** Run everything locally on the ASUS GX10 (128 GB unified memory) via Ollama. Started with `qwen2.5-14b`.  
**Who argued what:** Diego raised the privacy point; John and Noor confirmed we can handle it locally.  
**Consequences:** Zero data leaves the machine. Trade-off: we own the hardware and the model lifecycle (see D6, D7).

---

## D4 — Double opt-in messaging
**Date:** Tue 11 Aug 2026  
**Context:** If anyone can message anyone, it becomes a spam vector and feels creepy.  
**Decision:** Messaging is request/accept. Nobody can send a message until the recipient accepts.  
**Who argued what:** Mei and Diego pushed for this. Jane implemented the UI state machine.  
**Consequences:** Slightly more friction, but trust is much higher. Judges at the hackathon will likely appreciate it.

---

## D5 — Scope cut: web only, no native app / calendar
**Date:** Tue 18 Aug 2026  
**Context:** We have ~4 weeks to a working demo. Native mobile and calendar integration are both large scopes.  
**Decision:** Ship a responsive web app only. Drop the native app and calendar integration.  
**Who argued what:** Jane was disappointed (she’d started sketching mobile layouts) but agreed it’s the right call.  
**Consequences:** One codebase to maintain. Vite + React 18 + plain CSS design tokens. Faster iteration.

---

## D6 — Fix model latency (BLOCKER)
**Date:** Wed 26 Aug 2026  
**Context:** p95 latency for embedding/adjudication was **4.2 s**. Root cause: Ollama unloads idle models; reload is ~46 s for the big model, ~14 s for the embedder. Requests were also unbatched.  
**Decision:** Keep-warm heartbeat every 2 min. Batch 256 embeddings. Instruct concurrency = 2.  
**Who argued what:** John diagnosed it; Chen helped with the worker config.  
**Consequences:** p95 fell to **0.9 s** by Mon 31 Aug. This was the single biggest perf win of the project.

---

## D7 — Model upgrade to qwen3.8
**Date:** Thu 27 Aug 2026  
**Context:** `qwen2.5-14b` adjudication quality was inconsistent, especially on ambiguous strings.  
**Decision:** Upgrade to `qwen3.8` (27B). Must run with `reasoning_effort=none` because it’s a thinking model and we don’t want the extra token overhead.  
**Who argued what:** Noor ran the comparison; John approved.  
**Consequences:** Better adjudication accuracy. Slightly higher memory footprint, but the GX10 handles it fine.

---

## D8 — Home screen becomes the "atlas"
**Date:** Tue 1 Sep 2026  
**Context:** The initial home screen was a list of suggested people. Judges (and users) need to *see* the structure, not just read a list.  
**Decision:** Home screen is now an atlas: interests as soft overlapping regions, people as spheres inside them. Turquoise theme. Mei sketched it; Jane built the canvas.  
**Who argued what:** Mei drove the visual design; Jane handled the React canvas rendering.  
**Consequences:** Much more impressive visually. Slightly heavier render, but fine for our scale.

---

## D9 — Demo flow pivot
**Date:** Wed 9 Sep 2026  
**Context:** In dry runs, judges lost the thread when we started with the full graph. It’s hard to parse cold.  
**Decision:** Open the demo on ONE person’s "why you connect" explanation (concrete, explainable), then zoom out to the atlas.  
**Who argued what:** John and Mei agreed on this after watching the dry-run feedback.  
**Consequences:** Code freeze is Thu 10 Sep 6 pm. Demo script is locked.

---

## Small-model test (qwen3 4B vs qwen3.8)
**Date:** Mon 14 Sep 2026 *(planned; to be run)*  
**Context:** The 27B model is slow. Can a 4B model handle low-risk adjudication?  
**Plan:** Run both on the same 40-case eval set (37 real strings + 3 junk). Compare speed and agreement.  
**Hypothesis:** 4B will be ~3-4× faster but may accept junk strings that qwen3.8 rejects.  
**Status:** Not yet run. Will update this entry with results.

---

### Open items (as of Fri 11 Sep)
- [ ] John: automatic retry with backoff for failed model jobs — due Tue 22 Sep
- [ ] Chen: harden auth (session rotation, rate limits) — due Wed 23 Sep
- [ ] Noor: human evaluation of 100 strings for the paper — due Wed 23 Sep
- [ ] John: one-page privacy summary for Diego’s pilot meeting — due Fri 25 Sep
- [ ] Paper abstract due Fri 25 Sep; full submission Fri 2 Oct
