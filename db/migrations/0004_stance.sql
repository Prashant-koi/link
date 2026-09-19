-- Frontend handoff, section 7: aspiration search needs to know whether an
-- interest is already held, being explored, or aspired to. Orthogonal to
-- `strength` (confidence in the resolution) — a strong aspiration and a
-- weak expertise are both coherent, so this is its own column, not an
-- overload of strength.

ALTER TABLE actor_concept
  ADD COLUMN stance text NOT NULL DEFAULT 'established'
    CHECK (stance IN ('established', 'exploring', 'aspiring')),
  ADD COLUMN stance_since date;

-- stance_since lets scoring decay stale aspirations/explorations by age.
CREATE INDEX actor_concept_concept_stance_idx ON actor_concept (concept_id, stance);
