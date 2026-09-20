# Link API Reference

**Base URL:** `https://linkmit.duckdns.org`
**Auth:** All non-public routes require the `link_session` cookie. Set via `POST /auth/login`.

> **Note:** This is a hackathon prototype. Do not expose this endpoint publicly without auth hardening (see TODOs below).

---

## Authentication

### `POST /auth/login`
Exchange credentials for a session.

**Body:**
```json
{ "email": "user@mit.edu", "password": "string" }
```

**Response `200`:**
- Sets cookie: `link_session=<opaque_token>; HttpOnly; Secure; SameSite=Lax`
- JSON: `{ "actor_id": 1, "name": "Jane Doe" }`

**Errors:**
- `401` Invalid credentials.
- `429` Rate limited (max 5 attempts/min per IP). *TODO: Implement proper backoff.*

### `POST /auth/logout`
Invalidate current session.

**Response `204`:** No content. Clears cookie.

---

## Actor Profile

### `GET /actors/me`
Get current user profile and resolved interests.

**Response `200`:**
```json
{
  "actor_id": 1,
  "name": "Jane Doe",
  "email": "jane@mit.edu",
  "interests": [
    { "raw": "rust async", "concept_id": 42, "label": "Concurrency" },
    { "raw": "distributed systems", "concept_id": 10, "label": "Distributed Computing" }
  ],
  "created_at": "2026-07-14T10:00:00Z"
}
```

### `GET /actors/me/suggestions`
Get ranked suggestions for people to connect with.

**Query Params:**
- `limit` (int, default 10, max 50): Number of results.
- `min_score` (float, default 0.0): Filter by rarity-weighted overlap score.

**Response `200`:**
```json
{
  "suggestions": [
    {
      "actor_id": 5,
      "name": "Noor Rahman",
      "score": 4.2,
      "shared_concepts": ["Concurrency", "Distributed Computing"],
      "explanation": "You both care about rare concepts in systems design."
    }
  ]
}
```

---

## Search & Imports

### `GET /search/aspirations`
Search for what people want to learn.

**Query Params:**
- `q` (string, required): Search term.
- `limit` (int, default 10).

**Response `200`:**
```json
{
  "results": [
    {
      "actor_id": 3,
      "name": "Chen Diaz",
      "aspiration_raw": "kubernetes networking",
      "concept_label": "Cloud Infrastructure"
    }
  ]
}
```

### `POST /me/imports`
Bulk import interests from a CSV or JSON list. Triggers background resolution pipeline.

**Body:**
```json
{
  "interests": ["rust async", "distributed systems", "c++ memory"]
}
```

**Response `202`:**
- JSON: `{ "import_id": 99, "status": "processing" }`
- Check status via `GET /me/imports/{import_id}`.

---

## Conversations

### `POST /conversations`
Start a conversation. Requires double opt-in (D4).

**Body:**
```json
{
  "recipient_actor_id": 5,
  "message": "Hi Noor, saw we both like Raft!"
}
```

**Response `201`:**
- JSON: `{ "conversation_id": 12, "status": "pending" }`

**Errors:**
- `403` Recipient has not accepted messages from you. *User must first accept your connection request.*

### `GET /conversations/{id}/messages`
Fetch message history for a conversation.

**Response `200`:**
```json
{
  "conversation_id": 12,
  "messages": [
    { "sender_actor_id": 1, "body": "Hi Noor...", "created_at": "..." },
    { "sender_actor_id": 5, "body": "Hey Jane!", "created_at": "..." }
  ]
}
```

---

## Workspaces (Brief)

*Workspace features are stubbed for the hackathon. Only basic CRUD is available.*

- `GET /workspaces` — List user's workspaces.
- `POST /workspaces` — Create workspace `{ "name": "string" }`.

*TODO: Full workspace API is out of scope for HackMIT (D5).*

---

## Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 202 | Accepted (async job started) |
| 400 | Bad request (validation error) |
| 401 | Unauthorized (missing/invalid cookie) |
| 403 | Forbidden (permission denied, e.g., messaging not accepted) |
| 404 | Not found |
| 429 | Rate limited |
| 500 | Internal server error |

---

## Deployment Notes

- **Docker Compose:** `docker compose up -d`
- **Env Vars:**
  - `DATABASE_URL`: Postgres connection string.
  - `OLLAMA_HOST`: e.g., `http://gx10:11434`
  - `SESSION_SECRET`: Random hex string for cookie signing.
- **Health Check:** `GET /health` returns `{ "status": "ok", "db": "up", "ollama": "up" }`.

*Last updated: Sun 6 Sep 2026 by Chen Diaz.*
