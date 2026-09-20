// The story bible for John Doe's seeded collaboration history.
//
// Everything the generated chats and files say must agree with this. It is
// hand-written; the local model only expands it into prose (see generate.ts).
// Timestamps are absolute and anchored on STORY_END so the story reads the same
// whenever it is seeded.

export const STORY_END = "2026-09-20T18:00:00-04:00"; // "now" for the story (a Sunday)

export interface Person {
  key: string;
  username: string;
  name: string;
  role: string;
  voice: string; // how they write, so threads don't all sound alike
}

export const CAST: Record<string, Person> = {
  john: { key: "john", username: "john.doe", name: "John Doe", role: "CS undergrad, tech lead; owns the concept-resolution pipeline and the local-model integration", voice: "direct, dry humour, writes in short bursts, occasionally over-explains technical details" },
  jane: { key: "jane", username: "jane.doe", name: "Jane Doe", role: "CS undergrad, frontend lead (React/Vite, search, the home atlas canvas)", voice: "energetic, lots of exclamation marks and emoji, asks a lot of questions, quick to prototype" },
  chen: { key: "chen", username: "chen.diaz", name: "Chen Diaz", role: "CS undergrad, backend + infra (API, auth, Docker, nginx, deploy)", voice: "terse, lowercase, pragmatic, sends command snippets and logs, sleeps late" },
  noor: { key: "noor", username: "noor.rahman", name: "Noor Rahman", role: "CS undergrad, data + ML (concept graph, seed data, embeddings, scoring, paper experiments)", voice: "careful, precise, likes numbers and tables, politely pushes back" },
  mei: { key: "mei", username: "mei.shah", name: "Mei Shah", role: "Design undergrad, product design (visual language, turquoise theme, onboarding, demo deck)", voice: "warm, visual, talks about feel and hierarchy, sends sketch descriptions" },
  sofia: { key: "sofia", username: "sofia.petrov", name: "Prof. Sofia Petrov", role: "CS faculty; advises the concept-resolution paper", voice: "formal but kind, concise, asks pointed questions, signs off with 'Best, Sofia' sometimes" },
  diego: { key: "diego", username: "diego.amari", name: "Diego Amari", role: "CS department staff; the team's mentor, liaison to department IT and the pilot", voice: "friendly, practical, cautious about privacy and policy, uses 'heads up'" },
  nina: { key: "nina", username: "nina.farouk", name: "Nina Farouk", role: "CS undergrad, course-project teammate (CS 431 Raft key-value store)", voice: "organised, checklist-minded, a bit sarcastic, plans in bullet points" },
  amara: { key: "amara", username: "amara.okafor", name: "Amara Okafor", role: "CS undergrad, course-project teammate, strong on testing", voice: "laid-back, jokes, writes 'ok ok ok', good at spotting edge cases" },
  zoe: { key: "zoe", username: "zoe.moreau", name: "Zoe Moreau", role: "Design student who found John through the app", voice: "friendly stranger, polite" },
  hiro: { key: "hiro", username: "hiro.rahman", name: "Hiro Rahman", role: "CS student John wants to meet about the pilot", voice: "n/a" },
};

