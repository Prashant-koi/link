-- Auth and login handoff, section 3. Closes the backend handoff's open
-- question: actor identity and session identity are reconciled here.

CREATE TABLE credential (
  actor_id      uuid PRIMARY KEY REFERENCES actor(id) ON DELETE CASCADE,
  username      text NOT NULL UNIQUE, -- always stored lowercase
  password_hash text NOT NULL,
  derived       boolean NOT NULL DEFAULT false, -- true = demo-derived, never real
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE session (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   uuid NOT NULL REFERENCES actor(id) ON DELETE CASCADE,
  issued_at  timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  user_agent text
);

CREATE INDEX session_actor_active_idx ON session (actor_id) WHERE revoked_at IS NULL;
