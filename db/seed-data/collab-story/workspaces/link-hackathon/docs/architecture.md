# Link — Architecture

> **Last updated:** Tue 8 Sep 2026 by John Doe  
> **Status:** Stable. Code freeze is Thu 10 Sep 6 pm. Do not merge structural changes without a team sync.

## Overview

Link maps free-text interests to a canonical concept ontology and ranks people by rarity-weighted overlap. We use a single Postgres instance for both relational data and vector search (pgvector). No graph database; recursive CTEs handle the one-hop related-concept logic we need.

## Data Model

| Table | Purpose |
| :--- | :--- |
| `actor` | Users (students, staff). Holds profile text. |
| `concept` | Canonical nodes in our ontology subset (CS Ontology). |
| `alias` | Cached string -> concept mappings. Every model decision is written here so a string never hits the LLM twice. |
| `actor_concept` | Join table: which concepts an actor has. Includes weight/confidence. |
| `edge` | Derived relationships (intro requests, connections). |
| `intro` | Request/accept state machine for introductions. |
| `message` | Private messages (only visible after double opt-in). |

## Resolution Pipeline

We resolve a raw interest string to a `concept_id` in four stages. The LLM is only called if cheap matching fails.

1.  **Exact Alias Match:** Look up the normalized string in `alias`. If found, return immediately.
2.  **Trigram Fuzzy Match:** `pg_trgm` similarity >= **0.6**. Returns best candidate.
3.  **Embedding Nearest-Neighbour:**
    *   Compute embedding via `nomic-embed-text` (768-dim).
    *   Query pgvector for top-5 candidates.
    *   If top-1 score >= **0.92**, auto-accept. *(Note: In practice, this threshold rarely fires; most go to adjudication.)*
    *   Adjudication floor is **0.60**. If best score < 0.60, skip to "New Concept" logic.
4.  **LLM Adjudication:**
    *   Model: `qwen3.8` (27B, thinking model, `reasoning_effort=none`).
    *   Input: Raw string + top-5 candidate concepts with descriptions.
    *   Output: JSON `{ "concept_id": ..., "confidence": ... }` or `{ "new_concept": true }`.
    *   **New Concept Proposal:** Only allowed if the raw string is **5+ characters**.

*Design decision (28 Jul): This pipeline ensures we don't pay for LLM inference on obvious matches. Noor and John designed this to keep latency low.*

## Job Queue & Worker

*   **Queue:** Postgres table `jobs`. Uses `FOR UPDATE SKIP LOCKED` for concurrency safety.
*   **Worker:** Separate Node/TS process. Polls for pending `resolve_interest` jobs.
*   **Concurrency:** Limited to 2 concurrent LLM requests to avoid OOM on the local box.

## Scoring

$$ Score(A, B) = \sum_{c \in shared} IDF(c) + \lambda \sum_{r \in related} IDF(r) $$

*   `IDF(c)`: Inverse document frequency of concept `c` across all actors.
*   `related`: One-hop neighbors in the ontology graph.
*   `λ` (decay factor): **0.15**. *Tuned down from 0.5 on 26 Aug because hierarchy-adjacent overlaps were outranking rare direct matches.*

## Local AI Stack

*   **Hardware:** ASUS GX10, 128 GB unified memory.
*   **Runtime:** Ollama.
*   **Models:**
    *   `nomic-embed-text`: Embeddings.
    *   `qwen3.8`: Adjudication and explanation generation.
*   **Keep-Warm:** Heartbeat every 2 minutes to prevent model unloading. Unloading/reloading was causing p95 latency spikes (D6, 26 Aug). Current p95 is ~0.9s.

## Deployment

*   **Stack:** Docker Compose.
    *   `postgres`: 16 + pgvector.
    *   `api`: Node/Express.
    *   `worker`: Node/TS job processor.
    *   `ollama`: Local LLM server.
    *   `nginx`: Reverse proxy, HTTPS termination.
*   **Domain:** `linkmit.duckdns.org`

## Diagram

```
[Client] --> [Nginx (HTTPS)]
                |
        +-------+-------+
        |               |
   [API Server]    [Worker Process]
        |               |
        +-------+-------+
                |
          [Postgres 16]
         /             \
   [Relational]     [pgvector]
                       |
                 [Ollama (Local)]
              /             \
   [nomic-embed]      [qwen3.8]
```

## TODOs / Rough Edges

*   [ ] **John:** Add automatic retry with backoff (5s/20s/60s) for failed model jobs. Due Tue 22 Sep.
*   [ ] **Chen:** Harden auth (session rotation, rate limits on `/auth`). Due Wed 23 Sep.
*   [ ] **Noor:** Verify `alias` cache hit-rate is >95% before demo.
*   [ ] **Mei/Jane:** Finalize "Atlas" canvas rendering for the home screen (D8).
