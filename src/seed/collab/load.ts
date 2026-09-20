// Loads John Doe's seeded collaboration story (generated fixtures under
// db/seed-data/collab-story/) into the database. Idempotent: it removes only
// the rows it created (chats with the cast, and the three story workspaces) and
// writes them again, with timestamps anchored on STORY_END.
//
//   npx tsx src/seed/collab/load.ts [--no-index]

import fs from "node:fs/promises";
import path from "node:path";
import { pool, withTransaction } from "../../db.js";
import { ensureIndexed } from "../../services/ai/indexer.js";
import { BIBLE as _unused, CAST, STORY_END } from "./bible.js";
import type { ChatMessage } from "./generate.js";
import { THREADS } from "./threads.js";
import { WORKSPACES } from "./workspaces.js";

void _unused;
const DIR = path.resolve("db/seed-data/collab-story");
const END = new Date(STORY_END).getTime();
const MIN = 60_000;

async function actorIds(): Promise<Map<string, string>> {
  const { rows } = await pool.query<{ username: string; actor_id: string }>(`SELECT username, actor_id FROM credential`);
  const byUser = new Map(rows.map((r) => [r.username, r.actor_id]));
  const out = new Map<string, string>();
  for (const p of Object.values(CAST)) {
    const id = byUser.get(p.username);
    if (!id) throw new Error(`no login for ${p.username} — is the base seed loaded?`);
    out.set(p.key, id);
  }
  return out;
}

/** Local (EDT) wall-clock -> instant, `day` days before the story's end. */
function at(day: number, hour: number): number {
  const d = new Date(END);
  d.setUTCDate(d.getUTCDate() - day);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return new Date(`${y}-${m}-${dd}T${String(hour % 24).padStart(2, "0")}:00:00-04:00`).getTime() + Math.floor(hour / 24) * 86400000;
}

async function readChat(other: string, id: string): Promise<ChatMessage[]> {
  const file = path.join(DIR, "chats", other, `${id}.json`);
  return (JSON.parse(await fs.readFile(file, "utf8")) as { messages: ChatMessage[] }).messages;
}

