// Expands the hand-written story (bible.ts, threads.ts, workspaces.ts) into
// chat messages and workspace files using the local model. Every result is
// written to db/seed-data/collab-story/ as soon as it exists, so a crash or a
// Ctrl-C resumes where it stopped and the finished fixtures can be committed.
//
//   npx tsx src/seed/collab/generate.ts [--only=chats|files] [--concurrency=3] [--force] [--limit=N]

import fs from "node:fs/promises";
import path from "node:path";
import { BIBLE, CAST, STORY_END } from "./bible.js";
import { THREADS, type Segment, type ThreadDef } from "./threads.js";
import { WORKSPACES, type FileDef, type WorkspaceDef } from "./workspaces.js";

const BASE = process.env.LLM_BASE_URL ?? "http://127.0.0.1:11434";
const MODEL = process.env.STORY_MODEL ?? "qwen3.8";
export const OUT_DIR = path.resolve("db/seed-data/collab-story");

const args = new Map<string, string | undefined>(process.argv.slice(2).map((a): [string, string | undefined] => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v]; }));
const CONCURRENCY = Number(args.get("concurrency") ?? 3);
const FORCE = args.has("force");
const ONLY = args.get("only");
const LIMIT = args.get("limit") ? Number(args.get("limit")) : Infinity;

export interface ChatMessage {
  from: "john" | "other";
  text: string;
  gap: number; // minutes since the previous message in this segment
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function dateOf(day: number): Date {
  const d = new Date(STORY_END);
  d.setDate(d.getDate() - day);
  return d;
}
/** Keeps the model from leaking things that haven't happened yet. */
function timeNote(day: number): string {
  const hack = Math.round((dateOf(8).getTime() - dateOf(day).getTime()) / 86400000);
  return `THE DATE IN THE STORY RIGHT NOW: ${label(day)}.
Anything in the story facts dated AFTER this date has NOT happened yet: do not mention it as decided, done, or known (no future decisions, results, or the hackathon outcome). ${
    hack > 0
      ? `The hackathon weekend (Sat 12 Sep) is ${hack} days away.`
      : hack === 0
        ? "The hackathon weekend is today."
        : `The hackathon weekend was ${-hack} days ago.`
  } Planned deadlines and future plans may be mentioned as plans.`;
}

function label(day: number): string {
  const d = dateOf(day);
  return `${DOW[d.getDay()]} ${d.getDate()} ${d.toLocaleString("en", { month: "short" })} ${d.getFullYear()}`;
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true, () => false);
}

async function chat(system: string, user: string, opts: { schema?: object; maxTokens: number; temperature: number }): Promise<string> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(15 * 60 * 1000),
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      think: false,
      ...(opts.schema ? { format: opts.schema } : {}),
      options: { temperature: opts.temperature, num_predict: opts.maxTokens, repeat_penalty: 1.05 },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { message: { content: string } };
  return json.message.content;
}

// ---------- chats ----------

const CHAT_SYSTEM = `You write realistic private direct-message conversations between two people for a demo dataset.
Rules:
- Sound like real students/colleagues texting: mostly 1-3 sentences, some one-word or emoji replies, occasional typos, occasional longer pasted snippets (a command, a list, a link to a workspace file such as docs/decisions.md).
- Be specific: use the concrete names, numbers, dates and decisions from the brief and story facts. Never contradict them. Do not invent new major facts, results or dates.
- Give each person their own voice. Show disagreement, humour, small talk and fatigue where natural. Not everything ends in a question.
- No headings, no bullet lists, no narration, no stage directions, no mention of being an AI or of a "dataset".
- Return JSON only.`;

const CHAT_SCHEMA = {
  type: "object",
  required: ["messages"],
  properties: {
    messages: {
      type: "array",
      items: {
        type: "object",
        required: ["from", "text", "gap_minutes"],
        properties: {
          from: { type: "string", enum: ["john", "other"] },
          text: { type: "string" },
          gap_minutes: { type: "integer" },
        },
      },
    },
  },
};

function chatPath(thread: ThreadDef, seg: Segment): string {
  return path.join(OUT_DIR, "chats", thread.other, `${seg.id}.json`);
}