// Calendar for the story. "d68" means 68 days before 2026-09-20.
export const BIBLE = `
PROJECT "Link" — a campus app that surfaces connections between university members by mapping what people know and want to learn onto a concept graph. A person's free-text interests are resolved to canonical concepts (ontology: a subset of the Computer Science Ontology); people who share concepts are ranked by rarity-weighted overlap (idf), and every suggestion explains WHY two people connect. Built for the HackMIT / Dropbox hackathon by the team below, started Tue 14 Jul 2026. The hackathon weekend was Sat 12 – Sun 13 Sep 2026 (build overnight, demos Sunday noon). Result: 3rd place in the Dropbox track, judges praised the "why you two connect" explanations and asked hard questions about privacy.

TEAM: John Doe (tech lead, resolution pipeline, local AI), Jane Doe (frontend), Chen Diaz (backend/infra), Noor Rahman (data/ML), Mei Shah (design). Mentor: Diego Amari (CS department staff). Paper advisor: Prof. Sofia Petrov. Separate course project: CS 431 Distributed Systems — a Raft-based key-value store with Nina Farouk and Amara Okafor.

TECH: Postgres 16 + pgvector (768-d vectors), Node/TypeScript API (Express), React 18 + Vite frontend with plain CSS design tokens, Docker Compose deployment behind nginx with HTTPS (linkmit.duckdns.org). AI runs LOCALLY on an ASUS GX10 box with 128 GB unified memory via Ollama: nomic-embed-text for embeddings and qwen3.8 (27B, a thinking model, run with reasoning off) for adjudication and explanations. Job queue is Postgres-backed (FOR UPDATE SKIP LOCKED); a separate worker resolves interests in the background.
RESOLUTION PIPELINE (final): exact alias match -> trigram fuzzy match (>=0.6) -> embedding nearest-neighbour (auto-accept >=0.92, but that threshold never actually fires in practice; adjudication floor 0.60) -> LLM adjudication choosing among top-5 candidates -> LLM proposes a new concept only if the string is 5+ characters. Every model decision is cached as an alias so a string never hits the model twice.
SCORING: rarity-weighted (idf) shared concepts, plus a decayed bonus for one-hop related concepts. Hop decay was tuned from 0.5 down to 0.15 on Wed 26 Aug because hierarchy-adjacent overlaps were outranking rare direct matches.

KEY DECISIONS (with dates):
- D1 Tue 21 Jul: Postgres + pgvector instead of Neo4j (one datastore, team knows SQL, recursive CTEs are enough). Chen argued for it; Jane wanted Neo4j's graph viz but accepted.
- D2 Tue 28 Jul: the four-stage resolution pipeline above, so the model is only called when cheap matching fails. Noor and John designed it.
- D3 Tue 4 Aug: use a LOCAL model, not a cloud API, because people's interests and messages are personal data (Diego's privacy concerns). Started with qwen2.5-14b.
- D4 Tue 11 Aug: messaging is request/accept (double opt-in) — nobody can message someone who hasn't accepted. Mei and Diego pushed for it.
- D5 Tue 18 Aug (SCOPE CUT): drop the native mobile app and the calendar integration; ship a responsive web app only. Jane was disappointed, agreed.
- D6 Wed 26 Aug (BLOCKER FOUND): embedding/adjudication latency p95 was 4.2 s because Ollama unloaded idle models (reload ~46 s for the big model, ~14 s for the embedder) and requests were unbatched. Fix: keep-warm heartbeat every 2 minutes, batching 256 embeddings, instruct concurrency 2. p95 fell to 0.9 s by Mon 31 Aug.
- D7 Thu 27 Aug: model upgrade from qwen2.5-14b to qwen3.8 (better adjudication; needs reasoning_effort=none because it is a thinking model).
- D8 Tue 1 Sep: home screen becomes the "atlas": interests as soft overlapping regions with people as spheres inside them (Mei's sketch, Jane's canvas). Theme is turquoise.
- D9 Wed 9 Sep: demo flow pivot — open the demo on ONE person's "why you connect" explanation, then zoom out to the atlas (judges lose the thread if you start with the graph). Code freeze Thu 10 Sep 6 pm.
- Small-model test (Mon 14 Sep, Noor + John): qwen3 4B instruct was 3.6x faster (0.5 s vs 1.8 s per adjudication) and agreed with qwen3.8 on 37/40 real cases but accepted 2 of 10 junk strings (like "vacation photos" -> "real scenes"); qwen3.8 rejected all 10. Decision: keep qwen3.8 for adjudication; the small model may be used for low-risk text later.

PAPER: "Small local language models for resolving free-text interests to a concept ontology" — advisor Prof. Sofia Petrov, authors John (first), Noor, Sofia. Target: a NLP-for-education workshop, abstract due Fri 25 Sep, full submission due Fri 2 Oct 2026. Results so far: pipeline resolves 99.1% of 2,946 seeded interest strings without a human; only 3.6% of strings reach the LLM; adjudication qwen3.8 39/40 agreement, 10/10 junk rejected; 4B model 37/40 and 8/10. Open items: related-work section, ablation removing the trigram stage, human evaluation with 100 strings (Noor), figure of the pipeline (Mei).

COURSE PROJECT (CS 431): Raft key-value store in Go; team John, Nina, Amara. Leader election done; log replication working; a leader-election bug (split votes after a partition heal) fixed by randomising election timeouts 150–300 ms. Milestone 3 (snapshotting + linearizability tests) due Wed 30 Sep; final report + demo due Fri 9 Oct. John owns log replication, Nina leader election + design doc, Amara tests and the Jepsen-style fault injector.

OPEN ITEMS RIGHT NOW (Sun 20 Sep):
- Chen: harden auth (session rotation, rate limits on /auth) — due Wed 23 Sep.
- John: automatic retry with backoff (5 s / 20 s / 60 s) for failed model jobs — due Tue 22 Sep.
- Jane + Mei: user study with 10 students Thu 24 – Sat 26 Sep; recruiting now.
- Noor: human evaluation of 100 strings for the paper — due Wed 23 Sep.
- Diego: pilot meeting with the CS department Tue 29 Sep at 2 pm; needs a one-page privacy summary from John (due Fri 25 Sep).
- Paper abstract Fri 25 Sep; full paper Fri 2 Oct.
- Course milestone 3 Wed 30 Sep.
`.trim();
