# Paper — Small local models for interest resolution

**Title:** Small local language models for resolving free-text interests to a concept ontology
**Authors:** John Doe (first), Noor Rahman, Sofia Petrov
**Advisor:** Prof. Sofia Petrov
**Target venue:** NLP-for-Education Workshop (TBD)
**Status:** Drafting — abstract due soon

---

## Deadlines

| Date | Item | Owner |
| :--- | :--- | :--- |
| **Fri 25 Sep 2026** | Abstract submission | John / Noor |
| **Mon 28 Sep 2026** | Full draft to Sofia for review | John / Noor |
| **Fri 2 Oct 2026** | Full paper submission | All |

> ⚠️ **Note:** The HackMIT / Dropbox hackathon weekend was Sat 12–Sun 13 Sep. We are now in the post-hackathon polish phase. Do not let hackathon tasks bleed into paper deadlines.

---

## Current Status (as of Wed 16 Sep)

We have a working resolution pipeline and initial results. The core claim is that we can resolve free-text interests to a canonical ontology with high accuracy using only local, small models, avoiding cloud API calls for privacy reasons.

**Key metrics so far:**
- Pipeline resolves **99.1%** of 2,946 seeded interest strings without human intervention.
- Only **3.6%** of strings reach the LLM adjudication stage.
- **Adjudication (qwen3.8):** 39/40 agreement with gold standard; 10/10 junk strings rejected.
- **Small model test (qwen3 4B):** 37/40 agreement; 8/10 junk rejected. Decision: keep qwen3.8 for adjudication due to better junk rejection.

---

## Where Things Live

| Item | Location | Notes |
| :--- | :--- | :--- |
| **Resolution pipeline code** | `link/backend/resolution/` | Node/TS; Postgres + pgvector backend. See `README.md` in that folder for setup. |
| **Evaluation scripts** | `paper/eval/` | Noor’s scripts for running the 2,946-string benchmark and junk-string tests. |
| **Results data** | `paper/data/results_v1.json` | Latest run (Mon 14 Sep). Includes per-stage breakdown and model comparison. |
| **Draft LaTeX** | `paper/draft/main.tex` | John has the skeleton; Noor is filling in Related Work. |
| **Figures** | `paper/figures/` | Mei is working on the pipeline diagram (DAG of stages). Not final yet. |
| **Privacy summary** | `paper/privacy_summary.md` | One-page doc for Diego’s CS department pilot meeting (due Fri 25 Sep). |

---

## Open Items / TODOs

- [ ] **Related Work:** Noor to draft section comparing our pipeline to existing ontology-matching approaches. Due: **Tue 22 Sep**.
- [ ] **Ablation Study:** Remove trigram fuzzy match stage and measure impact on accuracy/latency. John to run this. Due: **Wed 23 Sep**.
- [ ] **Human Evaluation:** Noor to manually label 100 random strings (mix of common, rare, and junk) for ground truth validation. Due: **Wed 23 Sep**.
- [ ] **Pipeline Figure:** Mei to finalize the diagram showing: `exact match → trigram → embedding → LLM adjudication → new concept proposal`. Due: **Thu 24 Sep**.
- [ ] **Abstract Draft:** John to write first pass. Due: **Sun 21 Sep** (internal review before Fri 25 Sep deadline).
- [ ] **Privacy Summary:** John to write one-page summary for Diego. Due: **Fri 25 Sep**.

---

## Notes from Sofia (Wed 16 Sep)

1. **Focus on the "why":** The judges at HackMIT liked the explanations. In the paper, make sure we clearly articulate *why* local models are sufficient here. It’s not just about privacy; it’s about latency and cost for a campus-scale app.
2. **Junk String Handling:** This is our differentiator. Most systems either hallucinate a match or fail silently. Our 10/10 rejection rate on qwen3.8 is strong evidence. Highlight this in the abstract.
3. **Small Model Discussion:** Don’t oversell the 4B model. Use it as a lower-bound comparison to show that even a very small model does most of the work, but the larger model is needed for edge cases. This supports the "small local models" title without claiming all tasks are trivial.
4. **Ethics/Privacy Section:** Keep it concise. Reference the double-opt-in messaging design (D4) as part of the system’s privacy posture, but don’t let it dominate the NLP focus.

---

*Last updated: Wed 16 Sep 2026 by Sofia Petrov*
