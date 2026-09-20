# Risk Register — Link

_Last updated: Tue 8 Sep 2026 by Chen_
_First created: Thu 6 Aug 2026_

> **Note:** This is a living doc. If you spot a risk, add it below and ping me in Slack so I can assign an owner/status. We have 4 days until the hackathon weekend (Sat 12 Sep), so prioritize anything marked 🔴 HIGH.

---

## 1. Unauthenticated import endpoints
- **Likelihood:** High
- **Impact:** High (data integrity, potential DoS)
- **Description:** The `/api/import/interests` and `/api/import/profile` endpoints currently accept POST requests without verifying session tokens. Any user could spam the job queue or inject malicious interest strings that bypass the resolution pipeline.
- **Mitigation:** 
  - [ ] Add `Authorization: Bearer <token>` check to all write endpoints (Chen, due Wed 23 Sep — *post-hackathon*)
  - [ ] Interim fix: rate-limit `/api/import/*` to 10 req/min per IP via nginx config (Chen, **due Fri 12 Sep**)
- **Owner:** Chen
- **Status:** 🟡 OPEN (interim fix planned)

## 2. Failed model jobs don’t auto-retry
- **Likelihood:** Medium
- **Impact:** Medium (user sees "resolution failed" errors; manual re-trigger required)
- **Description:** If Ollama times out or returns a 500, the job is marked `failed` in Postgres. No retry logic exists. Users must click "retry" manually, which is confusing during demo.
- **Mitigation:** 
  - [ ] Implement exponential backoff retry: 5s → 20s → 60s (John, due Tue 22 Sep)
  - [ ] Add `retry_count` column to `jobs` table (Chen, schema migration ready)
- **Owner:** John
- **Status:** 🟡 OPEN

## 3. GPU shared with background worker
- **Likelihood:** Medium
- **Impact:** High (p95 latency spikes during batch imports)
- **Description:** The Ollama process on the GX10 box serves both interactive adjudication requests AND the background interest-resolution worker. When a large import batch runs, interactive requests queue behind it, causing 4–8s delays. We saw this during load testing on Mon 7 Sep.
- **Mitigation:** 
  - [ ] Cap worker concurrency to 1 (already done)
  - [ ] Add priority flag: `interactive` jobs get scheduled before `batch` jobs in the queue poller (Chen, due Fri 12 Sep)
  - [ ] Consider splitting Ollama instances if latency remains >1.5s p95 (John + Chen, decide by Thu 11 Sep)
- **Owner:** Chen
- **Status:** 🟡 OPEN

## 4. Model swap regressions
- **Likelihood:** Low
- **Impact:** High (adjudication quality drops; junk strings accepted)
- **Description:** We switched from qwen2.5-14b to qwen3.8 on Thu 27 Aug. If we need to roll back or try another model, adjudication behavior changes unpredictably. The 4B small-model test (planned for Mon 14 Sep) could introduce new failure modes.
- **Mitigation:** 
  - [ ] Keep qwen3.8 as default; document rollback procedure in `docs/ops.md` (John, due Fri 12 Sep)
  - [ ] Pin Ollama model versions in Docker Compose (Chen, done)
  - [ ] Run the 40-case adjudication test suite before any model change (Noor, script ready)
- **Owner:** John
- **Status: 🟢 MITIGATED**

## 5. Single API replica
- **Likelihood:** Low
- **Impact:** High (full outage if Node process crashes)
- **Description:** We run one Node.js API instance behind nginx. If it crashes (OOM, unhandled exception), all users lose access. No health-check auto-restart is configured in Docker Compose.
- **Mitigation:** 
  - [ ] Add `restart: unless-stopped` to `api` service (Chen, done)
  - [ ] Add `/healthz` endpoint and nginx health checks (Chen, due Fri 12 Sep)
  - [ ] Monitor memory usage; alert if >80% of 4GB limit (Chen, due Fri 12 Sep)
- **Owner:** Chen
- **Status: 🟡 OPEN**

## 6. Plaintext messages
- **Likelihood:** High (by design, currently)
- **Impact:** Medium (privacy concern; judges asked about this in prep meetings)
- **Description:** Request/accept messaging (D4) stores message bodies in Postgres as plaintext. No encryption at rest or in transit beyond TLS. Diego flagged this as a privacy risk.
- **Mitigation:** 
  - [ ] Document that messages are only visible to sender + recipient (Mei, copy for UI tooltips)
  - [ ] Add `encrypted_at` column and AES-256-GCM encryption for message bodies (Chen, due Wed 23 Sep — *post-hackathon*)
  - [ ] For hackathon: add prominent "Private" badge next to messages (Jane, done)
- **Owner:** Chen
- **Status:** 🟡 OPEN (interim UX fix in place)

---

## Escalation
If any 🔴 HIGH risk becomes active during the hackathon weekend (Sat 12 – Sun 13 Sep), ping Chen + John immediately. We have a fallback: disable background imports and rate-limit hard to 5 req/min if latency exceeds 2s p95.
