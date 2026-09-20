-- Collaborations page: direct messages and shared workspaces.
--
-- Messaging is anchored on the existing `intro` table: one intro row per pair
-- of people *is* the conversation. `requested` = message request awaiting the
-- other side, `accepted` = open thread, `declined` = closed by the target.

-- One conversation per pair, whichever side started it. Collapse any
-- pre-existing mirrored pairs first (keep the most recently updated).
DELETE FROM intro a USING intro b
 WHERE a.id <> b.id
   AND least(a.requester_id, a.target_id) = least(b.requester_id, b.target_id)
   AND greatest(a.requester_id, a.target_id) = greatest(b.requester_id, b.target_id)
   AND (a.updated_at, a.id) < (b.updated_at, b.id);

CREATE UNIQUE INDEX intro_pair_uniq
  ON intro (least(requester_id, target_id), greatest(requester_id, target_id));

CREATE TABLE message (
  id         bigserial PRIMARY KEY,
  intro_id   uuid NOT NULL REFERENCES intro(id) ON DELETE CASCADE,
  sender_id  uuid NOT NULL REFERENCES actor(id),
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX message_intro_idx ON message (intro_id, id);

-- Per-participant read cursor; unread = messages from the other side after it.
CREATE TABLE intro_read (
  intro_id             uuid NOT NULL REFERENCES intro(id) ON DELETE CASCADE,
  actor_id             uuid NOT NULL REFERENCES actor(id),
  last_read_message_id bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (intro_id, actor_id)
);

-- Shared workspaces.
CREATE TABLE workspace (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  created_by uuid NOT NULL REFERENCES actor(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspace_member (
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  actor_id     uuid NOT NULL REFERENCES actor(id),
  role         text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  state        text NOT NULL DEFAULT 'invited' CHECK (state IN ('invited', 'active')),
  invited_by   uuid REFERENCES actor(id),
  joined_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, actor_id)
);

CREATE INDEX workspace_member_actor_idx ON workspace_member (actor_id);
-- Exactly one owner per workspace.
CREATE UNIQUE INDEX workspace_one_owner ON workspace_member (workspace_id) WHERE role = 'owner';

CREATE TABLE workspace_node (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  parent_id    uuid REFERENCES workspace_node(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('folder', 'file')),
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255 AND name !~ '[/\\]'),
  mime         text,
  size         bigint NOT NULL DEFAULT 0,
  -- Binary uploads live on disk (<WORKSPACE_DIR>/<workspace>/<node>); text
  -- files are collaborative Yjs docs kept here.
  storage_key  text,
  ydoc         bytea,
  text_content text,
  created_by   uuid REFERENCES actor(id),
  updated_by   uuid REFERENCES actor(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Siblings must have distinct names (case-insensitive). COALESCE because NULL
-- parents (workspace root) never collide under a plain unique index.
CREATE UNIQUE INDEX workspace_node_sibling_name
  ON workspace_node (workspace_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
CREATE INDEX workspace_node_ws_idx ON workspace_node (workspace_id);
