# StudentOS

A university modeled as a **connected knowledge graph**, rendered as a **desktop shell in the browser**, where **role-based access makes the graph perspectival** and a **self-hosted LLM navigates it**.

The core loop is *"where do I fit in"*: traversing a graph of students, faculty, staff, departments, courses, labs, clubs, projects, events and goals to discover the people, courses, labs, openings and events connected to what you care about.

It is explicitly **not** an LMS. Course folders and a deadlines calendar exist, but they are one window among many. The thing an LMS cannot do is the demo: **the same OS renders a radically different institution depending on who logs in.**

---

## Quickstart (docker compose — the whole stack)

Nothing to install but Docker.

```bash
cp .env.example .env              # optional; compose has working defaults
docker compose up -d --build      # neo4j + app (hot reload) on http://localhost:3000
docker compose run --rm seed      # wipe + load the synthetic university
docker compose logs -f app
```

Then open **http://localhost:3000** and pick a persona. Neo4j Browser is on
**http://localhost:7474** (`neo4j` / `studentos`).

| Command | What it does |
|---|---|
| `docker compose up -d --build` | Neo4j + the app in dev mode, source bind-mounted, hot reload |
| `docker compose run --rm seed` | Reseeds the graph (deterministic — safe to re-run any time) |
| `docker compose --profile test run --rm test` | RBAC leak tests + AI smoke harness, inside the network |
| `docker compose --profile prod up -d --build app-prod` | Production build (Next standalone) instead of dev |
| `docker compose logs -f app` | App logs, including every AI tool call |
| `docker compose down` | Stop everything (`-v` also drops the graph) |

Override anything through the environment or `.env`: `APP_PORT`, `NEO4J_PASSWORD`,
`JWT_SECRET`, `LLM_BASE_URL`, `LLM_MODEL`. Note that inside a container a vLLM
running on your laptop is `http://host.docker.internal:8000/v1`, not `localhost`.

### Running on the host instead

If you would rather run Node directly and keep only the database in Docker:

```bash
cp .env.example .env         # NEO4J_URI=bolt://localhost:7687
npm install
npm run db:up                # Neo4j only
npm run seed
npm run dev                  # http://localhost:3000
npm test                     # needs the seeded DB
```

The login screen lists every seeded persona. Start as **Amara Okonkwo** (sophomore, computational biology) — she is the hero student the demo is built around.

### Attaching the model

The app talks to any **OpenAI-compatible** endpoint. On the GPU host:

```bash
vllm serve Qwen/Qwen2.5-14B-Instruct \
  --enable-auto-tool-choice --tool-call-parser hermes --port 8000
```

then in `.env`:

```
LLM_BASE_URL=http://<gpu-host>:8000/v1
LLM_MODEL=Qwen/Qwen2.5-14B-Instruct
```

**Until that host exists, the app runs without it.** With `LLM_BASE_URL` empty, the agent loop falls back to a deterministic planner (`lib/ai/fallback.ts`) that calls the *same* RBAC-scoped graph tools and renders the *same* subgraphs — only the prose is templated instead of generated. Nothing else in the stack changes when the model is plugged in; the status bar shows which mode you are in.

---

## Architecture

```
app/                     Next.js App Router — UI and route handlers
  api/auth/*             login (persona picker), logout, me, personas
  api/graph/*            search · traverse · paths · interest · recommend · node/[id]
  api/apps/*             courses · calendar · goals · admissions · finance · hr · dean
  api/ai/query           SSE agent loop
  api/ai/action          confirmed agentic actions
lib/auth/                roles.ts (the scope matrix) · jwt.ts · session.ts
lib/graph/               driver.ts · policy.ts (authorization) · tools.ts · apps.ts
lib/ai/                  client.ts (vLLM) · toolSchemas.ts · agent.ts · fallback.ts
components/shell/        Desktop · Dock · WindowFrame · CommandBar · LoginScreen
components/apps/         Compass · Me · Courses · Calendar · Browse · Goals · Admin
seed/                    data.ts (deterministic generator) · seed.ts (wipe + load)
tests/                   rbac.test.ts (the leak tests) · agent.test.ts (smoke harness)
```

**Stack:** Next.js (App Router) + TypeScript + Tailwind v4 · react-rnd + Zustand for the window manager · react-force-graph-2d for the graph · Neo4j 5 · JWT (jose) · vLLM over an OpenAI-compatible API.

---

## The graph

`Person · Department · Course · Offering · Term · Lab · Club · Event · Interest · Goal · Paper · Position · Assignment · Application · FinanceRecord · HRRecord`

