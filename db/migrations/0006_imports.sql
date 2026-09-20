-- Live onboarding imports: resume / LinkedIn / GitHub / course enrolment.
-- The data model handoff (section 8) leaves "real scraping/upload sources"
-- out of scope and names the ingest worker as the seam they plug into.
-- This is that seam made concrete, without changing how anything downstream
-- reads: every import still lands as actor_concept.raw_text + contexts and
-- edges, and resolves through the normal pipeline.

CREATE TABLE import_source (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     uuid NOT NULL REFERENCES actor(id),
  kind         text NOT NULL CHECK (kind IN ('resume', 'linkedin', 'github', 'courses')),
  -- Where it came from, as the person gave it: a filename, a profile URL, a
  -- GitHub login, or 'manual' for pasted text. Shown back to them verbatim.
  origin       text,
  -- The submitted text, kept forever for exactly the reason actor_concept
  -- keeps raw_text: extraction improves later by re-running over the source
  -- rather than by re-asking the person to upload it again.
  raw_text     text,
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'running', 'done', 'failed')),
  detail       text,        -- failure message, or a one-line summary on success
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX import_source_actor_idx ON import_source (actor_id, created_at DESC);

-- Everything an import produces is tagged with the import that produced it,
-- so the status panel can count real rows rather than guess, and so a bad
-- import can be found and undone without touching hand-entered interests.
ALTER TABLE actor_concept ADD COLUMN import_id uuid REFERENCES import_source(id);
CREATE INDEX actor_concept_import_idx ON actor_concept (import_id);

ALTER TABLE edge ADD COLUMN import_id uuid REFERENCES import_source(id);
CREATE INDEX edge_import_idx ON edge (import_id);

-- One new job kind. The import worker is the model-touching worker (same
-- process as resolution), because extraction is a bio_extract call.
ALTER TABLE job DROP CONSTRAINT IF EXISTS job_kind_check;
ALTER TABLE job ADD CONSTRAINT job_kind_check CHECK (kind IN (
  'resolve_concept', 'embed', 'extract_bio', 'explain_pair', 'parse_ask', 'ingest_import'
));

-- Contexts created by an import (a course section, a GitHub repository) must
-- be findable again on the next import so two people who took the same
-- course land on the same context row rather than two private copies.
ALTER TABLE context ADD COLUMN external_key text;
CREATE UNIQUE INDEX context_external_key_idx ON context (external_key) WHERE external_key IS NOT NULL;
