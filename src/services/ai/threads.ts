import type { Response } from "express";
import { config } from "../../config.js";
import { pool } from "../../db.js";
import { streamChat } from "../../modelRuntime.js";
import { HttpError } from "../httpError.js";
import { buildPrompt, PROMPT_VERSION, retrieve, type AttachedSource, type UiSource } from "./context.js";
import { ensureIndexed } from "./indexer.js";

const UUID = /^[0-9a-f-]{36}$/i;
const MAX_QUESTION = 2000;
const RATE_MAX = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const asks = new Map<string, number[]>();
const inFlight = new Set<string>();

export interface AiThreadView {
  id: string;
  title: string;
  updatedAt: string;
  lastMessage: string | null;
  sourceCount: number;
}
export interface AiSourceView {
  kind: "conversation" | "workspace";
  refId: string;
  label: string;
}
export interface AiMessageView {
  id: string;
  role: "user" | "assistant";
  body: string;
  sources: UiSource[];
  createdAt: string;
}

async function ownThread(actorId: string, id: string) {
  if (!UUID.test(id)) throw new HttpError(404, "not_found");
  const { rows } = await pool.query(`SELECT id, title, updated_at FROM ai_thread WHERE id = $1 AND owner_id = $2`, [id, actorId]);
  if (!rows[0]) throw new HttpError(404, "not_found"); // other people's AI chats don't exist
  return rows[0] as { id: string; title: string; updated_at: Date };
}

/** Everything this person could attach: accepted chats and workspaces they are an active member of. */
export async function listAttachable(actorId: string): Promise<{
  conversations: (AiSourceView & { messageCount: number; lastAt: string | null })[];
  workspaces: (AiSourceView & { fileCount: number })[];
}> {
  const convs = await pool.query(
    `SELECT i.id, o.display_name, count(m.id) AS n, max(m.created_at) AS last
     FROM intro i
     JOIN actor o ON o.id = CASE WHEN i.requester_id = $1 THEN i.target_id ELSE i.requester_id END
     LEFT JOIN message m ON m.intro_id = i.id
     WHERE (i.requester_id = $1 OR i.target_id = $1) AND i.state = 'accepted'
     GROUP BY i.id, o.display_name HAVING count(m.id) > 0 ORDER BY max(m.created_at) DESC`,
    [actorId],
  );
  const wss = await pool.query(
    `SELECT w.id, w.name, (SELECT count(*) FROM workspace_node n WHERE n.workspace_id = w.id AND n.kind = 'file') AS files
     FROM workspace_member m JOIN workspace w ON w.id = m.workspace_id
     WHERE m.actor_id = $1 AND m.state = 'active' ORDER BY w.updated_at DESC`,
    [actorId],
  );
  return {
    conversations: convs.rows.map((r) => ({
      kind: "conversation" as const,
      refId: r.id,
      label: `Chat with ${r.display_name}`,
      messageCount: Number(r.n),
      lastAt: r.last ? (r.last as Date).toISOString() : null,
    })),
    workspaces: wss.rows.map((r) => ({ kind: "workspace" as const, refId: r.id, label: r.name, fileCount: Number(r.files) })),
  };
}

/** Attached sources that the owner can STILL access right now. */
async function validSources(actorId: string, threadId: string): Promise<{ valid: AttachedSource[]; dropped: number }> {
  const { rows } = await pool.query(`SELECT kind, ref_id FROM ai_thread_source WHERE thread_id = $1`, [threadId]);
  const attachable = await listAttachable(actorId);
  const ok = new Map<string, AttachedSource>();
  for (const c of attachable.conversations) ok.set(`conversation:${c.refId}`, { kind: "conversation", refId: c.refId, label: c.label });
  for (const w of attachable.workspaces) ok.set(`workspace:${w.refId}`, { kind: "workspace", refId: w.refId, label: w.label });
  const valid = rows.map((r) => ok.get(`${r.kind}:${r.ref_id}`)).filter((x): x is AttachedSource => !!x);
  return { valid, dropped: rows.length - valid.length };
}

