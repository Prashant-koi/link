// Sanity checks on the loaded story: sizes, timestamps, senders, repetition and
// whether the key facts from the bible actually made it into the text.
//
//   npx tsx src/seed/collab/verify.ts

import { pool } from "../../db.js";
import { CAST, STORY_END } from "./bible.js";
import { THREADS } from "./threads.js";
import { WORKSPACES } from "./workspaces.js";

const end = new Date(STORY_END).getTime();
const problems: string[] = [];
const warn = (m: string) => problems.push(m);

async function main() {
  const john = (await pool.query(`SELECT actor_id FROM credential WHERE username = 'john.doe'`)).rows[0].actor_id as string;

  console.log("== Conversations");
  let total = 0;
  for (const t of THREADS) {
    const other = (await pool.query(`SELECT actor_id FROM credential WHERE username = $1`, [CAST[t.other].username])).rows[0].actor_id as string;
    const intro = (
      await pool.query(
        `SELECT id, state FROM intro WHERE least(requester_id, target_id) = least($1::uuid, $2::uuid) AND greatest(requester_id, target_id) = greatest($1::uuid, $2::uuid)`,
        [john, other],
      )
    ).rows[0];
    if (!intro) {
      warn(`missing conversation with ${t.other}`);
      continue;
    }
    const msgs = (await pool.query(`SELECT id, sender_id, body, created_at FROM message WHERE intro_id = $1 ORDER BY id`, [intro.id])).rows;
    total += msgs.length;
    const expected = t.segments.reduce((n, s) => n + s.n, 0);
    let monotonic = true;
    for (let i = 1; i < msgs.length; i++) if (msgs[i].created_at <= msgs[i - 1].created_at) monotonic = false;
    const first = msgs[0]?.created_at.getTime();
    const last = msgs[msgs.length - 1]?.created_at.getTime();
    const stray = msgs.filter((m) => m.sender_id !== john && m.sender_id !== other).length;
    const empty = msgs.filter((m) => !m.body.trim()).length;
    const openings = new Map<string, number>();
    for (const m of msgs) {
      const k = m.body.toLowerCase().slice(0, 28);
      openings.set(k, (openings.get(k) ?? 0) + 1);
    }
    const worstRepeat = [...openings.entries()].sort((a, b) => b[1] - a[1])[0];
    const unread = (
      await pool.query(
        `SELECT count(*) AS n FROM message m LEFT JOIN intro_read r ON r.intro_id = m.intro_id AND r.actor_id = $2
         WHERE m.intro_id = $1 AND m.sender_id <> $2 AND m.id > COALESCE(r.last_read_message_id, 0)`,
        [intro.id, john],
      )
    ).rows[0].n;
    console.log(
      `  ${t.other.padEnd(6)} ${intro.state.padEnd(9)} ${String(msgs.length).padStart(4)} msgs (planned ${expected}) ` +
        `${new Date(first).toISOString().slice(0, 10)} -> ${new Date(last).toISOString().slice(0, 10)} unread ${unread}` +
        (worstRepeat && worstRepeat[1] > 3 ? `  repeated opening x${worstRepeat[1]}: "${worstRepeat[0]}"` : ""),
    );
    if (!monotonic) warn(`${t.other}: timestamps not increasing`);
    if (last > end) warn(`${t.other}: message after the story's end`);
    if (first < end - 70 * 86400000) warn(`${t.other}: starts before the story window`);
    if (stray) warn(`${t.other}: ${stray} messages from someone else`);
    if (empty) warn(`${t.other}: ${empty} empty messages`);
    if (msgs.length < Math.round(expected * 0.7)) warn(`${t.other}: only ${msgs.length}/${expected} messages`);
  }
  console.log(`  total ${total} messages`);

  console.log("== Workspaces");
  for (const w of WORKSPACES) {
    const r = (
      await pool.query(
        `SELECT count(*) FILTER (WHERE kind = 'file') AS files, count(*) FILTER (WHERE kind = 'folder') AS folders,
                coalesce(sum(size), 0) AS bytes, coalesce(min(length(text_content)) FILTER (WHERE kind = 'file'), 0) AS shortest
         FROM workspace_node WHERE workspace_id = (SELECT id FROM workspace WHERE name = $1 ORDER BY created_at DESC LIMIT 1)`,
        [w.name],
      )
    ).rows[0];
    console.log(`  ${w.name.padEnd(52)} ${r.files}/${w.files.length} files, ${r.folders} folders, ${Math.round(Number(r.bytes) / 1024)} KB, shortest ${r.shortest} chars`);
    if (Number(r.files) !== w.files.length) warn(`${w.slug}: ${r.files}/${w.files.length} files`);
    if (Number(r.shortest) < 250) warn(`${w.slug}: a very short file (${r.shortest} chars)`);
  }

  console.log("== Key facts present (in messages or files)");
  const facts = ["pgvector", "Neo4j", "4.2 s", "0.9 s", "keep-warm", "qwen3.8", "Dropbox", "3rd place", "split vote", "150", "29 Sep", "25 Sep", "2 Oct", "30 Sep", "human eval", "trigram", "HOP_DECAY", "FERPA", "user study", "InstallSnapshot"];
  for (const f of facts) {
    const r = (
      await pool.query(
        `SELECT (SELECT count(*) FROM message WHERE body ILIKE $1) AS msgs, (SELECT count(*) FROM workspace_node WHERE text_content ILIKE $1) AS files`,
        [`%${f}%`],
      )
    ).rows[0];
    console.log(`  ${f.padEnd(16)} messages ${String(r.msgs).padStart(3)}  files ${String(r.files).padStart(3)}`);
    if (Number(r.msgs) + Number(r.files) === 0) warn(`fact never mentioned: ${f}`);
  }

  console.log("== Leaked future events (should be near zero)");
  const leaks = (
    await pool.query(
      `SELECT count(*) AS n FROM message m JOIN intro i ON i.id = m.intro_id
       WHERE m.created_at < $1 AND (m.body ILIKE '%3rd place%' OR m.body ILIKE '%third place%')`,
      [new Date(end - 7 * 86400000 - 4 * 3600000)],
    )
  ).rows[0].n;
  console.log(`  messages before the hackathon that mention the result: ${leaks}`);
  if (Number(leaks) > 0) warn(`${leaks} messages mention the hackathon result before it happened`);

  console.log(problems.length ? `\n${problems.length} PROBLEM(S):\n - ${problems.join("\n - ")}` : "\nAll checks passed.");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
