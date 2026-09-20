# Done — Link Hackathon

> Log of shipped features and fixes. If it's here, it's deployed to `linkmit.duckdns.org` and tested (unless noted).
> **Last updated:** Tue 15 Sep 2026 by John

## Core Infra & Data
- [x] **Postgres 16 + pgvector schema** — Chen. Tables: `users`, `concepts`, `aliases`, `user_concepts`, `jobs`. Vectors are 768-dim. We dropped the Neo4j idea (D1, 21 Jul) because recursive CTEs cover our graph needs and we know SQL.
- [x] **Auth flow** — Chen. Basic login/logout with session tokens. *Note: hardening (rotation/rate limits) is still pending, see `tasks/todo.md`.*
- [x] **Seed data import** — Noor. Script to load the CS Ontology subset and generate embeddings for all canonical concepts into Postgres.
- [x] **HTTPS + Nginx** — Chen. Docker Compose stack behind nginx. Certs are valid, domain is live.

## Resolution Pipeline (The Core)
- [x] **Stage 1: Exact Alias Match** — John. Fast path. If the string is in `aliases`, return immediately.
- [x] **Stage 2: Trigram Fuzzy Match** — John. Using `pg_trgm`. Threshold set to `0.6`. Catches typos and minor variations without hitting the model.
- [x] **Stage 3: Embedding Nearest Neighbour** — Noor + John. Query pgvector for top-5 candidates. Auto-accept if cosine sim >= 0.92 (rarely fires, but we keep it as a safety net). If max sim < 0.60, reject.
- [x] **Stage 4: LLM Adjudication** — John. Sends the user string + top-5 candidates to Ollama (`qwen3.8`). Model picks the best match or proposes a new concept (only if string length > 5 chars).
- [x] **Caching Layer** — John. Every model decision is written back to `aliases`. A string never hits the LLM twice. This dropped our p95 latency significantly over time.
- [x] **Background Worker** — Chen. Postgres-backed job queue using `FOR UPDATE SKIP LOCKED`. Decouples resolution from API response time.

## Frontend & Design
- [x] **React 18 + Vite Setup** — Jane. Basic scaffolding, routing, state management with Zustand.
- [x] **Design Tokens** — Mei. Plain CSS variables for theme (Turquoise primary). Consistent spacing and typography.
- [x] **"Atlas" Home Screen** — Jane + Mei. The big one. Interests rendered as soft overlapping regions (blobs), people as spheres inside them. Uses Canvas API. Took forever to get the physics/overlap right, but it looks good.
- [x] **Particle Background / Emblem** — Jane. Subtle animated particles in the background. Logo/emblem component added.
- [x] **"Why You Connect" Explanation UI** — Jane. Modal that shows the shared concepts and the LLM-generated explanation. This is the feature judges liked (or will like?).

## Messaging & Social
- [x] **Request/Accept Messaging** — Chen + Mei. Double opt-in. You can't message someone until they accept your request. Meets our privacy requirements (D4).
- [x] **Workspace Concept** — Chen. Users can create "Workspaces" (e.g., "HackMIT 2026", "CS Dept"). People in the same workspace are ranked higher.

## Performance & Model Ops
- [x] **Latency Fix (Keep-Warm)** — John + Chen. **Critical fix.** Ollama was unloading models after idle, causing 46s reloads. Added a heartbeat ping every 2 mins to keep `qwen3.8` and `nomic-embed-text` in memory. Also batched embeddings (256 at a time) and set instruct concurrency to 2. p95 latency went from 4.2s -> 0.9s.
- [x] **Model Upgrade: qwen2.5-14b -> qwen3.8** — John. Better adjudication accuracy. Had to set `reasoning_effort=none` because it's a thinking model and we don't want the latency/verbosity. (D7, 27 Aug).
- [x] **Hop Decay Tuning** — Noor. Adjusted the decay factor for one-hop related concepts from 0.5 -> 0.15. Previously, broad hierarchy overlaps were outranking rare direct matches. Now scoring feels more intuitive.

## Demo Prep
- [x] **Demo Flow Pivot** — Mei + John. We now start with ONE person's "why you connect" explanation, then zoom out to the atlas. Starting with the graph lost the thread in test runs.
- [x] **Code Freeze** — Thu 10 Sep, 6 pm. No new features since then. Only bug fixes and polish.

---
*Status: Ready for HackMIT weekend (Sat 12 – Sun 13 Sep). Fingers crossed.*