async function main() {
  const index = !process.argv.includes("--no-index");
  const ids = await actorIds();
  const john = ids.get("john")!;

  // Load everything from disk first: fail before touching the database.
  const threads: { def: (typeof THREADS)[number]; messages: { from: string; text: string; at: number }[] }[] = [];
  for (const t of THREADS) {
    const messages: { from: string; text: string; at: number }[] = [];
    let cursor = 0;
    for (const seg of t.segments) {
      const chat = await readChat(t.other, seg.id);
      let time = Math.max(at(seg.day, seg.hour), cursor + 20 * MIN);
      chat.forEach((m, i) => {
        time += i === 0 ? 0 : Math.max(1, m.gap) * MIN + ((i * 7919) % 45) * 1000; // small deterministic jitter
        messages.push({ from: m.from, text: m.text, at: Math.min(time, END - MIN) });
      });
      cursor = time;
    }
    // Strictly increasing, whatever the gaps did.
    for (let i = 1; i < messages.length; i++) if (messages[i].at <= messages[i - 1].at) messages[i].at = messages[i - 1].at + 1000;
    threads.push({ def: t, messages });
  }
  const workspaces: { w: (typeof WORKSPACES)[number]; files: { f: (typeof WORKSPACES)[number]["files"][number]; text: string }[] }[] = [];
  for (const w of WORKSPACES) {
    const files: { f: (typeof WORKSPACES)[number]["files"][number]; text: string }[] = [];
    for (const f of w.files) files.push({ f, text: await fs.readFile(path.join(DIR, "workspaces", w.slug, f.path), "utf8") });
    workspaces.push({ w, files });
  }

  const counts = { intros: 0, messages: 0, workspaces: 0, files: 0 };
  await withTransaction(async (c) => {
    // Remove a previous load of the story (and only that).
    for (const t of THREADS) {
      const other = ids.get(t.other)!;
      const old = await c.query(
        `SELECT id FROM intro WHERE least(requester_id, target_id) = least($1::uuid, $2::uuid) AND greatest(requester_id, target_id) = greatest($1::uuid, $2::uuid)`,
        [john, other],
      );
      for (const r of old.rows) {
        await c.query(`DELETE FROM ai_chunk WHERE kind = 'chat' AND ref_id = $1`, [r.id]);
        await c.query(`DELETE FROM ai_thread_source WHERE kind = 'conversation' AND ref_id = $1`, [r.id]);
        await c.query(`DELETE FROM intro WHERE id = $1`, [r.id]); // cascades messages + read cursors
      }
    }
    for (const w of WORKSPACES) {
      const old = await c.query(`SELECT id FROM workspace WHERE name = $1 AND created_by = $2`, [w.name, ids.get(w.owner)!]);
      for (const r of old.rows) {
        await c.query(`DELETE FROM ai_chunk WHERE kind = 'file' AND ref_id = $1`, [r.id]);
        await c.query(`DELETE FROM ai_thread_source WHERE kind = 'workspace' AND ref_id = $1`, [r.id]);
        await c.query(`DELETE FROM workspace WHERE id = $1`, [r.id]);
      }
    }

    for (const { def, messages } of threads) {
      const other = ids.get(def.other)!;
      const requester = def.opener === "john" ? john : other;
      const target = def.opener === "john" ? other : john;
      const pending = def.other === "zoe" || def.other === "hiro";
      const intro = await c.query(
        `INSERT INTO intro (requester_id, target_id, state, created_at, updated_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [requester, target, pending ? "requested" : "accepted", new Date(messages[0].at), new Date(messages[messages.length - 1].at)],
      );
      const introId = intro.rows[0].id as string;
      const insertedIds: string[] = [];
      for (const m of messages) {
        const r = await c.query(
          `INSERT INTO message (intro_id, sender_id, body, created_at) VALUES ($1, $2, $3, $4) RETURNING id`,
          [introId, m.from === "john" ? john : other, m.text, new Date(m.at)],
        );
        insertedIds.push(r.rows[0].id);
      }
      counts.intros++;
      counts.messages += messages.length;

      // John's read cursor: everything except the last `unread` messages (which are the other person's).
      // A pending request John has not opened has no cursor at all.
      if (!(def.other === "zoe")) {
        const unread = def.unread ?? 0;
        const lastRead = unread >= insertedIds.length ? 0 : insertedIds[insertedIds.length - 1 - unread];
        await c.query(`INSERT INTO intro_read (intro_id, actor_id, last_read_message_id) VALUES ($1, $2, $3)`, [introId, john, lastRead]);
      }
      if (!pending) {
        await c.query(`INSERT INTO intro_read (intro_id, actor_id, last_read_message_id) VALUES ($1, $2, $3)`, [introId, other, insertedIds[insertedIds.length - 1]]);
      }
    }

    for (const { w, files } of workspaces) {
      const owner = ids.get(w.owner)!;
      const newest = Math.min(...w.files.map((f) => f.updatedDay));
      const ws = await c.query(
        `INSERT INTO workspace (name, created_by, created_at, updated_at) VALUES ($1, $2, $3, $4) RETURNING id`,
        [w.name, owner, new Date(at(w.createdDay, 20)), new Date(at(newest, 20))],
      );
      const wsId = ws.rows[0].id as string;
      await c.query(
        `INSERT INTO workspace_member (workspace_id, actor_id, role, state, joined_at, created_at) VALUES ($1, $2, 'owner', 'active', $3, $3)`,
        [wsId, owner, new Date(at(w.createdDay, 20))],
      );
      for (const m of w.members) {
        await c.query(
          `INSERT INTO workspace_member (workspace_id, actor_id, role, state, invited_by, joined_at, created_at)
           VALUES ($1, $2, 'member', 'active', $3, $4, $4)`,
          [wsId, ids.get(m)!, owner, new Date(at(w.createdDay, 21))],
        );
      }
      const folders = new Map<string, string>();
      for (const { f, text } of files) {
        const parts = f.path.split("/");
        let parent: string | null = null;
        let acc = "";
        for (const dir of parts.slice(0, -1)) {
          acc += `/${dir}`;
          if (!folders.has(acc)) {
            const r = await c.query(
              `INSERT INTO workspace_node (workspace_id, parent_id, kind, name, created_by, updated_by, created_at, updated_at)
               VALUES ($1, $2, 'folder', $3, $4, $4, $5, $5) RETURNING id`,
              [wsId, parent, dir, ids.get(f.author)!, new Date(at(f.createdDay, 19))],
            );
            folders.set(acc, r.rows[0].id);
          }
          parent = folders.get(acc)!;
        }
        await c.query(
          `INSERT INTO workspace_node (workspace_id, parent_id, kind, name, mime, size, text_content, created_by, updated_by, created_at, updated_at)
           VALUES ($1, $2, 'file', $3, 'text/plain', $4, $5, $6, $6, $7, $8)`,
          [wsId, parent, parts[parts.length - 1], Buffer.byteLength(text), text, ids.get(f.author)!, new Date(at(f.createdDay, 19)), new Date(at(f.updatedDay, 19))],
        );
        counts.files++;
      }
      counts.workspaces++;
    }
  });
  console.log(`Loaded ${counts.intros} conversations, ${counts.messages} messages, ${counts.workspaces} workspaces, ${counts.files} files.`);

  if (index) {
    const { rows: convs } = await pool.query(
      `SELECT i.id FROM intro i WHERE i.requester_id = $1 OR i.target_id = $1`,
      [john],
    );
    const { rows: wss } = await pool.query(`SELECT workspace_id AS id FROM workspace_member WHERE actor_id = $1 AND state = 'active'`, [john]);
    console.log("Building the AI retrieval index…");
    const n = await ensureIndexed([
      ...convs.map((r) => ({ kind: "conversation" as const, refId: r.id as string })),
      ...wss.map((r) => ({ kind: "workspace" as const, refId: r.id as string })),
    ]);
    console.log(`Indexed ${n} passages.`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
