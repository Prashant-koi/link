# Pilot Planning — Fri 18 Sep 2026

**Attendees:** John, Diego Amari (mentor)
**Context:** We're 6 days out from the hackathon weekend. We got 3rd place in the Dropbox track; judges liked the "why you connect" explanations but grilled us on privacy. Diego wants to move this into a real pilot with one CS course before end of term.

## Decisions
- **Pilot scope:** One course, ~60 students. No new features, just the current web app (linkmit.duckdns.org).
- **Department meeting:** Tue 29 Sep at 14:00 with the CS dept staff to discuss onboarding and data handling.
- **Privacy one-pager:** I owe Diego a one-page summary of how we handle data by Fri 25 Sep. This is a hard blocker for the meeting.

## Success Metrics (for the pilot)
We need to show this isn't just a toy. Proposed metrics:
1. **Activation:** % of students who add >3 interests and accept at least one connection request.
2. **Engagement:** Median time spent on "why you connect" cards.
3. **Quality:** # of rejected suggestions (people clicking "not relevant"). We want <5% rejection rate.
4. **Privacy incidents:** Zero data leaks. Obviously.

## Privacy One-Pager Outline (Due Fri 25 Sep)
*Draft below, needs review from Chen/Noor before I send to Diego.*

1. **Local AI:** All embeddings and adjudication run on our local server (ASUS GX10). No interest strings or messages leave the machine. No cloud APIs.
2. **Data Storage:** Postgres 16 + pgvector. Interests are resolved to canonical concepts; raw free-text is stored only as an alias cache for efficiency, not for analysis.
3. **Access Control:** Request/accept messaging (double opt-in). Nobody can message you until you accept. Session tokens rotate on every login.
4. **Retention:** Pilot data will be deleted after the term ends unless students explicitly opt in to research use (with Prof. Petrov's IRB if needed — probably not for this scale, but check).
5. **No Tracking:** No analytics, no third-party scripts. Plain CSS, no Google Fonts.

## Action Items
- [ ] **John:** Draft privacy one-pager by Wed 23 Sep. Finalize Fri 25 Sep.
- [ ] **Chen:** Hardening auth (session rotation, rate limits on `/auth`) — due Wed 23 Sep. *Critical for pilot.*
- [ ] **Noor:** Human evaluation of 100 strings for the paper — due Wed 23 Sep. Also: can you sanity-check our privacy claims?
- [ ] **Jane + Mei:** User study with 10 students Thu 24 – Sat 26 Sep. Recruiting now. *This feeds into pilot feedback.*
- [ ] **Diego:** Confirm department meeting time Tue 29 Sep.

## Open Questions
1. **Who owns the pilot data?** CS dept or us? Need to clarify in the meeting.
2. **Onboarding flow:** Do we need a simple "add your interests" page, or is the current home screen (atlas) enough for non-hackathon users? Mei thinks we need a simpler entry point.
3. **Rate limits:** Chen's auth hardening — what threshold? 10 req/min per IP?
4. **IRB:** Do we need IRB approval for a 60-student pilot? Prof. Petrov says probably not, but let's confirm with Diego.

## Notes from Diego
- "The judges were right to ask about privacy. We need to be able to explain this in one page, no jargon."
- "If the pilot works, we can pitch to other departments next semester. But only if the data handling is airtight."
- "Don't let the hackathon momentum distract from the course project. Milestone 3 is due Wed 30 Sep. John, you're still on top of log replication, right?"

## Next Steps
- Sync with Chen & Noor Mon 21 Sep to review privacy draft.
- Jane/Mei to share user study findings by Sun 27 Sep.
- Prepare 5-min demo for Tue 29 Sep meeting (start with "why you connect", zoom out to atlas — per D9).

---
*Last updated: Fri 18 Sep 2026, 16:42 by John*