async function generateSegment(thread: ThreadDef, seg: Segment, tail: ChatMessage[]): Promise<ChatMessage[]> {
  const other = CAST[thread.other];
  const john = CAST.john;
  const tailText = tail.length
    ? tail.map((m) => `${m.from === "john" ? john.name : other.name}: ${m.text}`).join("\n")
    : "(this is the start of the conversation)";
  const user = `STORY FACTS (never contradict):
${BIBLE}

${timeNote(seg.day)}

PEOPLE IN THIS CHAT
- "john" = ${john.name}: ${john.role}. Voice: ${john.voice}.
- "other" = ${other.name}: ${other.role}. Voice: ${other.voice}.

CONVERSATION SO FAR (most recent messages):
${tailText}

NEXT BURST
Starts around ${seg.hour}:00 on ${label(seg.day)}${seg.spanHours ? ` and lasts about ${seg.spanHours} hours` : ""}.
What happens in it: ${seg.brief}

Write about ${seg.n} messages (between ${Math.max(1, Math.round(seg.n * 0.8))} and ${Math.round(seg.n * 1.25)}). "gap_minutes" is the minutes since the previous message (1-10 in an active exchange, larger for a pause of an hour or more; 0 for the first). Keep the burst within its time window. ${seg.n === 1 ? "Write exactly one message." : ""}
${thread.opener === "other" && !tail.length ? 'The first message must be from "other".' : ""}${thread.opener === "john" && !tail.length ? 'The first message must be from "john".' : ""}`;

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const raw = await chat(CHAT_SYSTEM, user, { schema: CHAT_SCHEMA, maxTokens: 6000, temperature: attempt === 1 ? 0.8 : 0.9 });
      const parsed = JSON.parse(raw) as { messages: { from: string; text: string; gap_minutes: number }[] };
      const msgs: ChatMessage[] = parsed.messages
        .filter((m) => (m.from === "john" || m.from === "other") && typeof m.text === "string" && m.text.trim().length > 0)
        .map((m, i) => ({
          from: m.from as "john" | "other",
          text: m.text.trim().slice(0, 1500),
          gap: i === 0 ? 0 : Math.max(0, Math.min(720, Math.round(m.gap_minutes || 2))),
        }));
      if (seg.n === 1) {
        if (msgs.length >= 1) return [msgs[0]];
      } else if (msgs.length >= Math.ceil(seg.n * 0.6)) {
        return msgs.slice(0, Math.ceil(seg.n * 1.4));
      }
      console.warn(`  ${seg.id}: attempt ${attempt} gave ${msgs.length}/${seg.n} messages, retrying`);
    } catch (err) {
      console.warn(`  ${seg.id}: attempt ${attempt} failed: ${(err as Error).message.slice(0, 120)}`);
    }
  }
  throw new Error(`could not generate ${seg.id}`);
}

async function runThread(thread: ThreadDef, budget: { left: number }): Promise<void> {
  let tail: ChatMessage[] = [];
  for (const seg of thread.segments) {
    const file = chatPath(thread, seg);
    if (!FORCE && (await exists(file))) {
      tail = (JSON.parse(await fs.readFile(file, "utf8")) as { messages: ChatMessage[] }).messages.slice(-8);
      continue;
    }
    if (budget.left <= 0) return;
    budget.left--;
    const t0 = Date.now();
    const messages = await generateSegment(thread, seg, tail);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ segmentId: seg.id, messages }, null, 2));
    tail = messages.slice(-8);
    console.log(`chat ${thread.other}/${seg.id}: ${messages.length} messages in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}

// ---------- files ----------

const FILE_SYSTEM = `You write the full contents of ONE file in a team's shared workspace, exactly as that team member would have written it.
Rules:
- Output ONLY the file's contents. No preamble, no explanation, and do not wrap the whole file in a code fence.
- Be concrete and consistent with the story facts: use the real names, dates, numbers and decisions. Never invent conflicting facts, results or dates.
- Write the way a busy student team writes: useful, slightly informal, a few TODOs or rough edges are fine. Markdown files use headings and lists; code files are plausible, compilable-looking excerpts with comments.
- Do not invent real citations, DOIs or quotes; use placeholders where a reference would go.`;

function stripFence(text: string): string {
  const m = /^```[a-zA-Z0-9]*\n([\s\S]*?)\n```\s*$/.exec(text.trim());
  return (m ? m[1] : text).trim() + "\n";
}

function filePath(ws: WorkspaceDef, f: FileDef): string {
  return path.join(OUT_DIR, "workspaces", ws.slug, f.path);
}

async function generateFile(ws: WorkspaceDef, f: FileDef): Promise<string> {
  const author = CAST[f.author];
  const user = `STORY FACTS (never contradict):
${BIBLE}

${timeNote(f.updatedDay)}
The file must read as it stood on that date.

WORKSPACE: "${ws.name}" (owner ${CAST[ws.owner].name}; members ${ws.members.map((m) => CAST[m].name).join(", ")}).
FILE: ${f.path}
AUTHOR: ${author.name} (${author.role}). First written ${label(f.createdDay)}; last updated ${label(f.updatedDay)}.
WHAT THE FILE CONTAINS: ${f.brief}

Write the file now (roughly 250-700 words, or 60-110 lines for code).`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const text = stripFence(await chat(FILE_SYSTEM, user, { maxTokens: 2600, temperature: 0.6 }));
      if (text.length > 200) return text;
    } catch (err) {
      console.warn(`  ${f.path}: attempt ${attempt} failed: ${(err as Error).message.slice(0, 120)}`);
    }
  }
  throw new Error(`could not generate ${f.path}`);
}

// ---------- driver ----------

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        try {
          await fn(item);
        } catch (err) {
          console.error(`FAILED: ${(err as Error).message}`);
        }
      }
    }),
  );
}

async function main() {
  console.log(`model=${MODEL} concurrency=${CONCURRENCY} out=${OUT_DIR}`);
  const started = Date.now();
  const budget = { left: LIMIT };
  if (ONLY !== "files") await pool(THREADS, CONCURRENCY, (t) => runThread(t, budget));
  if (ONLY !== "chats") {
    const jobs = WORKSPACES.flatMap((ws) => ws.files.map((f) => ({ ws, f })));
    await pool(jobs, CONCURRENCY, async ({ ws, f }) => {
      const file = filePath(ws, f);
      if (!FORCE && (await exists(file))) return;
      if (budget.left <= 0) return;
      budget.left--;
      const t0 = Date.now();
      const text = await generateFile(ws, f);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, text);
      console.log(`file ${ws.slug}/${f.path}: ${text.length} chars in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    });
  }
  console.log(`done in ${((Date.now() - started) / 60000).toFixed(1)} min`);
}

if (process.argv[1]?.endsWith("generate.ts")) void main();
