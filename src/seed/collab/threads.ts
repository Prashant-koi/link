// The one-to-one conversations in John Doe's story. Each segment is a burst of
// messages on a given day (day = days before STORY_END). The generator expands
// the brief into `n` messages; the loader turns gaps into timestamps.

export interface Segment {
  id: string;
  day: number;
  hour: number; // local hour the burst starts (0-23)
  spanHours: number; // roughly how long the burst lasts
  n: number; // target number of messages
  brief: string;
}

export interface ThreadDef {
  other: string; // key in CAST
  opener: "john" | "other";
  segments: Segment[];
  /** How many of the newest messages from the other person John hasn't read. */
  unread?: number;
}

export const THREADS: ThreadDef[] = [
  {
    other: "jane",
    opener: "john",
    unread: 2,
    segments: [
      { id: "j01", day: 68, hour: 21, spanHours: 2, n: 18, brief: "John (first ever message in this chat) invites Jane to join his hackathon team for Link. Explains the idea (surface connections between university members via a concept graph). Jane is excited, asks about stack and what she'd own (frontend). She mentions she's done React for two internships. They agree on a kickoff call Tue 14 Jul at 9 pm with Chen, Noor and Mei." },
      { id: "j02", day: 61, hour: 20, spanHours: 3, n: 16, brief: "Stack agreement: Vite + React 18, plain CSS with design tokens instead of Tailwind, no component library. Jane wants a UI kit, John argues tokens keep it consistent with Mei's design. They sketch routes: Home, Import, View, Search, Settings. Jane asks how auth will work." },
      { id: "j03", day: 54, hour: 22, spanHours: 3, n: 18, brief: "Search page: 'aspiration search' (type what you want to learn, get people who have done it / are figuring it out / considering the same). John explains it only uses fast exact/fuzzy resolution on reads and never blocks on the model. Jane builds it, asks about the API response shape and grouping by stance. Discuss that a brand-new phrase needs a retry because the worker resolves it in the background." },
      { id: "j04", day: 47, hour: 19, spanHours: 3, n: 16, brief: "The person panel and 'Send a message' button. Cookie bug: the session cookie wasn't attaching through the tunnel because of SameSite. John explains same-origin serving fixes it. Jane asks what happens on message; John says request/accept (decision D4 came a week earlier)." },
      { id: "j05", day: 40, hour: 21, spanHours: 2, n: 14, brief: "Login page and demo accounts (john.doe, jane.doe). Chen has HTTPS working on linkmit.duckdns.org; Jane checks it on her phone and gets a certificate warning at first. Jane wants password autofill to work." },
      { id: "j06", day: 33, hour: 20, spanHours: 3, n: 14, brief: "The scope cut (D5, decided Tue 18 Aug): no native mobile app, no calendar integration. Jane is disappointed because she had started a React Native prototype; John acknowledges the work and promises the responsive web layout will carry it. She agrees, asks to keep the prototype in a branch." },
      { id: "j07", day: 26, hour: 23, spanHours: 4, n: 16, brief: "Atlas prototype (D8 decided 1 Sep, so this is Jane starting from Mei's sketch): interests as soft regions, people as spheres. Jane's first canvas prototype is choppy; it runs 55fps in Chrome but janks in Firefox. They discuss SVG vs canvas and settle on SVG with requestAnimationFrame only while dragging." },
      { id: "j08", day: 19, hour: 20, spanHours: 3, n: 14, brief: "Wobbly boundaries around each interest and floating particles in the background; Mei wants the turquoise theme. Jane worries about performance of the particles; John suggests a single fixed canvas that pauses when the tab is hidden and respects reduced motion." },
      { id: "j09", day: 13, hour: 21, spanHours: 3, n: 16, brief: "Demo flow pivot (D9, Wed 9 Sep): start the demo on one person's 'why you connect' explanation, then zoom out to the atlas. Jane rehearses her part; they plan the code freeze for Thu 10 Sep 6 pm and argue lightly about whether to add one more feature." },
      { id: "j10", day: 8, hour: 1, spanHours: 12, n: 18, brief: "Hackathon night (Sat 12 Sep into Sunday morning): bursts of late-night chat, a last-minute bug where names overflow on the phone layout, food runs, a panic when the demo laptop's Wi-Fi drops, then demo at noon. Ends with them hearing the result later: 3rd place in the Dropbox track." },
      { id: "j11", day: 5, hour: 20, spanHours: 2, n: 12, brief: "Retro (Tue 15 Sep): what went well (the atlas, explanations), what didn't (late scope debates, mobile detour). Jane suggests a user study with real students; John agrees, she and Mei will run it Thu 24 – Sat 26 Sep with 10 students." },
      { id: "j12", day: 1, hour: 19, spanHours: 2, n: 10, brief: "Recent: recruiting study participants (she has 6 so far), a consent form draft Mei wrote, and John promising the retry-with-backoff feature by Tue so the study doesn't hit failed jobs. Ends with Jane's last two messages (unread by John): a question about whether test accounts can be reset, and a friendly nudge." },
    ],
  },
  {
    other: "chen",
    opener: "john",
    unread: 1,
    segments: [
      { id: "c01", day: 68, hour: 22, spanHours: 2, n: 14, brief: "First messages. John asks Chen to handle backend and infra; Chen agrees, asks about the deadline and hardware. John mentions the GX10 box (128 GB unified memory) for local models. Set up the repo, branches, and the rule of small PRs." },
      { id: "c02", day: 60, hour: 23, spanHours: 3, n: 16, brief: "Decision D1 (settled Tue 21 Jul): Postgres + pgvector vs Neo4j. Chen argues for one datastore and recursive CTEs; John is convinced; Jane wanted Neo4j but has accepted. Chen sketches the schema for actor, concept, concept_relation, actor_concept." },
      { id: "c03", day: 52, hour: 22, spanHours: 3, n: 14, brief: "Schema and migrations: numbered SQL migrations, a graph_version trigger for cache invalidation, materialized view for concept idf. Chen and John argue about UUIDs vs bigints (UUIDs win). A migration numbering collision between two of them gets sorted out." },
      { id: "c04", day: 45, hour: 23, spanHours: 3, n: 14, brief: "Auth design: server-side sessions with a signed cookie instead of JWTs (revocable with one UPDATE), demo mode where passwords are derived from names, a mode gate that refuses to start in production with demo auth. 10 attempts / 15 minutes rate limit on login." },
      { id: "c05", day: 38, hour: 22, spanHours: 4, n: 14, brief: "Docker Compose and nginx: nginx-certbot image, DuckDNS domain linkmit.duckdns.org, the first certificate attempt failed because ports 80/443 weren't forwarded at the venue network; they use a self-signed cert as a stopgap. Chen enables restart: unless-stopped so it survives reboots." },
      { id: "c06", day: 31, hour: 23, spanHours: 3, n: 14, brief: "Job queue and worker: Postgres-backed queue with FOR UPDATE SKIP LOCKED, separate worker container using host networking to reach Ollama, needs_review vs failed job states. A gap: failed jobs don't retry automatically (John notes it for later)." },
      { id: "c07", day: 27, hour: 22, spanHours: 4, n: 14, brief: "Latency blocker (found Wed 26 Aug): p95 was 4.2 s. Chen digs into logs, finds Ollama unloading idle models; reload ~46 s for the big model. Plan: a keep-warm heartbeat every 2 minutes via native /api/generate, batch embeddings to 256, instruct concurrency 2. They measure p95 0.9 s by Mon 31 Aug." },
      { id: "c08", day: 20, hour: 21, spanHours: 3, n: 12, brief: "Imports: resume PDF (unpdf), LinkedIn text, GitHub repos, simulated course import; the endpoints are unauthenticated by design because onboarding happens before a session exists — Chen flags it as a risk and they note it for hardening." },
      { id: "c09", day: 12, hour: 22, spanHours: 3, n: 12, brief: "Hardening list before the freeze: rate limits, request size caps (12 MB JSON limit and nginx 16 MB), health checks, logs. Chen wants staging; there's no time. They agree on a checklist." },
      { id: "c10", day: 8, hour: 3, spanHours: 10, n: 14, brief: "Hackathon night infra: Chen watches logs while people demo, a scare when the worker container restarts, the box's disk fills with Docker layers and he prunes it; everything holds through the demo." },
      { id: "c11", day: 3, hour: 21, spanHours: 2, n: 10, brief: "Post-mortem and TODO: Chen will harden auth (session rotation, rate limits on /auth) by Wed 23 Sep; John will add retry with backoff for failed jobs by Tue 22 Sep. Chen's last message (unread by John): a reminder he'll open the PR tonight." },
    ],
  },
  {
    other: "noor",
    opener: "john",
    segments: [
      { id: "n01", day: 67, hour: 20, spanHours: 3, n: 12, brief: "Noor joins as data/ML lead. They discuss the Computer Science Ontology (CSO) and take a subset of ~600 concepts; how to represent broader/narrower relations; aliases for messy strings." },
      { id: "n02", day: 59, hour: 21, spanHours: 3, n: 14, brief: "Decision D2 (Tue 28 Jul): the four-stage resolution pipeline (exact -> trigram >=0.6 -> embedding kNN -> LLM adjudication -> propose new concept only if 5+ chars). Noor worries about the LLM minting junk concepts; they add guards." },
      { id: "n03", day: 51, hour: 22, spanHours: 3, n: 12, brief: "Scoring: rarity-weighted overlap using idf, hop decay for related concepts, penalties. Noor builds an evaluation with planted 'hero pairs'. Discussion of why common concepts like 'machine learning' shouldn't dominate." },
      { id: "n04", day: 43, hour: 20, spanHours: 3, n: 12, brief: "Seed data: a synthetic people generator with cohorts and departments, ~300 people, contexts (courses, clubs, labs), planted cases (hero pair, synonym pair, decoy). Noor insists every gate is verified against the doc's pass conditions. John says they must not hide failed jobs." },
      { id: "n05", day: 35, hour: 21, spanHours: 3, n: 12, brief: "Noor finds the embedding auto-accept threshold 0.92 never fires with nomic-embed-text; nearest neighbours mostly land 0.6–0.85, so adjudication does the work. They lower the adjudication floor from 0.75 to 0.60 and add trigram near-misses as candidates." },
      { id: "n06", day: 29, hour: 22, spanHours: 3, n: 12, brief: "Embedding model choice: nomic-embed-text (768-d) with search_query/search_document prefixes. They compare a bigger model, decide it isn't worth the memory. Discussion of pgvector index vs sequential scan at this size (sequential scan is fine)." },
      { id: "n07", day: 22, hour: 21, spanHours: 3, n: 12, brief: "Model upgrade D7 (Thu 27 Aug): qwen2.5-14b to qwen3.8. Noor's evaluation shows fewer wrong adjudications; the thinking-model quirk means empty output unless reasoning_effort is none. Noor asks about junk concepts minted earlier; John cleaned 17." },
      { id: "n08", day: 15, hour: 20, spanHours: 3, n: 10, brief: "Small-model benchmark (Mon 14 Sep): qwen3 4B instruct 3.6x faster (0.5 s vs 1.8 s), agrees on 37/40 but accepts 2 of 10 junk strings; qwen3.8 rejects 10/10. Noor and John decide to keep qwen3.8 for adjudication and record this for the paper." },
      { id: "n09", day: 8, hour: 21, spanHours: 3, n: 12, brief: "Paper experiments plan with Prof. Petrov: measure how often each pipeline stage resolves (99.1% of 2,946 strings resolved without a human; 3.6% reach the LLM), ablations, and a human evaluation of 100 strings which Noor will do by Wed 23 Sep." },
      { id: "n10", day: 3, hour: 22, spanHours: 3, n: 10, brief: "Results tables and the abstract draft (due Fri 25 Sep). Noor is worried about the related-work section and the missing trigram-ablation. They split writing: John does method/eval, Noor the experiments section and tables." },
    ],
  },
  {
    other: "mei",
    opener: "john",
    segments: [
      { id: "m01", day: 66, hour: 19, spanHours: 2, n: 12, brief: "Mei joins for design. Visual identity: quiet, editorial, lots of white space, a single accent. She asks who the users are (students, staff, alumni) and how a connection should feel." },
      { id: "m02", day: 56, hour: 20, spanHours: 2, n: 10, brief: "Design tokens: turquoise accent (600 for text/links, 500 for lines, 100 for washes), ink scale for text, Inter font, small type scale from 12 to 28 px. Mei explains contrast ratios (4.9:1 for the accent on white)." },
      { id: "m03", day: 46, hour: 18, spanHours: 2, n: 10, brief: "Why-you-connect explanations: Mei wants the reason shown in plain language, always first. They agree each reason has a template sentence and optional model-written prose." },
      { id: "m04", day: 36, hour: 20, spanHours: 2, n: 10, brief: "Onboarding: upload resume / LinkedIn / GitHub / courses; how to show progress while the worker resolves interests; Mei worries people feel judged by 'unmapped' interests and suggests softer wording." },
      { id: "m05", day: 24, hour: 21, spanHours: 3, n: 12, brief: "Atlas sketch (D8, 1 Sep): Mei's hand sketch of interests as soft overlapping regions with people inside; the debate about colours for overlapping regions (multiply blending, five hues) versus keeping everything turquoise." },
      { id: "m06", day: 14, hour: 20, spanHours: 2, n: 12, brief: "Polish: floating particle background, a link-shaped emblem for the viewer, turquoise glass for people. Mei approves particles if they're tiny and quiet." },
      { id: "m07", day: 7, hour: 22, spanHours: 2, n: 10, brief: "Demo deck: eight slides, Mei's storyline (start with one person's explanation), her request for real screenshots, timing (5 minutes)." },
      { id: "m08", day: 2, hour: 20, spanHours: 2, n: 8, brief: "Study prep: the consent form draft, a short interview script, incentives (coffee cards). Mei and Jane will run the study Thu 24 – Sat 26 Sep." },
    ],
  },
  {
    other: "sofia",
    opener: "john",
    segments: [
      { id: "s01", day: 64, hour: 11, spanHours: 4, n: 8, brief: "Formal first message: John asks Prof. Petrov to advise a possible workshop paper about Link's interest resolution. She asks for a one-page summary and says she has time on Thursdays." },
      { id: "s02", day: 48, hour: 10, spanHours: 4, n: 8, brief: "Paper idea sharpened: 'small local language models for resolving free-text interests to an ontology' — she likes the cost/privacy angle, asks about evaluation and baselines." },
      { id: "s03", day: 34, hour: 15, spanHours: 3, n: 8, brief: "Feedback on the outline: she wants a clear research question, a baseline without the LLM, and a human evaluation. Suggests a NLP-for-education workshop with a deadline of Fri 2 Oct (abstract Fri 25 Sep)." },
      { id: "s04", day: 20, hour: 9, spanHours: 5, n: 10, brief: "Reviewing experiments: the pipeline-stage breakdown, the qwen3.8 vs 4B result, her concern about evaluating only on synthetic strings; asks for real strings from the pilot." },
      { id: "s05", day: 10, hour: 16, spanHours: 3, n: 8, brief: "Draft v1 feedback: introduction is too long, the pipeline figure needs to be in section 3, tone down 'novel'. She asks about ethics approval for the user study (John says the department told them a short consent form is enough)." },
      { id: "s06", day: 4, hour: 10, spanHours: 4, n: 10, brief: "Deadline plan: abstract Fri 25 Sep, full draft to her by Mon 28 Sep, submit Fri 2 Oct. She asks Noor to finish the human evaluation first." },
      { id: "s07", day: 1, hour: 14, spanHours: 2, n: 6, brief: "Short recent exchange: she confirms Thursday's meeting, asks John to send the trigram-ablation numbers before it. Her last message is unread by John." },
    ],
    unread: 1,
  },
  {
    other: "diego",
    opener: "john",
    segments: [
      { id: "d01", day: 62, hour: 13, spanHours: 3, n: 8, brief: "John introduces the project to Diego (staff mentor). Diego offers to help with department IT and privacy questions, warns that student data policy (FERPA) matters." },
      { id: "d02", day: 42, hour: 14, spanHours: 3, n: 8, brief: "Privacy: Diego asks where the data lives and whether any cloud AI sees it. John explains it's a local model on a box in the lab, request/accept messaging, and visibility controls per interest. Diego is reassured but wants a one-page summary eventually." },
      { id: "d03", day: 28, hour: 12, spanHours: 3, n: 8, brief: "Hackathon logistics: registration, the Dropbox track rules, a table at the venue, wifi warnings. Diego lends a spare monitor." },
      { id: "d04", day: 16, hour: 17, spanHours: 3, n: 8, brief: "Practice pitch: Diego watched a run-through, said the explanations are the strongest part, cut the architecture slide, prepare for questions on privacy." },
      { id: "d05", day: 7, hour: 19, spanHours: 2, n: 8, brief: "Results: 3rd place in the Dropbox track. Diego congratulates them, says the CS chair heard about it." },
      { id: "d06", day: 3, hour: 11, spanHours: 3, n: 10, brief: "Pilot plan: a meeting with the CS department Tue 29 Sep at 2 pm. Diego needs a one-page privacy summary from John by Fri 25 Sep, and suggests a pilot with one course (about 60 students)." },
    ],
  },
  {
    other: "nina",
    opener: "other",
    segments: [
      { id: "p01", day: 55, hour: 18, spanHours: 2, n: 12, brief: "Nina messages first: CS 431 Raft key-value store in Go, she's forming a team, asks John and Amara. Roles: Nina leader election + design doc, John log replication, Amara tests and fault injection. First milestone dates." },
      { id: "p02", day: 45, hour: 19, spanHours: 2, n: 12, brief: "Design doc: Nina's outline, the RPC layout (RequestVote, AppendEntries), the storage interface, state machine. John has opinions about batching AppendEntries; Nina wants to get correctness first." },
      { id: "p03", day: 36, hour: 21, spanHours: 3, n: 12, brief: "Leader election bug: split votes after a partition heals, cluster keeps re-electing. Fix: randomised election timeouts 150–300 ms, and reset the timer on a valid AppendEntries. Amara reproduces it with the fault injector." },
      { id: "p04", day: 26, hour: 20, spanHours: 3, n: 12, brief: "Log replication (John's part): consistency check with prevLogIndex/prevLogTerm, conflicting entries, commitIndex advance. A bug where a follower applies entries twice; John fixes with lastApplied tracking." },
      { id: "p05", day: 17, hour: 21, spanHours: 2, n: 12, brief: "Snapshotting: Nina proposes snapshots every 1000 entries, InstallSnapshot RPC; they debate whether to do it before Milestone 3. They decide yes because tests need it." },
      { id: "p06", day: 8, hour: 12, spanHours: 2, n: 10, brief: "John is busy with the hackathon so Nina lays out the test plan: linearizability checker, kill/restart, partition tests; John apologises and promises to catch up." },
      { id: "p07", day: 2, hour: 20, spanHours: 2, n: 10, brief: "Recent: Milestone 3 due Wed 30 Sep, final report + demo Fri 9 Oct. Nina posts a checklist; John owes InstallSnapshot handling. Her last message (unread by John) is a reminder to update the design doc." },
    ],
    unread: 1,
  },
  {
    other: "amara",
    opener: "other",
    segments: [
      { id: "a01", day: 50, hour: 17, spanHours: 2, n: 8, brief: "Amara says hi, she's joining the Raft team for tests; asks John how he wants the fault injector (drop, delay, partition, kill). They agree on a simple wrapper around the RPC layer." },
      { id: "a02", day: 30, hour: 18, spanHours: 2, n: 8, brief: "Amara's linearizability checker: a history-recording client and a checker based on Wing & Gong; she finds a stale-read bug in the KV layer that John fixes." },
      { id: "a03", day: 15, hour: 19, spanHours: 2, n: 8, brief: "Test flakiness: a test that fails 1 in 20 runs due to timing; Amara adds a deterministic clock; jokes about 'works on my machine'." },
      { id: "a04", day: 6, hour: 21, spanHours: 2, n: 8, brief: "After the hackathon: Amara congratulates John, asks if he'll have time for snapshot tests; schedules a pairing session Wed 23 Sep at 6 pm." },
      { id: "a05", day: 1, hour: 22, spanHours: 1, n: 6, brief: "Recent: quick logistics for Wed's pairing, a joke about caffeine; her final message is unread by John." },
    ],
    unread: 1,
  },
  {
    other: "zoe",
    opener: "other",
    segments: [
      { id: "z01", day: 2, hour: 15, spanHours: 0, n: 1, brief: "A single first message (a message REQUEST John hasn't answered): Zoe Moreau, a design student, found John through the app, saw he works on interest matching, and asks to chat about doing design research for a class project." },
    ],
  },
  {
    other: "hiro",
    opener: "john",
    segments: [
      { id: "h01", day: 1, hour: 12, spanHours: 0, n: 1, brief: "A single first message (John's outgoing REQUEST, not yet accepted): John introduces himself to Hiro Rahman and asks if he'd be up for being one of the students in the user study Thu 24 – Sat 26 Sep." },
    ],
  },
];
