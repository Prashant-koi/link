-- AI descriptions of people: search-result blurbs and the profile "Learn more"
-- summary. The blurb prompt is registered like the others; summaries are cached
-- per (person, facts hash) so a changed profile regenerates automatically.

ALTER TABLE prompt DROP CONSTRAINT prompt_name_check;
ALTER TABLE prompt ADD CONSTRAINT prompt_name_check CHECK (name IN (
  'concept_adjudication', 'concept_propose', 'bio_extract',
  'explain_pair', 'parse_ask', 'search_interpret', 'search_blurb'
));

CREATE TABLE ai_profile_summary (
  actor_id   uuid NOT NULL REFERENCES actor(id) ON DELETE CASCADE,
  facts_hash text NOT NULL,
  text       text NOT NULL,
  model      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, facts_hash)
);
