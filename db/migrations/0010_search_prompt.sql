-- The search page's AI refinement uses a new registered prompt.
ALTER TABLE prompt DROP CONSTRAINT prompt_name_check;
ALTER TABLE prompt ADD CONSTRAINT prompt_name_check CHECK (name IN (
  'concept_adjudication', 'concept_propose', 'bio_extract',
  'explain_pair', 'parse_ask', 'search_interpret'
));