**`Interest` is the pivot.** Courses `COVERS`, labs `FOCUSES_ON`, clubs `CENTERED_ON`, papers `ON`, people `INTERESTED_IN` (with `strength`), goals `ABOUT` — all pointing at the same interest nodes, which form a shallow DAG via `SUBFIELD_OF`. Because everything points at the same topics, "where do I fit" is **inferred** rather than hand-authored: start from a person's interests and their goals' interests, expand down the DAG, and rank what shares them.

**A person exists exactly once.** Many interests means many `INTERESTED_IN` edges from the same `Person` node — never a copy of the person per topic.

Two node labels extend the original spec because the Finance and HR consoles need something to be authorized *about*: `FinanceRecord` (student accounts and department budgets, via `HAS_FINANCE`) and `HRRecord` (employment records, via `HAS_HR`).

---

## RBAC is the feature, not the plumbing

`lib/graph/policy.ts` is the gate. Every query in `tools.ts` and `apps.ts` composes two predicates into its Cypher:

- `nodeVisibility(v)` — may this caller see this node at all?
- `edgeVisibility(r)` — may this caller traverse this relationship?

Three tiers:

| Tier | Contents | Who |
|---|---|---|
| Public | faculty and student profiles, courses, labs, clubs, events, open positions, papers, **the whole interest graph** | everyone authenticated |
| Owned | enrollments, goals, advisees, rosters you teach, assignments in your offerings | the owner, plus specific related roles (advisor, instructor, registrar) |
| Restricted | Applications · FinanceRecords · HRRecords | admissions · finance · HR respectively — and no one else, the dean included |

The UI hides what a scope forbids, but the UI is not the gate: a raw `curl` with a student token gets identically filtered results. Node ids arriving from the browser *or from the model* are re-checked in `assertVisible()` before they anchor a traversal — an id is a capability otherwise.

`tests/rbac.test.ts` asserts this, including the spec's hard rule: a student cannot reach Applications, Finance or HR by search, by id, by traversal, by path-fishing, or through an app route.

---

## The AI layer

The LLM never touches the database and cannot write Cypher. It gets a fixed tool surface — `search_nodes`, `nodes_by_interest`, `recommend_for_person`, `traverse`, `find_paths`, `summarize_neighborhood`, plus the confirmed actions `draft_intro_email`, `add_to_calendar`, `generate_checklist` — and every one of them takes the caller's scope as its first argument, applies the visibility predicates, and runs a parameterized query.

Loop: NL query → model selects tools → server runs them *scoped* → condensed results returned → model composes a grounded answer while the union of the results renders as a clickable subgraph. Responses stream over SSE; tool calls are logged server-side and shown live in Compass.

`recommend_for_person` is the "where do I fit" engine: it collects a person's `INTERESTED_IN` edges and their goals' `ABOUT` interests, expands two hops down `SUBFIELD_OF` at decaying weight, and ranks by shared-interest overlap × strength. No hand-authored recommendation edges exist.

---

## Status against the build plan

| Phase | State |
|---|---|
| 0 — scaffold + seed | done. `npm run seed` prints counts and verifies the hero traversal. |
| 1 — auth + RBAC-filtered API | done. 17 RBAC tests green, including cross-staff separation. |
| 2 — shell + Compass + role switching | done. Dock, draggable windows, ⌘K, persona switcher. |
| 3 — AI navigator | done, running on the fallback planner until vLLM is reachable; tool-calling path is written and exercised by the smoke tests. |
| 4 — supporting apps | done. Courses, Calendar (per-course + global search), Me, Goals, Directory/Labs/Clubs. |
| 5 — agentic actions + polish | actions done with confirm dialogs; visual polish and rehearsal remain. |

## Demo script (3 minutes)

1. **Log in as Amara.** Dock shows student apps; **Where I Fit** opens with her goals and the courses, labs, clubs and people they connect to.
2. **⌘K:** *"find a research group in computational biology with openings for undergrads"* → the graph renders labs, their PIs and the open undergraduate positions.
3. **Connection:** *"how am I connected to the Systems Lab?"* → `Amara — enrolled in → CSC 101 ← teaches — Wei Webb — pi of → Systems Lab`.
4. **Agentic action:** draft an intro email to the PI, add the seminar to the calendar — both proposed, both confirmed by hand.
5. **Switch user.** Admissions staff: the dock now carries the Admissions Console and the graph is the applicant pipeline; the student's world is gone. Dean: org structure, department goals, interest density across the institution.

## Decisions (§12, resolved)

1. **Backend language — TypeScript.** One language end to end; the agent loop reaches the model over HTTP, so Python buys nothing here.
2. **Graph DB — Neo4j 5**, via `docker compose`. The Postgres + recursive CTE fallback was not needed.
3. **Model — Qwen 2.5 Instruct** as the default `LLM_MODEL`; it supports native tool calling, which §7 requires. Any OpenAI-compatible tool-calling model can be swapped in via env. The GPU host is not yet available, hence the fallback planner.
