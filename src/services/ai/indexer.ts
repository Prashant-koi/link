import { createHash } from "node:crypto";
import { pool } from "../../db.js";
import { embed } from "../../modelRuntime.js";

// Builds and refreshes the retrieval index (ai_chunk) for the conversations and
// workspaces a chat has attached. It is lazy and incremental: each source is
// re-chunked on demand, and only chunks whose text changed are re-embedded, so a
// question against unchanged material costs no embedding work at all.

export interface SourceRef {
  kind: "conversation" | "workspace";
  refId: string;
}

const CHAT_WINDOW = 10; // messages per chunk
const CHAT_STRIDE = 8; // so neighbouring windows overlap by two
const FILE_CHUNK = 1200; // characters
const FILE_OVERLAP = 150;

const sha = (s: string) => createHash("sha1").update(s).digest("hex");

interface Chunk {
  nodeId: string | null;
  content: string;
  meta: Record<string, unknown>;
}

const fmtStamp = (d: Date) =>
  d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: false, timeZone: "America/New_York" });

async function chatChunks(conversationId: string): Promise<Chunk[]> {
  const { rows } = await pool.query(
    `SELECT m.id, m.body, m.created_at, a.display_name
     FROM message m JOIN actor a ON a.id = m.sender_id
     WHERE m.intro_id = $1 ORDER BY m.id`,
    [conversationId],
  );
  if (rows.length === 0) return [];
  const names = [...new Set(rows.map((r) => r.display_name as string))];
  const out: Chunk[] = [];
  for (let i = 0; i < rows.length; i += CHAT_STRIDE) {
    const win = rows.slice(i, i + CHAT_WINDOW);
    out.push({
      nodeId: null,
      content: win.map((r) => `[${fmtStamp(r.created_at)}] ${r.display_name}: ${r.body}`).join("\n"),
      meta: {
        participants: names,
        from: win[0].created_at.toISOString(),
        to: win[win.length - 1].created_at.toISOString(),
        firstMessageId: String(win[0].id),
        lastMessageId: String(win[win.length - 1].id),
      },
    });
    if (i + CHAT_WINDOW >= rows.length) break;
  }
  return out;
}

// Prefer breaking on blank lines / headings so a chunk reads as a unit.
function splitText(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean.length <= FILE_CHUNK) return clean ? [clean] : [];
  const parts: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + FILE_CHUNK);
    if (end < clean.length) {
      const cut = Math.max(clean.lastIndexOf("\n\n", end), clean.lastIndexOf("\n#", end));
      if (cut > start + FILE_CHUNK * 0.5) end = cut;
    }
    parts.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(end - FILE_OVERLAP, start + 1);
  }
  return parts.filter(Boolean);
}

async function fileChunks(workspaceId: string): Promise<Chunk[]> {
  const { rows } = await pool.query(
    `WITH RECURSIVE tree AS (
       SELECT id, parent_id, name, name::text AS path FROM workspace_node WHERE workspace_id = $1 AND parent_id IS NULL
       UNION ALL
       SELECT n.id, n.parent_id, n.name, tree.path || '/' || n.name
       FROM workspace_node n JOIN tree ON n.parent_id = tree.id WHERE n.workspace_id = $1
     )
     SELECT n.id, tree.path, n.text_content, n.updated_at
     FROM workspace_node n JOIN tree ON tree.id = n.id
     WHERE n.workspace_id = $1 AND n.kind = 'file' AND n.storage_key IS NULL
       AND n.text_content IS NOT NULL AND n.text_content <> ''`,
    [workspaceId],
  );
  const out: Chunk[] = [];
  for (const r of rows) {
    const pieces = splitText(r.text_content as string);
    pieces.forEach((piece, i) =>
      out.push({
        nodeId: r.id,
        // The path heads every chunk so a piece from the middle of a file still
        // says where it came from (and matches a question that names the file).
        content: `File: ${r.path}${pieces.length > 1 ? ` (part ${i + 1}/${pieces.length})` : ""}\n${piece}`,
        meta: { path: r.path, part: i + 1, parts: pieces.length, updatedAt: (r.updated_at as Date).toISOString() },
      }),
    );
  }
  return out;
}

const toVector = (v: number[]) => `[${v.join(",")}]`;
const inFlight = new Map<string, Promise<void>>();

async function syncSource(kind: "chat" | "file", refId: string, chunks: Chunk[]): Promise<{ embedded: number }> {
  const existing = await pool.query<{ id: string; node_id: string | null; chunk_idx: number; content_hash: string }>(
    `SELECT id, node_id, chunk_idx, content_hash FROM ai_chunk WHERE kind = $1 AND ref_id = $2`,
    [kind, refId],
  );
  const key = (node: string | null, idx: number) => `${node ?? "-"}:${idx}`;
  const have = new Map(existing.rows.map((r) => [key(r.node_id, r.chunk_idx), r]));

  // chunk_idx counts per node (or per conversation), matching the unique index.
  const perNode = new Map<string, number>();
  const wanted = chunks.map((c) => {
    const n = c.nodeId ?? "-";
    const idx = perNode.get(n) ?? 0;
    perNode.set(n, idx + 1);
    return { ...c, idx, hash: sha(c.content) };
  });

  const stale = wanted.filter((w) => have.get(key(w.nodeId, w.idx))?.content_hash !== w.hash);
  for (let i = 0; i < stale.length; i += 64) {
    const batch = stale.slice(i, i + 64);
    const vectors = await embed(batch.map((b) => b.content), "document");
    for (let j = 0; j < batch.length; j++) {
      const b = batch[j];
      await pool.query(
        `INSERT INTO ai_chunk (kind, ref_id, node_id, chunk_idx, content, content_hash, meta, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::vector)
         ON CONFLICT (kind, ref_id, COALESCE(node_id, '00000000-0000-0000-0000-000000000000'::uuid), chunk_idx)
         DO UPDATE SET content = EXCLUDED.content, content_hash = EXCLUDED.content_hash,
                       meta = EXCLUDED.meta, embedding = EXCLUDED.embedding, updated_at = now()`,
        [kind, refId, b.nodeId, b.idx, b.content, b.hash, JSON.stringify(b.meta), toVector(vectors[j])],
      );
    }
  }

  // Anything indexed that no longer exists (deleted file, shorter file).
  const keep = new Set(wanted.map((w) => key(w.nodeId, w.idx)));
  const gone = existing.rows.filter((r) => !keep.has(key(r.node_id, r.chunk_idx))).map((r) => r.id);
  if (gone.length) await pool.query(`DELETE FROM ai_chunk WHERE id = ANY($1::bigint[])`, [gone]);
  return { embedded: stale.length };
}

/** Bring the index up to date for every source. Safe to call concurrently. */
export async function ensureIndexed(sources: SourceRef[]): Promise<number> {
  let embedded = 0;
  await Promise.all(
    sources.map(async (s) => {
      const id = `${s.kind}:${s.refId}`;
      const running = inFlight.get(id);
      if (running) return running;
      const job = (async () => {
        if (s.kind === "conversation") embedded += (await syncSource("chat", s.refId, await chatChunks(s.refId))).embedded;
        else embedded += (await syncSource("file", s.refId, await fileChunks(s.refId))).embedded;
      })().finally(() => inFlight.delete(id));
      inFlight.set(id, job);
      return job;
    }),
  );
  return embedded;
}

/** Drop everything indexed for a deleted workspace or node. */
export async function dropWorkspaceChunks(workspaceId: string): Promise<void> {
  await pool.query(`DELETE FROM ai_chunk WHERE kind = 'file' AND ref_id = $1`, [workspaceId]);
}
