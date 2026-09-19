-- Backend services layer — see backend services handoff doc, 2026-09-19.
-- Job queue, prompt registry + call ledger, and the supporting indexes/views
-- the read path and resolution pipeline depend on.

CREATE EXTENSION IF NOT EXISTS pg_trgm; -- fuzzy fallback on concept_alias.surface_norm

-- ---------------------------------------------------------------------------
-- Job queue (lives in Postgres: enqueue is transactional with the write that
-- caused it, so a crash never leaves an orphaned job or a permanently
-- unresolved row).
-- ---------------------------------------------------------------------------

CREATE TABLE job (
  id         bigserial PRIMARY KEY,
  kind       text NOT NULL CHECK (kind IN (
               'resolve_concept', 'embed', 'extract_bio', 'explain_pair', 'parse_ask'
             )),
  payload    jsonb NOT NULL,
  state      text NOT NULL DEFAULT 'pending' CHECK (state IN (
               'pending', 'running', 'done', 'failed', 'needs_review'
             )),
  attempts   int NOT NULL DEFAULT 0,
  run_after  timestamptz NOT NULL DEFAULT now(),
  locked_by  text,
  locked_at  timestamptz,
  last_error text
);

CREATE INDEX job_pending_idx ON job (state, run_after) WHERE state = 'pending';

-- ---------------------------------------------------------------------------
-- Prompt registry: system prompts live as files under prompts/*.yaml in git;
-- a loader hashes each on boot and registers it here. Version bumps when the
-- hash changes, so every LLM output stays traceable to the exact prompt text
-- that produced it.
-- ---------------------------------------------------------------------------

CREATE TABLE prompt (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (name IN (
                  'concept_adjudication', 'concept_propose', 'bio_extract',
                  'explain_pair', 'parse_ask'
                )),
  version       int NOT NULL,
  system_body   text NOT NULL,
  user_template text NOT NULL, -- with {placeholders}
  model         text NOT NULL, -- which served model this is tuned against
  params        jsonb,         -- temperature, max_tokens, json_schema
  body_hash     text NOT NULL, -- sha256 of system_body + user_template
  active        boolean NOT NULL DEFAULT true,
  UNIQUE (name, version)
);

CREATE TABLE llm_call (
  id            bigserial PRIMARY KEY,
  prompt_name   text NOT NULL,
  prompt_version int NOT NULL,
  input_hash    text NOT NULL, -- dedup key; identical input is never re-asked
  raw_output    text,
  parsed        jsonb,
  model         text,
  latency_ms    int,
  tokens_in     int,
  tokens_out    int,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- input_hash doubles the ledger as a cache: a repeated question is answered
-- from `parsed` without touching the GPU.
CREATE UNIQUE INDEX llm_call_dedup_idx ON llm_call (prompt_name, prompt_version, input_hash);

-- Lets explain_pair / parse_ask look up a cached prose result by pair or ask,
-- independent of which prompt version produced it.
CREATE INDEX llm_call_prompt_idx ON llm_call (prompt_name, prompt_version);

-- concept_alias gains a prompt_version column: the load-bearing column that
-- lets a bad prompt revision be found and re-run without touching good rows.
ALTER TABLE concept_alias ADD COLUMN prompt_version int;

-- Ingestion writes raw_text first and resolves asynchronously (data model
-- doc, section 8: "an actor is never blocked on the vocabulary being
-- complete") — so concept_id can't be required at insert time.
ALTER TABLE actor_concept ALTER COLUMN concept_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- Read path support
-- ---------------------------------------------------------------------------

-- Fuzzy fallback on surface strings before spending a model call.
CREATE INDEX concept_alias_surface_norm_trgm_idx
  ON concept_alias USING gin (surface_norm gin_trgm_ops);

-- Read-path traversal: two-hop candidate generation over current edges.
CREATE INDEX edge_src_relation_valid_idx ON edge (src_id, relation, valid_to);

-- idf(c) = log(N / (1 + count of actors holding c)). Precomputed, refreshed
-- on a schedule rather than computed per request.
CREATE MATERIALIZED VIEW concept_idf AS
SELECT
  c.id AS concept_id,
  ln(
    (SELECT GREATEST(count(*), 1)::float FROM actor)
    / (1 + count(DISTINCT ac.actor_id))
  ) AS idf
FROM concept c
LEFT JOIN actor_concept ac ON ac.concept_id = c.id
GROUP BY c.id;

CREATE UNIQUE INDEX concept_idf_concept_idx ON concept_idf (concept_id);

-- ---------------------------------------------------------------------------
-- graph_version: bumped by any write that could change a score. Cache key
-- for every derived artifact (explanations, suggestions) — without it, a
-- cached explanation can outlive the edge that justified it.
-- ---------------------------------------------------------------------------

CREATE TABLE graph_version (
  id      boolean PRIMARY KEY DEFAULT true CHECK (id), -- singleton row
  version bigint NOT NULL DEFAULT 1
);

INSERT INTO graph_version (id, version) VALUES (true, 1);

CREATE OR REPLACE FUNCTION bump_graph_version() RETURNS trigger AS $$
BEGIN
  UPDATE graph_version SET version = version + 1 WHERE id = true;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER edge_bumps_graph_version
  AFTER INSERT OR UPDATE OR DELETE ON edge
  FOR EACH STATEMENT EXECUTE FUNCTION bump_graph_version();

CREATE TRIGGER actor_concept_bumps_graph_version
  AFTER INSERT OR UPDATE OR DELETE ON actor_concept
  FOR EACH STATEMENT EXECUTE FUNCTION bump_graph_version();
