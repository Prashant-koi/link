-- Frontend handoff, section 5 (Person detail / ContactBlock): the contact
-- block needs to know whether the actor has an in-app account (routes to
-- POST /intros) or only published contact methods (rendered as plain text).
-- Not in backend section 9 — added here as that section's own open question
-- flags.

ALTER TABLE actor ADD COLUMN has_account boolean NOT NULL DEFAULT false;

CREATE TABLE actor_contact_method (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   uuid NOT NULL REFERENCES actor(id),
  kind       text NOT NULL CHECK (kind IN ('email', 'phone', 'website', 'office')),
  value      text NOT NULL,
  label      text,
  visibility text NOT NULL DEFAULT 'institution'
               CHECK (visibility IN ('public', 'institution', 'private')),
  sort_order int NOT NULL DEFAULT 0
);

CREATE INDEX actor_contact_method_actor_idx ON actor_contact_method (actor_id);