export async function listThreads(actorId: string): Promise<AiThreadView[]> {
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.updated_at,
            (SELECT left(body, 90) FROM ai_message m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last,
            (SELECT count(*) FROM ai_thread_source s WHERE s.thread_id = t.id) AS sources
     FROM ai_thread t WHERE t.owner_id = $1 ORDER BY t.updated_at DESC`,
    [actorId],
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    updatedAt: r.updated_at.toISOString(),
    lastMessage: r.last,
    sourceCount: Number(r.sources),
  }));
}

export async function createThread(actorId: string, sources: unknown): Promise<{ id: string }> {
  const { rows } = await pool.query(`INSERT INTO ai_thread (owner_id) VALUES ($1) RETURNING id`, [actorId]);
  if (Array.isArray(sources) && sources.length) await setSources(actorId, rows[0].id, sources);
  return { id: rows[0].id };
}

export async function getThread(actorId: string, id: string) {
  const t = await ownThread(actorId, id);
  const { valid, dropped } = await validSources(actorId, id);
  return {
    id: t.id,
    title: t.title,
    sources: valid.map((s): AiSourceView => ({ kind: s.kind, refId: s.refId, label: s.label })),
    droppedSources: dropped,
  };
}

export async function setSources(actorId: string, id: string, raw: unknown): Promise<void> {
  await ownThread(actorId, id);
  if (!Array.isArray(raw) || raw.length > 20) throw new HttpError(400, "invalid_sources");
  const attachable = await listAttachable(actorId);
  const allowed = new Set([
    ...attachable.conversations.map((c) => `conversation:${c.refId}`),
    ...attachable.workspaces.map((w) => `workspace:${w.refId}`),
  ]);
  const wanted: { kind: string; refId: string }[] = [];
  for (const s of raw as { kind?: unknown; refId?: unknown }[]) {
    if ((s.kind !== "conversation" && s.kind !== "workspace") || typeof s.refId !== "string" || !UUID.test(s.refId)) throw new HttpError(400, "invalid_sources");
    // Not yours to attach -> the same answer as "doesn't exist".
    if (!allowed.has(`${s.kind}:${s.refId}`)) throw new HttpError(404, "not_found");
    wanted.push({ kind: s.kind, refId: s.refId });
  }
  await pool.query(`DELETE FROM ai_thread_source WHERE thread_id = $1`, [id]);
  for (const s of wanted) {
    await pool.query(`INSERT INTO ai_thread_source (thread_id, kind, ref_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [id, s.kind, s.refId]);
  }
  await pool.query(`UPDATE ai_thread SET updated_at = now() WHERE id = $1`, [id]);
}

export async function renameThread(actorId: string, id: string, title: unknown): Promise<void> {
  await ownThread(actorId, id);
  if (typeof title !== "string" || !title.trim() || title.trim().length > 120) throw new HttpError(400, "invalid_title");
  await pool.query(`UPDATE ai_thread SET title = $2 WHERE id = $1`, [id, title.trim()]);
}

export async function deleteThread(actorId: string, id: string): Promise<void> {
  await ownThread(actorId, id);
  await pool.query(`DELETE FROM ai_thread WHERE id = $1`, [id]);
}

export async function listMessages(actorId: string, id: string): Promise<AiMessageView[]> {
  await ownThread(actorId, id);
  const { rows } = await pool.query(`SELECT id, role, body, sources, created_at FROM ai_message WHERE thread_id = $1 ORDER BY id`, [id]);
  return rows.map((r) => ({ id: String(r.id), role: r.role, body: r.body, sources: r.sources, createdAt: r.created_at.toISOString() }));
}

