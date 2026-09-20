// The three workspaces in John Doe's story and every file in them. `brief` says
// what the file must contain; the generator writes the text, the loader stores
// it as a normal collaborative text file.

export interface FileDef {
  path: string; // folders are created from the path
  author: string; // key in CAST
  createdDay: number; // days before STORY_END
  updatedDay: number;
  brief: string;
}

export interface WorkspaceDef {
  slug: string;
  name: string;
  owner: string;
  members: string[]; // besides the owner
  createdDay: number;
  files: FileDef[];
}

export const WORKSPACES: WorkspaceDef[] = [
  {
    slug: "link-hackathon",
    name: "Link — Hackathon",
    owner: "john",
    members: ["jane", "chen", "noor", "mei"],
    createdDay: 68,
    files: [
      { path: "README.md", author: "john", createdDay: 68, updatedDay: 6, brief: "Project README: what Link is, the team and roles, how to run it (docker compose), where docs live, current status (3rd place Dropbox track on 13 Sep; now moving toward a pilot), links to docs/ and meetings/." },
      { path: "docs/architecture.md", author: "john", createdDay: 60, updatedDay: 12, brief: "Architecture: data model (actor, concept, alias, actor_concept, edge, intro, message), the four-stage resolution pipeline with thresholds, job queue and worker, scoring, local AI (Ollama, qwen3.8, nomic-embed-text), deployment behind nginx. Include a small ASCII diagram." },
      { path: "docs/decisions.md", author: "john", createdDay: 47, updatedDay: 9, brief: "ADR-style decision log for D1–D9 and the small-model test: each with date, context, decision, consequences, and who argued what. Use exactly the dates from the bible." },
      { path: "docs/progress.md", author: "john", createdDay: 60, updatedDay: 3, brief: "Weekly progress log from week 1 (14 Jul) to now: what shipped each week, blockers, and a final 'Where we are now' section listing the open items with owners and due dates from the bible. This is the file people read to learn the current status." },
      { path: "docs/api.md", author: "chen", createdDay: 52, updatedDay: 14, brief: "API reference: /auth/*, /actors/me, /actors/me/suggestions, /search/aspirations, /me/imports, /conversations, /workspaces (brief), status codes and the session cookie. Keep it realistic and compact." },
      { path: "docs/design-system.md", author: "mei", createdDay: 56, updatedDay: 14, brief: "Design system: turquoise tokens (600 accent text, 500 lines, 300, 100 wash, 050 hover), ink scale, Inter, type scale, spacing, motion rules (reduced motion), the atlas visual language (soft regions, glass people, Link emblem), do/don't list." },
      { path: "docs/demo-script.md", author: "mei", createdDay: 13, updatedDay: 8, brief: "The 5-minute demo script after the D9 pivot: open on one person's 'why you connect', then zoom out to the atlas, then search, then the privacy answer. Include timings per section and who speaks." },
      { path: "docs/pitch-outline.md", author: "mei", createdDay: 20, updatedDay: 9, brief: "Pitch outline / deck storyline: eight slides with one line each, the 'problem' framing, the one metric to quote (99.1% resolved without a human), the privacy slide." },
      { path: "docs/risks.md", author: "chen", createdDay: 45, updatedDay: 12, brief: "Risk register: unauthenticated import endpoints, failed jobs don't auto-retry, GPU shared with the worker, model swap regressions, single API replica, plaintext messages. Each with likelihood, impact, mitigation, owner, status." },
      { path: "tasks/backlog.md", author: "john", createdDay: 40, updatedDay: 2, brief: "Backlog after the hackathon, grouped by owner with due dates from the bible: John retry/backoff (Tue 22 Sep), Chen auth hardening (Wed 23 Sep), Noor human eval (Wed 23 Sep), Jane+Mei user study (24–26 Sep), John privacy one-pager (Fri 25 Sep), pilot meeting Tue 29 Sep; plus a longer 'later' list." },
      { path: "tasks/done.md", author: "john", createdDay: 40, updatedDay: 5, brief: "Completed work log with dates: schema, auth, imports, resolution pipeline, worker, HTTPS, atlas, particles/emblem, messaging, workspaces, latency fix, model upgrade." },
      { path: "meetings/2026-07-14-kickoff.md", author: "john", createdDay: 68, updatedDay: 68, brief: "Kickoff meeting notes, Tue 14 Jul 9 pm: attendees (all five), goals, roles, working agreements (Tue/Thu 9 pm standups, small PRs), first-week tasks." },
      { path: "meetings/2026-07-28-architecture.md", author: "john", createdDay: 54, updatedDay: 54, brief: "Notes from Tue 28 Jul: the resolution pipeline design (D2), the argument about thresholds, action items with owners." },
      { path: "meetings/2026-08-18-scope-cut.md", author: "john", createdDay: 33, updatedDay: 33, brief: "Notes from Tue 18 Aug: the scope cut (D5) — dropping the mobile app and calendar integration; Jane's concerns; what stays; new priorities." },
      { path: "meetings/2026-08-26-latency.md", author: "chen", createdDay: 25, updatedDay: 25, brief: "Notes from Wed 26 Aug: the latency blocker (p95 4.2 s), root cause (idle model unload, unbatched embeddings), fix plan (keep-warm heartbeat every 2 minutes, batch 256, concurrency 2), measurements after the fix (p95 0.9 s on Mon 31 Aug)." },
      { path: "meetings/2026-09-02-design-review.md", author: "mei", createdDay: 18, updatedDay: 18, brief: "Notes from Wed 2 Sep: design review of the atlas (D8), turquoise theme, wobbly boundaries, particles, the emblem, accessibility." },
      { path: "meetings/2026-09-09-freeze.md", author: "john", createdDay: 11, updatedDay: 11, brief: "Notes from Wed 9 Sep: demo flow pivot (D9), code freeze Thu 10 Sep 6 pm, rehearsal schedule, who covers what if someone is sick." },
      { path: "meetings/2026-09-15-retro.md", author: "john", createdDay: 5, updatedDay: 5, brief: "Retro notes from Tue 15 Sep: went well / didn't / actions, judges' feedback (explanations praised, privacy questions), the plan for a user study and the pilot." },
      { path: "meetings/2026-09-18-pilot-planning.md", author: "john", createdDay: 2, updatedDay: 2, brief: "Notes from Fri 18 Sep with Diego: pilot with one course (~60 students), meeting with the CS department Tue 29 Sep 2 pm, privacy one-pager owed by Fri 25 Sep, success metrics." },
      { path: "src/resolution.ts", author: "john", createdDay: 55, updatedDay: 20, brief: "A TypeScript excerpt of resolveRawText: exact alias, trigram fuzzy >=0.6, embedding kNN, adjudication among top-5, propose only if 5+ chars, alias caching. Around 90 lines with comments." },
      { path: "src/scoring.ts", author: "noor", createdDay: 50, updatedDay: 17, brief: "A TypeScript excerpt of scoreCandidates: idf-weighted shared concepts, hop decay constant HOP_DECAY = 0.15 with a comment about tuning from 0.5, connected penalty, reasons capped at 3. Around 70 lines." },
      { path: "bench/adjudication_benchmark.py", author: "noor", createdDay: 8, updatedDay: 6, brief: "A Python script that replays adjudication decisions through two models (qwen3.8 and a 4B model) and prints agreement, junk rejection and latency percentiles; includes the results from the bible as a comment at the bottom." },
      { path: "web/InterestCanvas.sketch.tsx", author: "jane", createdDay: 26, updatedDay: 14, brief: "A React/TSX sketch of the atlas canvas: an SVG with region paths and person circles, requestAnimationFrame loop only while dragging, prefers-reduced-motion respected. About 80 lines with comments." },
    ],
  },
  {
    slug: "resolution-paper",
    name: "Paper — Small local models for interest resolution",
    owner: "sofia",
    members: ["john", "noor"],
    createdDay: 48,
    files: [
      { path: "README.md", author: "sofia", createdDay: 48, updatedDay: 4, brief: "Workspace README: paper title, authors and order, target workshop, deadlines (abstract Fri 25 Sep, full submission Fri 2 Oct, draft to Sofia Mon 28 Sep), where things live." },
      { path: "outline.md", author: "john", createdDay: 47, updatedDay: 20, brief: "Paper outline with section headings and a bullet plan for each (intro, related work, method, experiments, results, ethics, limitations), marking which sections are drafted." },
      { path: "todo.md", author: "sofia", createdDay: 34, updatedDay: 1, brief: "Checklist with owners and dates: human evaluation of 100 strings (Noor, Wed 23 Sep), trigram ablation numbers (John, before Thursday), related work (John), pipeline figure (Mei), abstract Fri 25 Sep, full draft Mon 28 Sep, submit Fri 2 Oct. Mark done items." },
      { path: "method.md", author: "john", createdDay: 30, updatedDay: 10, brief: "Method section draft: the four-stage pipeline, thresholds (0.6 trigram, 0.92 accept, 0.60 adjudication floor), adjudication prompt with verdicts (same/narrower/broader/unrelated/unsure) and choice index, alias caching, junk guards (minimum length 5)." },
      { path: "related-work.md", author: "john", createdDay: 14, updatedDay: 6, brief: "A rough, incomplete related-work section with bullet notes about entity linking, ontology matching, LLM-based normalisation and privacy-preserving local models, with TODO markers where citations are missing (no fake citation details: use placeholders like [cite: entity linking survey])." },
      { path: "references.md", author: "noor", createdDay: 30, updatedDay: 8, brief: "A list of reference placeholders and reading notes (titles described in general terms, marked 'to verify'), including the Computer Science Ontology." },
      { path: "experiments/log.md", author: "noor", createdDay: 30, updatedDay: 3, brief: "Dated experiment log: baseline exact+fuzzy only, adding embeddings, adding adjudication, model comparison (qwen2.5-14b, qwen3.8, qwen3 4B), the small-model benchmark of 14 Sep, notes on the 0.92 threshold never firing." },
      { path: "experiments/results.md", author: "noor", createdDay: 10, updatedDay: 3, brief: "Results tables in markdown: resolution by stage (99.1% of 2,946 resolved automatically; 3.6% reached the LLM), model comparison table (qwen3.8 39/40 agreement, 10/10 junk rejected, 1.8 s median; 4B 37/40, 8/10 junk rejected, 0.5 s), and TODO rows for the trigram ablation and human evaluation." },
      { path: "draft/abstract.md", author: "john", createdDay: 6, updatedDay: 2, brief: "A 150-word abstract draft with a TODO comment noting the human-evaluation number is pending." },
      { path: "draft/introduction.md", author: "john", createdDay: 12, updatedDay: 5, brief: "Introduction draft (about 400 words): problem of matching people on messy self-described interests, why a local model, contributions list. Include Sofia's inline comments in brackets asking to shorten it." },
      { path: "draft/evaluation.md", author: "noor", createdDay: 8, updatedDay: 3, brief: "Evaluation section draft: datasets (synthetic 2,946 strings, planted cases), metrics, baselines, results discussion, threats to validity (synthetic data only; asks for real pilot strings)." },
      { path: "review/sofia-feedback-v1.md", author: "sofia", createdDay: 10, updatedDay: 10, brief: "Sofia's written feedback on draft v1: bullet points on structure, tone ('tone down novel'), the pipeline figure placement, evaluation concerns, ethics for the user study, and a prioritised list of what to fix by when." },
    ],
  },
  {
    slug: "cs431-raft",
    name: "CS 431 — Raft KV store",
    owner: "nina",
    members: ["john", "amara"],
    createdDay: 55,
    files: [
      { path: "README.md", author: "nina", createdDay: 55, updatedDay: 2, brief: "Project README: goal (Raft-based key-value store in Go), team and roles, how to build/test, milestone dates (Milestone 3 due Wed 30 Sep, final report + demo Fri 9 Oct)." },
      { path: "design.md", author: "nina", createdDay: 45, updatedDay: 9, brief: "Design doc: architecture, RPCs (RequestVote, AppendEntries, InstallSnapshot), persistent vs volatile state, election timeout 150–300 ms randomised, log replication rules, snapshot every 1000 entries, client interface with request IDs for exactly-once semantics." },
      { path: "milestones.md", author: "nina", createdDay: 40, updatedDay: 2, brief: "Milestone tracker with status: M1 leader election (done), M2 log replication (done), M3 snapshotting + linearizability tests (due Wed 30 Sep, in progress), final (Fri 9 Oct). Per-milestone owners." },
      { path: "test-plan.md", author: "amara", createdDay: 30, updatedDay: 8, brief: "Test plan: unit tests, fault injector (drop/delay/partition/kill), linearizability checker with recorded histories, chaos scenarios list, pass criteria, known flaky test and the deterministic-clock fix." },
      { path: "notes/leader-election-bug.md", author: "nina", createdDay: 36, updatedDay: 33, brief: "Postmortem of the split-vote bug after partition heal: symptom, reproduction with the fault injector, root cause (fixed timeouts and not resetting on valid AppendEntries), fix (randomised 150–300 ms), lessons." },
      { path: "notes/grading-notes.md", author: "nina", createdDay: 50, updatedDay: 20, brief: "Notes from the course rubric and TA office hours: what graders check (correctness under partition, snapshot handling, report quality), a checklist for the final report, points breakdown." },
      { path: "src/raft.go", author: "john", createdDay: 40, updatedDay: 6, brief: "A Go excerpt of the Raft node: struct with persistent and volatile state, AppendEntries handler with prevLogIndex/prevLogTerm check, conflict truncation, commitIndex advance, lastApplied tracking (the double-apply bugfix). About 100 lines." },
      { path: "src/kv.go", author: "amara", createdDay: 35, updatedDay: 12, brief: "A Go excerpt of the KV state machine: Put/Get/Delete apply, per-client request-ID dedupe table, and the stale-read fix from the linearizability checker. About 70 lines." },
      { path: "src/snapshot.go", author: "nina", createdDay: 17, updatedDay: 2, brief: "A partial Go excerpt of snapshotting: snapshot trigger every 1000 entries, InstallSnapshot RPC handler stubbed with TODO comments for John's part (owed before Milestone 3)." },
    ],
  },
];
