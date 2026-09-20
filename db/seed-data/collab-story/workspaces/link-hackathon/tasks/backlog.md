# Backlog — Post-Hackathon

_Last updated: Fri 18 Sep 2026 by John_

We got 3rd place in the Dropbox track and the judges really liked the "why you two connect" explanations. But they also grilled us on privacy, so we need to clean up the data story before we show anyone outside the team.

## This Week (Due by Fri 25 Sep)

### John
- [ ] **Automatic retry with backoff for failed model jobs** — `Tue 22 Sep`
    - Currently if Ollama hiccups or a request times out, the job just dies in the queue.
    - Need: 3 retries with exponential backoff (5s / 20s / 60s).
    - Make sure we don't double-insert aliases if a retry succeeds after a perceived failure.
    - *Ref: `worker/resolver.ts`, `queue/jobs.ts`*
- [ ] **One-page privacy summary for Diego** — `Fri 25 Sep`
    - Needed for the pilot meeting with the CS department on `Tue 29 Sep @ 14:00`.
    - Must cover: local inference only, no data leaves the GX10 box, session handling, and how we handle deletion requests.
    - Ask Mei to review the tone — it needs to sound reassuring but not corporate.

### Chen
- [ ] **Harden auth** — `Wed 23 Sep`
    - Session rotation on every request (or at least on privilege changes).
    - Rate limiting on `/auth/login` and `/auth/register` (currently wide open, bad look for a "secure" campus app).
    - Add a basic CSRF token check on state-changing endpoints.

### Noor
- [ ] **Human evaluation of 100 interest strings** — `Wed 23 Sep`
    - For the paper. We have the 99.1% auto-resolution stat, but we need human ground truth to back up the LLM adjudication quality.
    - Pick 100 random strings from the seed set, ideally a mix of:
        - Easy exact matches
        - Fuzzy matches (trigram stage)
        - Hard cases that hit the LLM
        - Junk strings (like "vacation photos")
    - I'll provide the CSV template.

### Jane + Mei
- [ ] **User study with 10 students** — `Thu 24 Sep` – `Sat 26 Sep`
    - Recruiting now. Need a mix of CS and non-CS majors.
    - Goal: see if people actually understand the "atlas" view or if they feel lost.
    - Mei to prep the task list; Jane to set up the test environment on `linkmit.duckdns.org` (make sure we have a clean test dataset, not the full 2,946 strings).

## Later / Nice-to-Haves

- [ ] **Small model for low-risk text** — *Noor/John*
    - We tested `qwen3 4B` on Mon 14 Sep. It was 3.6x faster but failed on 2/10 junk strings.
    - Keep `qwen3.8` for adjudication. Maybe use the 4B model for generating "icebreaker" conversation starters? Low stakes, so errors are less critical.
- [ ] **Batching improvements** — *Chen*
    - We batched embeddings (256) and it helped p95 drop to 0.9s. Can we do the same for adjudication? Probably not, since each request is unique, but worth thinking about if we scale up.
- [ ] **Mobile PWA support** — *Jane*
    - We cut the native app on `Tue 18 Aug`, but adding a manifest and service worker for offline-ish access might be easy? Low priority until we have more users.
- [ ] **Export data** — *Chen*
    - Users should be able to export their profile and connections as JSON/CSV. Good for privacy story ("you own your data").
- [ ] **Admin dashboard** — *Mei/Chen*
    - Basic view of active users, recent resolutions, error rates. Useful for debugging in the pilot.

## Notes / Context

- **Model Setup**: We are running `nomic-embed-text` and `qwen3.8` locally on the ASUS GX10 (128GB unified memory). Keep-warm heartbeat every 2 mins is critical — without it, reloads take ~46s for the big model.
- **Privacy**: Everything runs locally. No cloud APIs. This is a key selling point but also means our infra is fragile if the GX10 dies. Maybe document a fallback plan? (Cloud API as last resort?)
- **Paper**: Abstract due `Fri 25 Sep`, full submission `Fri 2 Oct`. Noor is leading, John is first author. Need to finalize the ablation study numbers (removing trigram stage) before writing up results.

*Let's sync on these in standup Monday. If anyone has capacity, grab an item and tag yourself.*
