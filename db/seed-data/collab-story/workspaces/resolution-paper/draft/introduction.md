# Introduction (Draft)

*Last updated: Tue 15 Sep 2026*
*Author: John Doe*

> **[Sofia]:** *This is a bit long. I want the first two paragraphs to be punchy. Let’s cut the fluff about "messy data" and get straight to why we care. Also, do we have a concrete number for how many users/strings this was tested on? The abstract needs the 2,946 figure.*
> **[John]:** *Will shorten. I added the numbers from Noor’s latest run (99.1% auto-resolved).*

## Problem Statement

University communities are dense with potential collaboration, but students rarely connect because their self-described interests are messy, informal, and semantically inconsistent. One student writes "ML," another "neural nets," and a third "deep learning." Traditional keyword matching fails here; it misses synonyms and cannot handle the long tail of niche topics.

However, building a solution that relies on cloud-based Large Language Models (LLMs) for semantic resolution creates a significant privacy barrier. Student interests are personal data; sending this free-text to third-party APIs violates institutional trust and raises GDPR/CCPA concerns. We need a system that is semantically robust but runs entirely on local infrastructure.

## Our Approach

We propose **Link**, a concept-resolution pipeline designed for the HackMIT/Dropbox hackathon (Sep 2026). The core contribution is a hybrid resolution strategy that minimizes LLM calls by leveraging cheap, deterministic checks first:

1.  **Exact Alias Match:** Direct lookup in a curated ontology (subset of CS Ontology).
2.  **Trigram Fuzzy Match:** Rapid string similarity check (threshold $\ge$ 0.6).
3.  **Embedding Nearest-Neighbour:** Vector search using `nomic-embed-text` (768-dim) via pgvector.
4.  **LLM Adjudication:** Only if the above fail, a local model (`qwen3.8`, 27B) chooses among top-5 candidates or proposes a new concept.

By running all inference locally on a single workstation (ASUS GX10, 128GB RAM) using Ollama, we ensure zero data exfiltration. This architecture allows us to process free-text interests with high accuracy while maintaining strict privacy guarantees.

## Contributions

This paper makes the following contributions:

*   **A Privacy-First Resolution Pipeline:** We demonstrate a four-stage pipeline that resolves **99.1%** of 2,946 seeded interest strings without human intervention. Crucially, only **3.6%** of these strings require the computationally expensive LLM adjudication step, reducing average latency and cost.
*   **Local Model Evaluation for Adjudication:** We benchmark `qwen3.8` (27B) against a smaller `qwen3` (4B) model. While the 4B model is 3.6x faster, it fails on edge cases (accepting junk strings like "vacation photos" as valid concepts). We show that for high-stakes semantic adjudication, the larger local model remains necessary, and we provide a quantitative analysis of this trade-off.
*   **Deployment Architecture:** We detail a production-ready stack using Postgres 16 + pgvector for hybrid search and a Node.js API with a background worker queue, deployed behind HTTPS. This proves that complex NLP tasks can be served reliably on edge hardware without cloud dependencies.

## Scope and Limitations

> **[Sofia]:** *We need to explicitly state here that we are NOT claiming this is a general-purpose ontology builder. It’s specific to the CS domain subset. Also, mention the "why you connect" explanation feature briefly? That was our main demo hook.*
> **[John]:** *Good point. I’ll add a sentence about the explanation generation using the same local model. The scope limitation goes in Section 4, but I can hint at it here.*

This work focuses on the Computer Science domain, where the ontology is well-defined. We do not address the curation of new ontologies from scratch, nor do we evaluate cross-domain generalization. However, the pipeline’s modularity suggests it could be adapted to other fields with appropriate ontology seeds.
