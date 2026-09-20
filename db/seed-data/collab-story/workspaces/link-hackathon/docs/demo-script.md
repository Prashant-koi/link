# Link — Demo Script (HackMIT / Dropbox)

**Status:** FINAL (v3) — updated Sat 12 Sep 2026, 08:45
**Author:** Mei Shah
**Team:** John (tech), Jane (FE), Chen (BE), Noor (data/ML), Mei (design)
**Target length:** 5 minutes max. If we run long, cut the "Search" section, not the "Why" or "Privacy".

## ⚠️ CRITICAL RULES FOR SATURDAY
1. **Do NOT start with the Atlas.** We pivoted on Wed (D9) because judges lose the thread if they see a graph before they understand *why* it exists. We start with **one person**.
2. **No cloud APIs.** If Ollama crashes or lags, we have a fallback: John will pull up the pre-computed JSON of the "Sofia Petrov" example. Do not ad-lib about latency; just say "local processing is fast, here is the result."
3. **Privacy is the killer feature, not an afterthought.** Diego and Noor have hammered this. If a judge asks "what happens to their data?", we answer: "It never leaves the ASUS box. It’s cached as an alias, so the model never sees the raw string twice."

## Section 1: The "Why" (0:00 – 1:30)
**Speaker:** Jane (Frontend) + John (Tech Lead)
**Visual:** Single user profile card. Name: *Alex Chen* (fictional). Interests: "distributed systems", "Raft consensus", "Go".

*   **Jane:** "Meet Alex. He’s a 3rd-year CS student. On Link, we don’t just show him a list of people. We show him *why*."
*   **John:** (Clicks the 'View Connections' button) "Here is Noor. She’s in ML. Why are they connected?"
*   **Jane:** "Look at the explanation card. It says: *Shared concept: 'Leader Election'. Related: 'Log Replication' (1-hop decay 0.15).*"
*   **John:** "We didn't hardcode that. Our resolution pipeline took Alex's free-text 'Raft consensus', resolved it to the canonical ontology node, and matched Noor's 'distributed systems' tags. The LLM—running locally on our 128GB box—generated that specific explanation."
*   **Mei (Design):** "This is the core value prop. Not just a match, but a *reason*. It’s social proof for your skills."

**Key Point:** Emphasize the **local** aspect. "No data leaves the machine. The model is qwen3.8, running with reasoning off for speed."

## Section 2: The Atlas (1:30 – 3:00)
**Speaker:** Mei (Design) + Jane (Frontend)
**Visual:** Zoom out from Alex’s card to the full "Atlas" view. Turquoise theme. Soft overlapping regions.

*   **Mei:** "Now, let’s zoom out. This is the campus map. Each soft region is a concept cluster—like 'Distributed Systems' or 'NLP'. The spheres are people."
*   **Jane:** "The size of the sphere isn’t popularity; it’s *rarity-weighted overlap*. If you’re in a niche field, your matches are higher value. We use IDF scoring for that."
*   **Mei:** "You can drag the regions. Notice how 'Distributed Systems' overlaps with 'Database Internals'. That’s our 1-hop decay in action. It’s not a hard boundary; it’s a fluid space of knowledge."
*   **John:** "We built this on Postgres + pgvector, not Neo4j. One datastore, SQL, and recursive CTEs. It’s simpler to maintain, and the performance is fine for 10k users."

**Key Point:** Show the **fluidity**. Drag a region. Show how people move between clusters. This is the "wow" visual moment.

## Section 3: Search & Resolution (3:00 – 4:00)
**Speaker:** Noor (Data/ML) + John (Tech Lead)
**Visual:** Search bar. Type "vacation photos".

*   **Noor:** "What happens when someone types something weird? Like 'vacation photos'?"
*   **John:** "Our pipeline tries exact alias match, then trigram fuzzy match, then embedding nearest-neighbour."
*   **Noor:** "If the confidence is low (below 0.92), we don’t guess. We ask the LLM to adjudicate among the top-5 candidates."
*   **John:** "In this case, the model rejects it as a non-concept. It doesn’t force-fit 'vacation photos' into 'Computer Vision'. It says: *Not a valid academic concept.*"
*   **Mei:** "This is crucial for trust. We don’t hallucinate connections. If we’re not sure, we say so."

**Key Point:** Show the **rejection**. This proves we aren’t just a fuzzy search engine.

## Section 4: Privacy & The Future (4:00 – 5:00)
**Speaker:** Chen (Backend/Infra) + Mei (Design)
**Visual:** Architecture diagram (simplified). Local AI box. Postgres.

*   **Chen:** "The biggest question we get is privacy. Here’s the answer: **Local AI.**"
*   **Chen:** "We run Ollama on an ASUS GX10 with 128GB unified memory. nomic-embed-text for vectors, qwen3.8 for adjudication. No cloud APIs. No data leakage."
*   **Mei:** "We also have double opt-in messaging. You can’t message someone until they accept. It’s a safe space to connect."
*   **John:** "We’re planning to ship this as a responsive web app. No native mobile, no calendar integration—just the core connection engine. We cut scope on Aug 18 to focus on quality."
*   **All (Optional):** "Link is about surfacing hidden connections in your campus community."

## Contingency Plan
*   **If Ollama hangs:** John switches to pre-computed JSON. Jane clicks the "Fallback" button in the dev console.
*   **If the Atlas lags:** Mei says, "We’re optimizing the canvas rendering for mobile devices; this is the desktop view."
*   **If a judge asks about cost:** Chen says, "The hardware is a one-time cost. The API calls are zero. It’s cheaper to run locally than to pay per-token for 10k users."

## Checklist Before Demo
- [ ] Ollama models loaded (nomic-embed-text, qwen3.8)
- [ ] Postgres running, seeded with 2,946 test strings
- [ ] Chrome browser cleared, no extensions
- [ ] Turquoise theme applied
- [ ] Fallback JSON ready in `public/data/fallback.json`
- [ ] Team dressed in "hackathon casual" (no t-shirts with logos)

**Let’s do this. We’ve got this.** 🚀
