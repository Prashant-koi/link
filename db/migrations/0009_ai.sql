-- AI assistant in Collaborations: private chats with the local model, each with
-- a set of attached sources (message threads and workspaces the owner can
-- access), plus a retrieval index over those sources.

CREATE TABLE ai_thread (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES actor(id),
  title      text NOT NULL DEFAULT 'New chat' CHECK (char_length(title) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_thread_owner_idx ON ai_thread (owner_id, updated_at DESC);

-- What this chat may read. Access is re-checked against the real tables on
-- every question, so a row here is a wish, never a permission.
CREATE TABLE ai_thread_source (
  thread_id uuid NOT NULL REFERENCES ai_thread(id) ON DELETE CASCADE,
  kind      text NOT NULL CHECK (kind IN ('conversation', 'workspace')),
  ref_id    uuid NOT NULL,
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, kind, ref_id)
);

CREATE TABLE ai_message (
  id         bigserial PRIMARY KEY,
  thread_id  uuid NOT NULL REFERENCES ai_thread(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('user', 'assistant')),
  body       text NOT NULL,
  -- Excerpts the answer was based on, numbered so the text can cite [S1].
  sources    jsonb NOT NULL DEFAULT '[]',
  model      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_message_thread_idx ON ai_message (thread_id, id);

-- Retrieval index: windows of a conversation and pieces of workspace text
-- files, embedded with the same 768-d model as concepts. Rebuilt lazily when
-- the source changes (content_hash), so no background job is needed.
CREATE TABLE ai_chunk (
  id           bigserial PRIMARY KEY,
  kind         text NOT NULL CHECK (kind IN ('chat', 'file')),
  ref_id       uuid NOT NULL,      -- the conversation (intro) or workspace
  node_id      uuid,               -- the file, for kind = 'file'
  chunk_idx    integer NOT NULL,
  content      text NOT NULL,
  content_hash text NOT NULL,
  meta         jsonb NOT NULL DEFAULT '{}',
  embedding    vector(768),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ai_chunk_unique
  ON ai_chunk (kind, ref_id, COALESCE(node_id, '00000000-0000-0000-0000-000000000000'::uuid), chunk_idx);
CREATE INDEX ai_chunk_ref_idx ON ai_chunk (kind, ref_id);
