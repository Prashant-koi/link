# References & Reading Notes

> **Status:** Draft list. Most entries are placeholders based on memory or vague recollection.
> **Last updated:** Sat 12 Sep 2026 (Noor)
> **Note to John:** We need to verify these before the abstract deadline (Fri 25 Sep). Don't cite anything until I've confirmed the exact title/year.

## Core Ontology & Data Sources

- **[TO VERIFY] The Computer Science Ontology (CSO)**
    - *Why we need it:* This is our ground truth for canonical concepts. We map user interests to this subset.
    - *Notes:* Need the specific version we used for seeding. I think it’s the standard CSO from the Semantic Web community? Check if there’s a specific paper describing the structure or just cite the dataset repository.
    - *Action:* Find DOI or stable URL.

- **[TO VERIFY] DBpedia / Wikidata alignment papers**
    - *Why we need it:* Context for why we chose an ontology-based approach over free-text matching.
    - *Notes:* Probably just need 1–2 citations to justify "ontology mapping is better than keyword search." Look for standard NLP entity linking surveys.

## Methodology: Resolution Pipeline

- **[TO VERIFY] Papers on "Entity Linking" or "Named Entity Disambiguation"**
    - *Why we need it:* Our pipeline (Exact -> Trigram -> Embedding -> LLM) is basically a custom entity linker.
    - *Notes:* Need 2–3 classic papers here to show we’re standing on shoulders.
    - *Specific ideas to search:* "Fuzzy matching for entity resolution," "Hybrid approaches to entity linking."

- **[TO VERIFY] pgvector documentation / technical papers**
    - *Why we need it:* We use Postgres 16 + pgvector for the embedding stage.
    - *Notes:* Cite the pgvector GitHub repo or any academic paper on vector similarity search in SQL if one exists. If not, just cite the tool.

- **[TO VERIFY] IDF weighting for graph overlap**
    - *Why we need it:* We use inverse document frequency to weight shared concepts.
    - *Notes:* This is standard IR stuff (Information Retrieval). Cite a standard textbook or early paper on TF-IDF. Don’t over-cite, just one solid reference.

## LLM Adjudication & Local Models

- **[TO VERIFY] Ollama / Local LLM inference papers**
    - *Why we need it:* We run qwen3.8 locally. Need to justify why local is better for privacy (Diego’s point).
    - *Notes:* Look for papers on "Privacy-preserving LLM inference" or "On-device AI."

- **[TO VERIFY] Qwen model technical reports**
    - *Why we need it:* We use qwen3.8 (27B) and tested qwen3 4B.
    - *Notes:* Cite the specific technical report for Qwen 2.5 or Qwen 3 (whichever version matches our "qwen3.8" label in code—*TODO: double-check exact model name in config*).

- **[TO VERIFY] Papers on "LLM as a Judge"**
    - *Why we need it:* We use the LLM to adjudicate ambiguous concept matches.
    - *Notes:* There’s a lot of recent work on this. Find 1–2 high-quality papers (maybe Stanford or Berkeley groups?) that discuss using LLMs for classification/adjudication tasks.

## Related Work: Social Graphs & Recommendations

- **[TO VERIFY] "Collaborative Filtering" surveys**
    - *Why we need it:* We are essentially doing a variant of CF but based on concepts, not items.
    - *Notes:* Standard recommendation systems literature. Need to distinguish our approach (concept-graph based) from traditional item-based CF.

- **[TO VERIFY] Academic Social Network Analysis (ASNA)**
    - *Why we need it:* We are mapping university members.
    - *Notes:* Cite a few papers on how academic collaboration networks are modeled. This helps frame the "why" of our project.

## Misc / To Check Later

- **Human Evaluation Methodology**
    - *Note:* Noor is designing the 100-string eval. Need to cite standard human evaluation practices in NLP (e.g., inter-annotator agreement metrics like Cohen’s Kappa).
    - *Action:* Find a standard reference for "best practices in NLP annotation."

---
**TODOs for this week:**
1. [ ] John: Confirm exact Qwen model version name for citation.
2. [ ] Noor: Search for 3–4 solid Entity Linking papers.
3. [ ] Noor: Find the CSO dataset citation.
4. [ ] Both: Check if we need to cite the HackMIT/Dropbox rules? (Probably not, but keep in mind).
