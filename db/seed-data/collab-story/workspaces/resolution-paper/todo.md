# Paper TODO — "Small local language models for resolving free-text interests to a concept ontology"

*Last updated: Sat 19 Sep 2026 by SP*
*Abstract due: Fri 25 Sep | Full draft internal review: Mon 28 Sep | Workshop submission: Fri 2 Oct*

## Status Snapshot
- **Current status:** ✅ Drafting in progress. Core results are solid; writing and figures are the bottleneck.
- **Team:** John (First author, pipeline design), Noor (ML evals, human study), Sofia (Advisor/Co-author).
- **Key Metric to Headline:** 99.1% resolution rate without human intervention on 2,946 seeded strings.

## Critical Path & Deadlines

### 1. Human Evaluation (Noor)
- [ ] **Due: Wed 23 Sep** — Complete manual review of the 100 held-out strings.
    - *Note:* This is the final piece of data we need for the "Accuracy vs. Cost" table. Noor, please ensure you are annotating against the *final* ontology state (post-August updates).
    - *Dependency:* John needs these numbers by EOD Wed to finalize the Results section.

### 2. Ablation Study: Trigram Stage (John)
- [ ] **Due: Thu 24 Sep** — Run pipeline with trigram matching disabled.
    - *Goal:* Quantify how much of the "cheap match" success is due to fuzzy string logic vs. embedding recall.
    - *Hypothesis:* If we remove trigrams, LLM calls should spike significantly. We need this to justify the 4-stage pipeline complexity in the Methodology section.
    - *Action:* John, push the numbers into `results/ablation_trigram.md` by end of day Thu.

### 3. Related Work Section (John)
- [ ] **Due: Fri 25 Sep** — Draft complete.
    - *Scope:* Focus on:
        1. Entity Linking / Ontology Alignment literature.
        2. Recent LLM-based semantic matching papers (2024–2026).
        3. Explicitly contrast with cloud-based APIs (privacy/cost argument for local models).
    - *Note:* Keep it tight. Max 1.5 pages. Don't try to cover every graph DB paper; focus on the *resolution* aspect.

### 4. Pipeline Figure (Mei)
- [ ] **Due: Mon 28 Sep** — High-res vector figure of the 4-stage pipeline.
    - *Spec:* Must clearly show the flow: `Exact -> Trigram -> Embedding -> LLM Adjudication`.
    - *Requirement:* Include a callout box showing the "Alias Caching" mechanism (this is our key efficiency claim).
    - *Format:* SVG or PDF, scalable for LaTeX.

### 5. Abstract & Introduction (John + Sofia)
- [ ] **Due: Fri 25 Sep** — Abstract final draft.
    - *Checklist:*
        - [ ] Problem statement (free-text interests -> canonical concepts).
        - [ ] Method (local LLM, 4-stage pipeline).
        - [ ] Results (99.1% auto-resolution, 3.6% LLM usage, qwen3.8 vs 4B comparison).
        - [ ] Impact (privacy-preserving, low-latency campus app).
    - *Sofia:* Please review the tone. Ensure we emphasize "educational context" as requested by the workshop CFP.

### 6. Full Draft Assembly (All)
- [ ] **Due: Mon 28 Sep** — All sections compiled into `main.tex`.
    - John: Methodology + Results.
    - Noor: Evaluation Metrics + Human Study details.
    - Sofia: Conclusion + Limitations (be honest about the "vacation photos" edge case and latency p95).

### 7. Submission (Sofia)
- [ ] **Due: Fri 2 Oct** — Upload to workshop portal.
    - *Check:* Confirm page limit (likely 8 pages + refs).
    - *Check:* Anonymity? (Check CFP—some workshops require double-blind, some don't. If anonymous, remove team names from code snippets).

## Open Questions / Risks
1. **Model Naming:** Are we citing "qwen3.8" or the specific version hash? *Decision: Use the Ollama tag `qwen3.8` as deployed, but mention it is a 27B parameter model in the appendix.*
2. **Latency Data:** We have p95 = 0.9s after the keep-warm fix (D6). Do we report raw Ollama latency or end-to-end API latency? *Decision: Report end-to-end, but include a footnote about the heartbeat mechanism if space allows.*
3. **Small Model Comparison:** The 4B model agreed on 37/40 cases. Is this enough to claim "cost-effective alternative"? *Sofia's take: Yes, frame it as a trade-off study. We keep 27B for production due to the junk-string rejection rate (10/10 vs 8/10), but show the 4B is viable for low-stakes tasks.*

## Notes from Sofia
- *Mon 17 Aug:* Started tracking. Good progress on the pipeline design.
- *Tue 25 Aug:* Reviewed D6 latency fix. This is a strong engineering contribution, make sure it's visible in the paper, not just hidden in code comments.
- *Sat 19 Sep (Today):* Hackathon is over (3rd place). Let's pivot fully to the paper now. The "why you connect" feedback from judges is great qualitative data—maybe we can cite one anonymized example in the Introduction?

---
*Reminder: Noor, if the human eval takes longer than expected, tell me by Tue 22 Sep so we can adjust the timeline. Do not crunch on the deadline night.*
