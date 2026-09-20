# Resolution Pipeline — Results

*Last updated: Thu 17 Sep 2026 by Noor Rahman*
*Context: These numbers feed the paper "Small local language models for resolving free-text interests to a concept ontology" (Sofia, John, Noor). Abstract due Fri 25 Sep.*

## Seed Data

- **N = 2,946** free-text interest strings seeded from the CS Ontology subset + realistic "noise" strings.
- All runs on the local Ollama stack (ASUS GX10, 128 GB). Embeddings: `nomic-embed-text`. Adjudication: `qwen3.8` (27B, `reasoning_effort=none`).

## Resolution by Stage

The pipeline is designed so that the LLM is only called when cheap matching fails. Here is where each string lands:

| Stage | Description | Strings | % of Total |
| :--- | :--- | :--- | :--- |
| 1 | Exact alias match (cached) | 1,842 | 62.5% |
| 2 | Trigram fuzzy match (sim >= 0.6) | 745 | 25.3% |
| 3 | Embedding nearest-neighbour (auto-accept >= 0.92) | 128 | 4.3% |
| 4 | **LLM Adjudication** (top-5 candidates) | **106** | **3.6%** |
| 5 | LLM Proposes New Concept (len >= 5) | 25 | 0.8% |
| **Total** | **Resolved Automatically** | **2,924** | **99.1%** |

*Note: The "auto-accept" embedding threshold (0.92) rarely fires in practice because the trigram stage catches most near-matches first. The 3.6% reaching the LLM is our key efficiency metric for the paper.*

## Model Comparison: Adjudication Quality vs. Speed

We compared the current production model (`qwen3.8`) against a smaller candidate (`qwen3-4b-instruct`) on a fixed test set of **40 real ambiguous cases** and **10 junk/non-concept strings**.

| Metric | qwen3.8 (27B) | qwen3-4b-instruct |
| :--- | :--- | :--- |
| **Agreement with Gold Label** | 39/40 (97.5%) | 37/40 (92.5%) |
| **Junk String Rejection** | 10/10 (100%) | 8/10 (80%) |
| **Median Latency** | 1.8 s | 0.5 s |
| **P95 Latency** | 2.4 s | 0.7 s |

### Analysis
- **Speed:** The 4B model is ~3.6x faster. If we were batching thousands of strings, this would matter. For our use case (background worker, low volume), latency is acceptable with the 27B model.
- **Safety:** The 4B model failed on 2 junk strings. Specifically, it mapped "vacation photos" to a concept related to "real scenes" and accepted "gym routine" as a valid CS concept. `qwen3.8` correctly rejected all 10 junk strings.
- **Decision:** Keep `qwen3.8` for adjudication. The privacy benefit of local inference is the same for both, but the quality drop in the 4B model is not worth the speed gain for our scale.

## TODO / Next Steps

| Task | Owner | Status | Notes |
| :--- | :--- | :--- | :--- |
| **Trigram Ablation** | Noor | In Progress | Need to run pipeline with Stage 2 disabled to show how much load shifts to the LLM. Expect LLM calls to jump from 3.6% to ~15-20%. |
| **Human Evaluation** | Noor | Not Started | Label 100 random strings (mix of resolved/failed) for ground truth in the paper. Due Wed 23 Sep. |
| **Pipeline Figure** | Mei | Pending | Need a clean diagram of the 5 stages for the paper. I can provide the JSON logs if needed. |
| **Related Work** | John | Not Started | Need to find 2-3 papers on ontology alignment with LLMs. |

## Raw Data Links
- `experiments/logs/run_2026-09-15_full.jsonl`
- `experiments/eval/junk_strings_test.csv`
- `experiments/eval/ambiguous_cases_40.csv`
