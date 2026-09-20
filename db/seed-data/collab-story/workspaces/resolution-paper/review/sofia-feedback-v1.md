# Feedback on Draft v1 — "Small local LMs for resolving free-text interests"

**From:** Prof. Sofia Petrov
**Date:** Thu 10 Sep 2026
**To:** John, Noor

Hi both,

I’ve read through draft v1. The core contribution is strong: a practical, privacy-preserving pipeline that gets 99.1% resolution without human intervention. That’s a solid result for a workshop paper. However, the current draft reads more like an engineering report than a research paper. Below are my specific comments and a prioritized list of fixes before the abstract deadline (Fri 25 Sep) and full submission (Fri 2 Oct).

## Structure & Tone

1.  **"Tone down the novel."** The introduction currently spends too much time on the "Link" app’s user experience and the hackathon context. This is a NLP-for-Education workshop; the audience cares about the *methodology* of resolving free-text to an ontology, not the UI. Move the app description to a brief "System Context" paragraph in the Introduction. The focus must be on the pipeline itself.
2.  **Abstract clarity.** The current abstract leads with the technology (Postgres, Ollama). It should lead with the *problem* (resolving noisy free-text interests to a canonical ontology) and the *contribution* (a staged pipeline that minimizes LLM calls while maintaining high accuracy). Mention the local model constraint early, as it is a key differentiator.
3.  **Related Work.** This section is currently thin. You need to contrast your approach with:
    *   Standard entity linking / slot filling literature.
    *   Other works using local LLMs for classification/adjudication (cite 2-3 recent papers; I can suggest some).
    *   Ontology matching techniques that do *not* use LLMs.

## Pipeline & Figures

4.  **Figure 1 Placement.** The pipeline diagram is currently in Section 4. It needs to be Figure 1, placed immediately after the Introduction. The reader needs to see the "exact match -> trigram -> embedding -> LLM" flow before reading the details. Mei’s sketch is good, but it needs to be vectorized and annotated with the decision thresholds (e.g., "auto-accept >= 0.92", "adjudication floor 0.60").
5.  **Explain the "Why".** You mention that only 3.6% of strings reach the LLM. This is a critical efficiency metric. Highlight this in the abstract and results. It demonstrates that the cheap heuristics are doing the heavy lifting, which justifies the "local model" constraint.

## Evaluation & Methodology

6.  **Junk String Handling.** The fact that qwen3.8 rejected all 10 junk strings while the 4B model accepted 2 is a great data point. But *why*? Add a short paragraph analyzing failure modes. Did the 4B model lack the "common sense" to reject non-conceptual phrases? This adds depth to the "small model" discussion.
7.  **Human Evaluation.** You mention Noor is doing a human eval of 100 strings. Ensure this is clearly defined in the Methodology section:
    *   Who are the annotators? (Students? Faculty?)
    *   What is the inter-annotator agreement metric (Cohen’s Kappa)?
    *   How does the LLM adjudication compare to human "ground truth"?

## Ethics & Privacy

8.  **User Study Consent.** Since you are using student interests, ensure you have a clear statement about IRB/ethics approval or exemption. Even if it’s a small pilot, state that data was anonymized and consent was obtained. Diego’s privacy concerns were valid; the paper should reflect that this design *chose* local models specifically for privacy.

## Prioritized To-Do List

| Priority | Task | Owner | Deadline |
| :--- | :--- | :--- | :--- |
| **P0** | Rewrite Introduction to focus on NLP problem, not app UX | John | Fri 18 Sep |
| **P0** | Create final Figure 1 (pipeline) with thresholds | Mei + John | Mon 21 Sep |
| **P0** | Expand Related Work (add 3-5 citations) | Noor | Wed 23 Sep |
| **P1** | Add "Failure Modes" analysis for junk strings | Noor | Wed 23 Sep |
| **P1** | Draft Ethics/Consent statement | John + Diego | Fri 25 Sep |
| **P2** | Polish Results section to highlight 99.1% & 3.6% metrics | John | Mon 28 Sep |

Let’s sync on Tuesday to review the revised Introduction. Don’t forget, the abstract is due in two weeks, so we need a solid skeleton by then.

Best,
Sofia
