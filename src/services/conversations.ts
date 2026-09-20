import { pool, withTransaction } from "../db.js";
import { HttpError } from "./httpError.js";
import { publish } from "./events.js";
import { getActorSummaries } from "./viewModels.js";
import type { ActorSummary } from "../types.js";

export type ConversationState = "requested" | "accepted" | "declined";

export interface ConversationView {
  id: string;
  state: ConversationState;
  // true when the *other* person started it and it is waiting on me.
  incomingRequest: boolean;
  counterparty: ActorSummary;
  lastMessage: { body: string; senderId: string; createdAt: string } | null;
  unread: number;
  updatedAt: string;
}

export interface MessageView {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
}

const MAX_BODY = 4000;
const SEND_LIMIT = 30; // per actor per minute
const sends = new Map<string, number[]>();

function checkSendRate(actorId: string): void {
  const now = Date.now();
  const recent = (sends.get(actorId) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= SEND_LIMIT) throw new HttpError(429, "rate_limited");
  recent.push(now);
  sends.set(actorId, recent);
}

interface IntroRow {
  id: string;
  requester_id: string;
  target_id: string;
  state: ConversationState | "suggested";
}

async function loadForParticipant(actorId: string, id: string): Promise<IntroRow> {
  // uuid cast failures must look like "not found", not a 500.
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "not_found");
  const { rows } = await pool.query<IntroRow>(
    `SELECT id, requester_id, target_id, state FROM intro
     WHERE id = $1 AND (requester_id = $2 OR target_id = $2)`,
    [id, actorId],
  );
  // Non-participants get 404, never 403: don't reveal that a thread exists.
  if (!rows[0]) throw new HttpError(404, "not_found");
  return rows[0];
}

const other = (row: IntroRow, me: string) => (row.requester_id === me ? row.target_id : row.requester_id);

export async function listConversations(actorId: string): Promise<ConversationView[]> {
  const { rows } = await pool.query(
    `SELECT i.id, i.state, i.requester_id, i.target_id, i.updated_at,
            lm.body AS last_body, lm.sender_id AS last_sender, lm.created_at AS last_at,
            (SELECT count(*) FROM message m
              WHERE m.intro_id = i.id AND m.sender_id <> $1
                AND m.id > COALESCE(r.last_read_message_id, 0)) AS unread
     FROM intro i
     LEFT JOIN intro_read r ON r.intro_id = i.id AND r.actor_id = $1
     LEFT JOIN LATERAL (
       SELECT body, sender_id, created_at FROM message WHERE intro_id = i.id ORDER BY id DESC LIMIT 1
     ) lm ON true
     WHERE (i.requester_id = $1 OR i.target_id = $1)
       AND i.state IN ('requested', 'accepted')
       AND EXISTS (SELECT 1 FROM message WHERE intro_id = i.id)
     ORDER BY COALESCE(lm.created_at, i.updated_at) DESC`,
    [actorId],
  );
  const ids = rows.map((r) => (r.requester_id === actorId ? r.target_id : r.requester_id));
  const summaries = await getActorSummaries(ids);
  const out: ConversationView[] = [];
  for (const r of rows) {
    const cp = summaries.get(r.requester_id === actorId ? r.target_id : r.requester_id);
    if (!cp) continue;
    out.push({
      id: r.id,
      state: r.state,
      incomingRequest: r.state === "requested" && r.target_id === actorId,
      counterparty: cp,
      lastMessage: r.last_body
        ? { body: r.last_body, senderId: r.last_sender, createdAt: r.last_at.toISOString() }
        : null,
      unread: Number(r.unread),
      updatedAt: r.updated_at.toISOString(),
    });
  }
  return out;
}

