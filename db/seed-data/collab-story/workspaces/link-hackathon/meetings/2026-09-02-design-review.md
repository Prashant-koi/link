# Design Review — Atlas & Visual Language
**Date:** Wed 2 Sep 2026
**Attendees:** Mei (facilitator), Jane, Chen, Noor, John, Diego (remote)
**Status:** Notes finalized same day.

## 1. Context
We’re 10 days out from the hackathon weekend. The scope cut on Aug 18 (no native app, no calendar) means our entire user experience lives in the browser. Today we reviewed the current state of the "Atlas" home screen (D8) and locked down the visual language for the final sprint.

## 2. Atlas Implementation (D8)
**The Concept:** Interests are soft, overlapping regions; people are spheres floating inside them.
**Current State:** Jane’s canvas implementation is functional but feels a bit "flat." The regions look like hard-edged SVG paths rather than organic concepts.

**Decisions:**
*   **Wobbly Boundaries:** We need to move away from perfect circles/ellipses. We’ll use Perlin noise or a similar noise function on the vertex points of the region paths to create an organic, "hand-drawn" feel. This reinforces that these are *concepts*, not rigid database tables.
    *   *Action (Jane):* Add a `wobble` parameter to the region renderer. Keep it subtle (2-5% radius variance).
*   **Particles:** Instead of static spheres, people should have a very slow, gentle drift (like dust in a sunbeam). This makes the app feel alive without being distracting.
    *   *Action (Jane):* Implement simple sine-wave motion on x/y offsets for user nodes. Respect `prefers-reduced-motion` by disabling this entirely.
*   **Zoom Behavior:** When you zoom into a region, the "why you connect" explanation should slide in from the right, not pop up as a modal. Modals break the spatial context. The atlas stays visible in the background, slightly dimmed (opacity 0.6).

## 3. Visual Language & Theme
**Turquoise is the anchor.** We are keeping the turquoise primary color (`#40E0D0` base, adjusted for contrast). It feels calm, academic, and distinct from the usual "tech blue" or "startup purple."

*   **Background:** Deep navy/slate (`#1A2639`). The turquoise pops beautifully against this.
*   **Text:** Off-white (`#F5F7FA`) for primary text, muted grey-blue (`#A0B0C0`) for secondary.
*   **Emblem/Logo:** We finalized the "Link" emblem today. It’s two overlapping turquoise rings with a small white dot in the intersection—representing the shared concept.
    *   *Action (Mei):* Export SVG/PNG variants (light/dark) and update `index.html` favicon.

## 4. Accessibility (A11y)
Diego raised this again. We can’t ship a "pretty but inaccessible" app.
*   **Contrast:** Checked all text colors against the navy background. All pass WCAG AA. The turquoise on navy is borderline for small text, so we’re using it only for large headers and interactive elements (buttons, links). Body text stays off-white.
*   **Reduced Motion:** As noted above, the particle drift *must* be disabled if `prefers-reduced-motion: reduce` is set.
    *   *Action (Jane):* Add the media query check to the animation loop.
*   **Keyboard Nav:** The atlas is canvas-based, which is tricky. We need a fallback list view for keyboard/screen reader users.
    *   *Decision:* Add a "List View" toggle in the top-right corner. This renders the same data as a standard `<ul>` with semantic headings. It’s not pretty, but it’s accessible.
    *   *Action (Jane):* Build the list view component. It should share state with the canvas so filtering works in both.

## 5. Demo Deck Prep
We’re starting the deck next week (target: draft by Sep 6).
*   **Slide 1:** Title + Logo. Clean, lots of whitespace.
*   **Slide 2:** The Problem. "Campus connections are hidden in silos."
*   **Slide 3:** The Solution. Screenshot of the Atlas with one region highlighted.
*   **Slide 4:** The "Why". This is our killer feature. Show the explanation card for two specific people. *This slide needs to be pixel-perfect.*
*   **Action (Mei):** I’ll build the deck template in Figma. Jane, please export high-res screenshots of the Atlas and the explanation UI by Sep 5.

## 6. Open Items / Blockers
*   [ ] **Jane:** Wobbly boundary implementation (Priority: High)
*   [ ] **Jane:** Reduced motion support (Priority: Critical)
*   [ ] **Mei:** Logo exports + favicon update (Priority: Medium)
*   [ ] **Chen:** Confirm the API endpoint for fetching region metadata includes the `wobble` seed value so the canvas and list view can sync if needed. (Probably not needed, but checking.)

## Next Steps
*   **Thu 3 Sep:** Jane implements wobble + reduced motion. Mei updates logo assets.
*   **Fri 4 Sep:** Quick visual check-in (30 mins). We look at the "alive" atlas together.
*   **Mon 7 Sep:** Start building the demo deck.

---
*Notes by Mei Shah. Last updated Wed 2 Sep 2026, 4:15 PM.*
