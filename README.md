# Link

Link is a StudentOS-style platform for discovering who you should talk to on a campus and why. It connects students, faculty, clubs, labs, departments, interests, projects, and conversations into one explainable graph, then recommends meaningful people or organizations with evidence attached to every match.

The project was built for HackMIT 2026 around a simple problem: outside tightly connected environments, students often struggle to find collaborators, mentors, clubs, labs, or faculty who share their niche interests. Link lets people describe what they care about in their own words, uses AI to resolve those words into shared concepts, and turns the result into a searchable campus knowledge graph.

## What It Does

- Lets users describe academic interests, hobbies, work, and goals in natural language.
- Resolves messy phrases like "ML", "machine learning", and "statistical learning" into shared concepts.
- Recommends students, faculty, clubs, labs, and departments based on graph relationships and semantic similarity.
- Explains why each recommendation was made instead of returning opaque scores.
- Supports live collaborative workspaces and an AI assistant over conversations and files.
- Runs the backend, database connections, and local LLM stack on an ASUS GX10.

## How It Works

Link stores campus data as a graph in PostgreSQL. People and organizations are represented as actors, interests are represented as concepts, and relationships such as memberships, affiliations, courses, events, projects, and shared contexts are represented as graph edges.

When a user enters an interest, the backend first checks existing aliases and fuzzy text matches. If needed, it uses embeddings from `nomic-embed-text` and adjudication from `qwen2.5:14b-instruct` to decide whether the phrase matches an existing concept or should become a new one. Once resolved, the phrase is cached as an alias so future matches get cheaper and cleaner.

Recommendations are scored from shared concepts, concept rarity, graph distance, shared contexts, recency, and whether two actors are already connected. Every result includes the evidence that caused the match, so the interface can show not just who to meet, but why the connection is relevant.

## Tech Stack

- **Backend:** TypeScript, Express 4, handwritten SQL with `pg`
- **Database:** PostgreSQL 16 with `pgvector`, `pg_trgm`, and `pgcrypto`
- **Frontend:** React, Vite, TypeScript
- **Collaboration:** Hocuspocus 4 and Yjs
- **AI runtime:** Ollama using OpenAI-compatible endpoints
- **LLMs:** `qwen2.5:14b-instruct` for reasoning and `nomic-embed-text` for embeddings
- **Infrastructure:** Docker Compose, nginx, local hosting on an ASUS GX10

## Data

The demo database is seeded with generated fictional campus people and organizations, plus open data sources used to build realistic academic and interest vocabularies. These include the Computer Science Ontology, NCES Classification of Instructional Programs, and public-domain hobby and name datasets.

No seeded person represents a real student or faculty member.

## Architecture

The system runs as four roles from one codebase:

- **API:** Serves HTTP endpoints, WebSocket collaboration, and the built frontend.
- **Resolution worker:** Processes background AI jobs such as concept resolution, embeddings, extraction, and explanations.
- **Migrate:** Applies database migrations before the API starts.
- **Ingest worker:** Handles batch imports when needed.

Slow AI work is pushed into a PostgreSQL-backed job queue so normal requests stay responsive. Workers claim jobs with `SELECT ... FOR UPDATE SKIP LOCKED`, allowing multiple workers to drain the queue safely without an external broker.

## Running Locally

Install dependencies:

```bash
npm install
cd web && npm install
```

Create an environment file:

```bash
cp .env.example .env
```

Run migrations and seed data:

```bash
npm run dev:migrate
npm run dev:seed
```

Start the backend and worker:

```bash
npm run dev:api
npm run dev:resolution-worker
```

Start the frontend:

```bash
cd web
npm run dev
```

The frontend runs at `http://localhost:5173` and proxies API requests to the backend.

For frontend-only development, open:

```text
http://localhost:5173/?fixtures=1
```

This uses canned fixture data and does not require Postgres or Ollama.

## Team

- **Prasant:** Backend services, concept resolution, recommendation logic, LLM selection/configuration, and self-hosting the full system on the ASUS GX10.
- **Qain:** Frontend, database design, data modeling, and user experience.

## What's Next

- Test Link with larger real communities and more complex campus graphs.
- Pilot the system with universities, clubs, labs, or departments.
- Improve recommendations using feedback from actual student and faculty interactions.
- Add better organization-facing tools for clubs and labs to find interested students.