export async function listMessages(
  actorId: string,
  conversationId: string,
  opts: { before?: string; limit?: number } = {},
): Promise<{ state: ConversationState; counterpartyId: string; incomingRequest: boolean; messages: MessageView[] }> {
  const row = await loadForParticipant(actorId, conversationId);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const before = opts.before && /^\d+$/.test(opts.before) ? opts.before : null;
  const { rows } = await pool.query(
    `SELECT id, sender_id, body, created_at FROM message
     WHERE intro_id = $1 AND ($2::bigint IS NULL OR id < $2::bigint)
     ORDER BY id DESC LIMIT $3`,
    [conversationId, before, limit],
  );
  return {
    state: row.state as ConversationState,
    counterpartyId: other(row, actorId),
    incomingRequest: row.state === "requested" && row.target_id === actorId,
    messages: rows.reverse().map((m) => ({
      id: String(m.id),
      senderId: m.sender_id,
      body: m.body,
      createdAt: m.created_at.toISOString(),
    })),
  };
}

function cleanBody(raw: unknown): string {
  if (typeof raw !== "string") throw new HttpError(400, "message_required");
  const body = raw.trim();
  if (body.length < 1) throw new HttpError(400, "message_required");
  if (body.length > MAX_BODY) throw new HttpError(400, "message_too_long");
  return body;
}

// A person can be messaged only if discoverable and able to log in — a
// message to someone with no credential would sit unread forever.
async function assertReachable(targetId: string): Promise<void> {
  const { rows } = await pool.query(
    `SELECT 1 FROM actor a JOIN credential c ON c.actor_id = a.id
     WHERE a.id = $1 AND a.kind = 'person' AND a.discoverable = true`,
    [targetId],
  );
  if (!rows[0]) throw new HttpError(404, "not_found");
}

async function insertMessage(
  client: { query: typeof pool.query },
  conversationId: string,
  senderId: string,
  body: string,
): Promise<MessageView> {
  const { rows } = await client.query(
    `INSERT INTO message (intro_id, sender_id, body) VALUES ($1, $2, $3) RETURNING id, created_at`,
    [conversationId, senderId, body],
  );
  // The sender has by definition read up to their own message.
  await client.query(
    `INSERT INTO intro_read (intro_id, actor_id, last_read_message_id) VALUES ($1, $2, $3)
     ON CONFLICT (intro_id, actor_id) DO UPDATE SET last_read_message_id = GREATEST(intro_read.last_read_message_id, $3)`,
    [conversationId, senderId, rows[0].id],
  );
  await client.query(`UPDATE intro SET updated_at = now() WHERE id = $1`, [conversationId]);
  return { id: String(rows[0].id), senderId, body, createdAt: rows[0].created_at.toISOString() };
}

