# Link — Pitch Deck Outline

**Owner:** Mei Shah
**Status:** Draft v3 (updated Fri 11 Sep)
**Last sync:** Standup, 9:15 am

Okay, team. The hackathon is TOMORROW. We are locking the narrative today. No more "what if we add this feature" — we have what we have, and it's good. This doc is the spine for the deck. Keep each slide to one core idea. If you can't say it in one sentence, cut it.

## The One Metric
**99.1%** of interest strings are resolved to canonical concepts without human intervention.
*Use this number on Slide 4 and in the verbal pitch. It proves the pipeline works.*

## The Narrative Arc
1. **The Problem:** Campus is a network, but we don't know who knows what.
2. **The Solution:** Link maps interests to a shared ontology.
3. **The Tech:** Local AI + Postgres (no cloud, no data leak).
4. **The Proof:** 99.1% resolution rate.
5. **The Experience:** The "Atlas" view.
6. **The Connection:** "Why you two connect."
7. **Privacy:** Double opt-in + local inference.
8. **Vision:** A living map of campus knowledge.

---

## Slide-by-Slide Breakdown

### 1. Title: Link
*   Visual: Logo on turquoise background. Clean.
*   Tagline: "Find the people who know what you're looking for."
*   *Note:* Don't over-explain here. Let Jane handle the verbal intro.

### 2. The Problem: The "Unknown Unknowns"
*   **Framing:** We all have skills, but they’re siloed. If I need help with Rust, who do I ask?
*   **Pain Point:** Random DMs, stale forums, no structured way to find expertise.
*   **Visual:** A chaotic web of disconnected nodes (grey/muted).
*   *Key Line:* "Expertise is hidden because it’s not indexed."

### 3. The Solution: Link
*   **Framing:** Link turns free-text interests into a structured concept graph.
*   **How it works:** You type what you know/want to learn → We resolve it to canonical concepts → We match you with others who share those concepts.
*   **Visual:** Transition from grey chaos to organized turquoise clusters.
*   *Key Line:* "We don’t just match keywords; we match understanding."

### 4. The Engine: Local & Reliable
*   **The Metric:** **99.1%** of 2,946 seeded interest strings resolved automatically.
*   **Why it matters:** Only 3.6% reach the LLM. Most matches are instant (exact/trigram).
*   **Tech Highlight:** Runs locally on campus hardware. No data leaves the building.
*   *Note:* John, have the latency stats ready if asked (p95 ~0.9s).

### 5. The Atlas: Seeing the Map
*   **Visual:** Screenshot of the home screen. Interests as soft overlapping regions; people as spheres inside them.
*   **Interaction:** Zoom in to see individuals, zoom out to see clusters.
*   **Design Note:** This is our "wow" moment. The turquoise theme makes it feel calm and organic, not like a database.
*   *Key Line:* "Your interests are a neighborhood, not a list."

### 6. The Connection: Why You Two Connect
*   **Framing:** We don’t just say "You share 'Python'." We explain *why*.
*   **Example:** "Alice and Bob both work on distributed systems, but Alice focuses on consensus algorithms while Bob optimizes network latency. Their overlap in 'Raft' is rare (high IDF), suggesting a deep technical synergy."
*   **Visual:** Side-by-side profile cards with the explanation text highlighted.
*   *Note:* This is the feature judges will love. It’s not just matching; it’s context.

### 7. Privacy & Trust
*   **Framing:** Your data stays yours.
*   **Key Points:**
    *   **Local Inference:** All AI runs on campus hardware (ASUS GX10). No cloud APIs for personal data.
    *   **Double Opt-In:** Messaging requires explicit acceptance from both parties. No unsolicited DMs.
    *   **Transparency:** Every match is explainable. You can see exactly which concepts triggered the connection.
*   *Key Line:* "Privacy isn’t a feature; it’s the architecture."

### 8. Vision & Roadmap
*   **Next Steps:**
    *   Pilot with CS department (meeting scheduled for late Sep).
    *   Expand ontology to other majors (Bio, Mech Eng).
    *   User study with 10 students (recruiting now).
*   **Closing Line:** "Link turns campus isolation into collaboration."

---

## Design & Visual Notes (For Jane)
*   **Theme:** Turquoise (`#40E0D0`) as primary. White background. Dark grey text.
*   **Typography:** Inter or Roboto. Clean, sans-serif.
*   **Animations:** Keep them subtle. Fade-ins for text, smooth zoom for the Atlas. No flashy transitions.
*   **Icons:** Use simple line icons for concepts (book, code, gear). Avoid clip art.

## Verbal Pitch Tips (For John/Jane)
*   Start with a story: "I was stuck on a Raft implementation last week..."
*   Emphasize the **local** aspect when privacy questions come up.
*   If asked about accuracy: "99.1% auto-resolution, and even the LLM adjudication has 39/40 agreement with human experts."
*   If asked about scale: "Postgres + pgvector handles millions of vectors easily. We’re not bottlenecked by storage."

## Open Questions / Risks
*   **Latency:** If the local box gets slow during the demo, have a pre-recorded video backup ready? (TODO: Check with Chen)
*   **Junk Strings:** We reject 10/10 junk strings in testing. Be prepared to show an example of a rejected string if asked.
*   **Mobile:** We cut the native app. If asked, say: "We focused on a responsive web experience first. Mobile is next."

---
**Next Steps:**
- [ ] Mei: Finalize slide visuals by 4 pm today.
- [ ] Jane: Build the demo flow (one person’s explanation → zoom out to atlas).
- [ ] John: Test the local AI latency one last time.
- [ ] Chen: Ensure the Docker Compose setup is stable on the demo machine.

Let’s make this count. 🌊
