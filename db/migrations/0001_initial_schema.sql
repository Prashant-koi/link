-- Connection graph data model — see data model handoff doc, 2026-09-19.
-- Entities: actor, context, concept (+ alias/relation), actor_concept, edge.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS vector;   -- pgvector, concept.embedding

-- ---------------------------------------------------------------------------
-- Concept vocabulary (SKOS-style: canonical concepts + alias layer)
-- ---------------------------------------------------------------------------

CREATE TABLE concept (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pref_label    text NOT NULL,
  definition    text NOT NULL,      -- one sentence; this is what gets embedded
  embedding     vector(768),        -- dimension placeholder, pinned to embedding model choice
  depth         int                 -- hops from a root, for decay math
);

-- Embed the definition, not the label: cosine kNN over one-line definitions
-- is what makes "ML" resolve correctly instead of landing nowhere useful.
CREATE INDEX concept_embedding_idx ON concept
  USING hnsw (embedding vector_cosine_ops);

CREATE TABLE concept_alias (
  surface       text NOT NULL,      -- "ML", "AI/ML", "m.l.", "machinelearning"
  surface_norm  text NOT NULL UNIQUE, -- lowercased, depunctuated, singularised
  concept_id    uuid NOT NULL REFERENCES concept(id),
  source        text,               -- seed | user | llm | human_review
  confidence    real
);

CREATE INDEX concept_alias_concept_id_idx ON concept_alias (concept_id);

-- Aliasing and hierarchy are different relations: "AI" is broader than "ML",
-- not an alias of it. Collapsing them matches unrelated people and feels stupid.
CREATE TABLE concept_relation (
  id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  src_id uuid NOT NULL REFERENCES concept(id),
  dst_id uuid NOT NULL REFERENCES concept(id),
  kind   text NOT NULL CHECK (kind IN ('broader', 'related')),
  weight real,
  UNIQUE (src_id, dst_id, kind)
);

CREATE INDEX concept_relation_src_idx ON concept_relation (src_id);
CREATE INDEX concept_relation_dst_idx ON concept_relation (dst_id);

-- ---------------------------------------------------------------------------
-- Actors, contexts
-- ---------------------------------------------------------------------------

CREATE TABLE actor (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text CHECK (kind IN ('person', 'club', 'lab', 'department', 'company')),
  person_kind   text CHECK (person_kind IN ('student', 'faculty', 'staff', 'alum')),
  display_name  text,
  home_unit     uuid REFERENCES actor(id), -- department or school, self-referencing
  discoverable  boolean NOT NULL DEFAULT false -- opt-in; false is never suggested to anyone
);

CREATE INDEX actor_home_unit_idx ON actor (home_unit);

-- Context is kept separate from actor so "took the same course in 2023" can
-- be told apart from "in the same lab today" — same shape, different signal,
-- and only distinguishable because contexts carry validity dates.
CREATE TABLE context (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text CHECK (kind IN ('course', 'event', 'paper', 'project', 'grant', 'team')),
  title      text,
  starts_on  date,
  ends_on    date
);

-- ---------------------------------------------------------------------------
-- Actor <-> concept, and the single typed/weighted/temporal edge table
-- ---------------------------------------------------------------------------

CREATE TABLE actor_concept (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid NOT NULL REFERENCES actor(id),
  concept_id  uuid NOT NULL REFERENCES concept(id),
  raw_text    text NOT NULL,   -- exactly what they typed, never overwritten:
                               -- resolution improves later by re-running over this
  strength    real,            -- declared 1.0, inferred from coursework ~0.4
  source      text,
  resolved_at timestamptz,
  visibility  text NOT NULL DEFAULT 'institution'
                CHECK (visibility IN ('public', 'institution', 'private'))
);

CREATE INDEX actor_concept_actor_idx ON actor_concept (actor_id);
CREATE INDEX actor_concept_concept_idx ON actor_concept (concept_id);

-- One edge table for every relation between actors/contexts. Endpoints are
-- polymorphic (actor or context) so src/dst carry no FK, only their type tag.
CREATE TABLE edge (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  src_id     uuid NOT NULL,
  src_type   text NOT NULL,
  dst_id     uuid NOT NULL,
  dst_type   text NOT NULL,
  relation   text NOT NULL CHECK (relation IN (
               'member_of', 'enrolled_in', 'taught', 'authored',
               'attended', 'advises', 'affiliated_with'
             )),
  weight     real,
  valid_from date,
  valid_to   date,   -- null means current; this is what stops a shared 2023
                      -- intro course outranking a current shared lab
  evidence   jsonb,   -- provenance, used to render explanations
  visibility text NOT NULL DEFAULT 'institution'
               CHECK (visibility IN ('public', 'institution', 'private'))
);

CREATE INDEX edge_src_idx ON edge (src_type, src_id);
CREATE INDEX edge_dst_idx ON edge (dst_type, dst_id);
CREATE INDEX edge_relation_idx ON edge (relation);
CREATE INDEX edge_valid_to_idx ON edge (valid_to);