// Start a conversation with `targetId` (first message = the request) or, if a
// thread already exists, just send into it. Consent rules:
//  - new pair            -> request, target must accept
//  - I already asked     -> only that first message is allowed until accepted
//  - they asked me       -> replying accepts
//  - they declined me    -> blocked; if *I* declined them, writing to them re-opens
export async function startOrSend(
  actorId: string,
  targetId: string,
  rawBody: unknown,
): Promise<{ conversationId: string; state: ConversationState; message: MessageView }> {
  const body = cleanBody(rawBody);
  if (targetId === actorId) throw new HttpError(400, "cannot_message_self");
  checkSendRate(actorId);

  const result = await withTransaction(async (client) => {
    const found = await client.query<IntroRow>(
      `SELECT id, requester_id, target_id, state FROM intro
       WHERE least(requester_id, target_id) = least($1::uuid, $2::uuid)
         AND greatest(requester_id, target_id) = greatest($1::uuid, $2::uuid)
       FOR UPDATE`,
      [actorId, targetId],
    );
    let row = found.rows[0];
    let isRequest = false;

    if (!row) {
      await assertReachable(targetId); // only brand-new threads need a discoverable target
      const ins = await client.query<IntroRow>(
        `INSERT INTO intro (requester_id, target_id, state) VALUES ($1, $2, 'requested')
         RETURNING id, requester_id, target_id, state`,
        [actorId, targetId],
      );
      row = ins.rows[0];
      isRequest = true;
    } else if (row.state === "accepted") {
      // plain send
    } else if (row.state === "requested" || row.state === "suggested") {
      if (row.requester_id === actorId && row.state === "requested") {
        throw new HttpError(409, "request_pending");
      }
      if (row.requester_id === actorId) {
        // a `suggested` row of mine that never became a real request
        await client.query(`UPDATE intro SET state = 'requested' WHERE id = $1`, [row.id]);
        row.state = "requested";
        isRequest = true;
      } else {
        await client.query(`UPDATE intro SET state = 'accepted' WHERE id = $1`, [row.id]);
        row.state = "accepted";
      }
    } else if (row.state === "declined") {
      if (row.requester_id === actorId) throw new HttpError(403, "request_declined");
      // I declined them earlier and now write to them: that's an opt-in.
      await client.query(`UPDATE intro SET state = 'accepted' WHERE id = $1`, [row.id]);
      row.state = "accepted";
    }

    const message = await insertMessage(client, row.id, actorId, body);
    return { row, message, isRequest };
  });

  publish([actorId, targetId], { type: result.isRequest ? "request" : "message", conversationId: result.row.id });
  return { conversationId: result.row.id, state: result.row.state as ConversationState, message: result.message };
}

export async function sendMessage(actorId: string, conversationId: string, rawBody: unknown): Promise<MessageView> {
  const body = cleanBody(rawBody);
  const row = await loadForParticipant(actorId, conversationId);
  if (row.state === "declined") throw new HttpError(403, row.requester_id === actorId ? "request_declined" : "conversation_declined");
  if (row.state === "requested" && row.requester_id === actorId) throw new HttpError(409, "request_pending");
  checkSendRate(actorId);

  const message = await withTransaction(async (client) => {
    // A reply to a pending request is an implicit accept.
    if (row.state !== "accepted") await client.query(`UPDATE intro SET state = 'accepted' WHERE id = $1`, [row.id]);
    return insertMessage(client, row.id, actorId, body);
  });
  publish([row.requester_id, row.target_id], { type: "message", conversationId: row.id });
  return message;
}

export async function respond(actorId: string, conversationId: string, accept: boolean): Promise<ConversationState> {
  const row = await loadForParticipant(actorId, conversationId);
  if (row.target_id !== actorId || row.state !== "requested") throw new HttpError(409, "not_pending_for_you");
  const state: ConversationState = accept ? "accepted" : "declined";
  await pool.query(`UPDATE intro SET state = $2, updated_at = now() WHERE id = $1`, [row.id, state]);
  publish([row.requester_id, row.target_id], { type: "conversation_update", conversationId: row.id });
  return state;
}

export async function markRead(actorId: string, conversationId: string): Promise<void> {
  const row = await loadForParticipant(actorId, conversationId);
  await pool.query(
    `INSERT INTO intro_read (intro_id, actor_id, last_read_message_id)
     VALUES ($1, $2, COALESCE((SELECT max(id) FROM message WHERE intro_id = $1), 0))
     ON CONFLICT (intro_id, actor_id) DO UPDATE
       SET last_read_message_id = GREATEST(intro_read.last_read_message_id, EXCLUDED.last_read_message_id)`,
    [row.id, actorId],
  );
}

// People I have an accepted conversation with — the only pool a workspace
// invite may draw from (consent already established, no user directory).
export async function acceptedCounterparties(actorId: string): Promise<string[]> {
  const { rows } = await pool.query<{ other: string }>(
    `SELECT CASE WHEN requester_id = $1 THEN target_id ELSE requester_id END AS other
     FROM intro WHERE (requester_id = $1 OR target_id = $1) AND state = 'accepted'`,
    [actorId],
  );
  return rows.map((r) => r.other);
}
