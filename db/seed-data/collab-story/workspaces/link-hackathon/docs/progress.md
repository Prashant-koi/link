# Link — Progress Log

**Last updated:** Thu 17 Sep 2026  
**Owner:** John Doe

## Week 1 (14–20 Jul)
- Kicked off project. Mapped out the core idea: map free-text interests to a canonical ontology, then rank people by shared concepts.
- **D1 (Tue 21 Jul):** Decided on Postgres + pgvector instead of Neo4j. Chen argued for it (we know SQL, recursive CTEs are enough). Jane wanted Neo4j’s viz but accepted.
- Set up basic repo structure, Docker Compose skeleton.

## Week 2 (21–27 Jul)
- **D2 (Tue 28 Jul):** Designed the 4-stage resolution pipeline: exact alias → trigram fuzzy (≥0.6) → embedding NN (auto-accept ≥0.92, adjudication floor 0.60) → LLM adjudication. Only call the model when cheap matching fails.
- Started building the API skeleton (Express/TS).

## Week 3 (28 Jul – 3 Aug)
- **D3 (Tue 4 Aug):** Switched to local models for privacy (Diego’s concern). Started with qwen2.5-14b.
- Set up Ollama on the GX10 box. First embeddings working.

## Week 4 (4–10 Aug)
- **D4 (Tue 11 Aug):** Messaging is double opt-in (request/accept). Mei and Diego pushed for it.
- Built basic frontend with React/Vite.

## Week 5 (11–17 Aug)
- **D5 (Tue 18 Aug):** Scope cut — dropped native mobile app and calendar integration. Ship responsive web only. Jane disappointed but agreed.
- Frontend progress: profile pages, basic matching view.

## Week 6 (18–24 Aug)
- **D6 (Wed 26 Aug):** Found major blocker — p95 latency was 4.2s because Ollama unloaded idle models. Fixed with keep-warm heartbeat every 2 min, batching 256 embeddings, instruct concurrency 2. p95 down to 0.9s by Mon 31 Aug.
- **D7 (Thu 27 Aug):** Upgraded from qwen2.5-14b to qwen3.8. Better adjudication.

## Week 7 (25 Aug – 31 Aug)
- Tuned hop decay from 0.5 down to 0.15 — hierarchy-adjacent overlaps were outranking rare direct matches.
- Built the "atlas" home screen: interests as soft overlapping regions, people as spheres inside them. Turquoise theme.

## Week 8 (1–7 Sep)
- **D8 (Tue 1 Sep):** Home screen becomes the "atlas". Mei’s sketch, Jane’s canvas implementation.
- Polished explanations for why two people connect.

## Week 9 (8–14 Sep)
- **D9 (Wed 9 Sep):** Demo flow pivot — open on ONE person’s "why you connect" explanation, then zoom out to the atlas. Code freeze Thu 10 Sep 6 pm.
- Hackathon weekend (Sat 12 – Sun 13 Sep): Built overnight, demos Sunday noon.
- **Result:** 3rd place in Dropbox track. Judges praised the "why you two connect" explanations and asked hard questions about privacy.

## Week 10 (15–17 Sep)
- Post-hackathon cleanup and hardening.
- Noor + John tested qwen3 4B instruct: 3.6x faster but accepted 2/10 junk strings. Decision: keep qwen3.8 for adjudication.

## Where we are now (Sun 20 Sep)

| Item | Owner | Due |
|------|-------|-----|
| Harden auth (session rotation, rate limits on /auth) | Chen | Wed 23 Sep |
| Automatic retry with backoff (5s/20s/60s) for failed model jobs | John | Tue 22 Sep |
| User study with 10 students | Jane + Mei | Thu 24 – Sat 26 Sep |
| Human evaluation of 100 strings for paper | Noor | Wed 23 Sep |
| One-page privacy summary for pilot meeting | John | Fri 25 Sep |
| Paper abstract | John, Noor, Sofia | Fri 25 Sep |
| Full paper submission | John, Noor, Sofia | Fri 2 Oct |
| CS 431 milestone 3 (snapshotting + linearizability tests) | John, Nina, Amara | Wed 30 Sep |

**Next up:** Pilot meeting with CS department Tue 29 Sep at 2 pm.
