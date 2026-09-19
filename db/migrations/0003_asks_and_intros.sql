-- Supporting tables for the /asks and /intros endpoints in the backend
-- services handoff, section 9. The data model doc defers the "collaboration
-- layer" and "introductions" to future work; the backend doc's endpoint
-- surface requires them now, so they're added here rather than invented
-- ad hoc in application code.

CREATE TABLE ask (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id  uuid NOT NULL REFERENCES actor(id),
  text       text NOT NULL,
  open_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ask_author_idx ON ask (author_id);

-- Mirrors actor_concept's pattern: raw_text is written immediately by
-- parse_ask, concept_id resolves asynchronously through the same pipeline.
CREATE TABLE ask_concept (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ask_id      uuid NOT NULL REFERENCES ask(id),
  concept_id  uuid REFERENCES concept(id),
  raw_text    text NOT NULL,
  resolved_at timestamptz
);

CREATE INDEX ask_concept_ask_idx ON ask_concept (ask_id);
CREATE INDEX ask_concept_concept_idx ON ask_concept (concept_id);

CREATE TABLE intro (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES actor(id),
  target_id    uuid NOT NULL REFERENCES actor(id),
  state        text NOT NULL DEFAULT 'requested'
                 CHECK (state IN ('suggested', 'requested', 'accepted', 'declined')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (requester_id, target_id)
);