function checkRate(actorId: string): void {
  const now = Date.now();
  const recent = (asks.get(actorId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) throw new HttpError(429, "rate_limited");
  recent.push(now);
  asks.set(actorId, recent);
}

/**
 * Answer a question, streaming server-sent events:
 *   status {text}   progress ("Reading your sources…")
 *   sources [..]    the excerpts the answer is based on, numbered for [S#] citations
 *   token {text}    a piece of the answer
 *   done {id}       finished (the saved assistant message id)
 *   error {code}
 * Failures before the stream starts are ordinary HTTP errors.
 */
export async function answer(actorId: string, threadId: string, rawText: unknown, res: Response): Promise<void> {
  const thread = await ownThread(actorId, threadId);
  if (typeof rawText !== "string" || !rawText.trim()) throw new HttpError(400, "message_required");
  const question = rawText.trim();
  if (question.length > MAX_QUESTION) throw new HttpError(400, "message_too_long");
  if (!config.llm.baseUrl) throw new HttpError(503, "model_unavailable");
  if (inFlight.has(threadId)) throw new HttpError(409, "already_answering");
  checkRate(actorId);
  inFlight.add(threadId);

  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  let answerText = "";
  let ui: UiSource[] = [];
  const started = Date.now();
  try {
    const history = (await pool.query(`SELECT role, body FROM ai_message WHERE thread_id = $1 ORDER BY id DESC LIMIT 8`, [threadId])).rows.reverse();
    await pool.query(`INSERT INTO ai_message (thread_id, role, body) VALUES ($1, 'user', $2)`, [threadId, question]);
    if (thread.title === "New chat") {
      await pool.query(`UPDATE ai_thread SET title = $2 WHERE id = $1`, [threadId, question.replace(/\s+/g, " ").slice(0, 60)]);
    }

    const { valid, dropped } = await validSources(actorId, threadId);
    if (dropped > 0) send("status", { text: `${dropped} attached source${dropped > 1 ? "s are" : " is"} no longer accessible and was skipped.` });
    send("status", { text: valid.length ? "Reading your sources…" : "No sources attached — answering without them." });

    const embedded = valid.length ? await ensureIndexed(valid) : 0;
    if (embedded > 0) send("status", { text: `Indexed ${embedded} new passages.` });

    const excerpts = await retrieve(question, valid);
    const viewer = (await pool.query(`SELECT display_name FROM actor WHERE id = $1`, [actorId])).rows[0]?.display_name ?? "the user";
    const prompt = await buildPrompt({ viewerName: viewer, question, history, sources: valid, excerpts });
    ui = prompt.ui;
    send("sources", ui);
    send("status", { text: "Thinking…" });

    let promptTokens = 0;
    let outputTokens = 0;
    let firstTokenAt = 0;
    for await (const ev of streamChat(prompt.messages, { signal: controller.signal })) {
      if (ev.delta) {
        if (!firstTokenAt) firstTokenAt = Date.now();
        answerText += ev.delta;
        send("token", { text: ev.delta });
      }
      if (ev.done) {
        promptTokens = ev.promptTokens ?? 0;
        outputTokens = ev.outputTokens ?? 0;
      }
    }
    const saved = await saveAnswer(threadId, answerText, ui);
    send("done", { id: saved, promptTokens, outputTokens, firstTokenMs: firstTokenAt ? firstTokenAt - started : null, promptVersion: PROMPT_VERSION });
  } catch (err) {
    // A stopped answer keeps whatever was written so far.
    if (answerText.trim()) await saveAnswer(threadId, answerText, ui).catch(() => {});
    if (!controller.signal.aborted) {
      console.error("ai answer failed:", err);
      send("error", { code: "generation_failed" });
    }
  } finally {
    inFlight.delete(threadId);
    res.end();
  }
}

async function saveAnswer(threadId: string, body: string, ui: UiSource[]): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO ai_message (thread_id, role, body, sources, model) VALUES ($1, 'assistant', $2, $3::jsonb, $4) RETURNING id`,
    [threadId, body.trim() || "(no answer)", JSON.stringify(ui), config.llm.instructModel],
  );
  await pool.query(`UPDATE ai_thread SET updated_at = now() WHERE id = $1`, [threadId]);
  return String(rows[0].id);
}
