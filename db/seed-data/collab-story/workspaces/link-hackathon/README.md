# Link — Campus Concept Graph

**Status:** Hackathon build complete (Sun 13 Sep). We placed **3rd in the Dropbox track**. Judges specifically called out the "why you two connect" explanations. Now shifting to a pilot with the CS department (meeting Tue 29 Sep, 2 pm).

## What is Link?
Link maps what people *know* and what they *want to learn* onto a shared concept graph. It resolves free-text interests into canonical concepts (subset of the Computer Science Ontology) and ranks potential connections by rarity-weighted overlap (IDF). Every suggestion includes an explanation of *why* those two people connect.

Built for HackMIT / Dropbox hackathon (Sat 12 – Sun 13 Sep 2026) by the team below. Started Tue 14 Jul 2026.

## Team & Roles
| Name | Role |
| :--- | :--- |
| **John Doe** | Tech Lead, Resolution Pipeline, Local AI Integration |
| **Jane Doe** | Frontend (React/Canvas) |
| **Chen Diaz** | Backend/Infra (Node/TS, Postgres, Docker) |
| **Noor Rahman** | Data/ML (Scoring, Evaluation) |
| **Mei Shah** | Design (Atlas visualization, UX) |

**Mentor:** Diego Amari (CS Dept Staff)  
**Paper Advisor:** Prof. Sofia Petrov

## Tech Stack
- **DB:** Postgres 16 + pgvector (768-d vectors). We chose this over Neo4j for simplicity and SQL familiarity (Decision D1, 21 Jul).
- **API:** Node.js / TypeScript (Express).
- **Frontend:** React 18 + Vite. Plain CSS design tokens. Turquoise theme.
- **AI (Local):** Ollama running on an ASUS GX10 box (128GB unified memory).
  - `nomic-embed-text` for embeddings.
  - `qwen3.8` (27B, thinking model with reasoning off) for adjudication and explanations.
  - *Note:* We run models locally to keep personal interest data on-prem (Decision D3, 4 Aug).
- **Infra:** Docker Compose behind nginx with HTTPS (`linkmit.duckdns.org`).

## How to Run
```bash
# 1. Clone and configure environment
cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD, OLLAMA_HOST (default http://gx10:11434)

# 2. Start the stack
docker compose up -d

# 3. Seed test data (optional)
docker compose exec api npm run seed:test
```

**Local AI Setup:**
Ensure Ollama is running on the GX10 box with the following models pulled:
```bash
ollama pull nomic-embed-text
ollama pull qwen3.8
```
*Tip:* The worker uses a keep-warm heartbeat every 2 minutes to avoid model unload/reload latency (see Decision D6).

## Resolution Pipeline
Our core logic resolves user interests to ontology concepts in four stages:
1. **Exact Alias Match**
2. **Trigram Fuzzy Match** (threshold >= 0.6)
3. **Embedding Nearest-Neighbour** (auto-accept >= 0.92, adjudication floor 0.60)
4. **LLM Adjudication** (qwen3.8 chooses among top-5 candidates)

Every model decision is cached as an alias so a string never hits the model twice. If no match is found and the string is >= 5 characters, the LLM may propose a new concept.

## Current Status & Next Steps
We are moving from hackathon mode to pilot preparation. Key upcoming items:

- **Auth Hardening:** Chen is adding session rotation and rate limits on `/auth` (due Wed 23 Sep).
- **Retry Logic:** John is implementing automatic retry with backoff (5s/20s/60s) for failed model jobs (due Tue 22 Sep).
- **User Study:** Jane & Mei are recruiting 10 students for a usability test (Thu 24 – Sat 26 Sep).
- **Paper Abstract:** Due Fri 25 Sep. Full submission due Fri 2 Oct. Target: NLP-for-education workshop.
- **Pilot Meeting:** Tue 29 Sep, 2 pm with CS Department. Need a one-page privacy summary from John (due Fri 25 Sep).

## Documentation
- `docs/ARCHITECTURE.md` — System diagram and data flow.
- `docs/RESOLUTION_PIPELINE.md` — Detailed logic for concept resolution.
- `docs/PRIVACY.md` — Data handling and local AI rationale.
- `meetings/` — Weekly sync notes and decision logs (D1–D9).

## Contact
For questions or to join the pilot, contact John Doe.
