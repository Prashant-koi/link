import { pool } from "../../db.js";
import { embed, type ChatTurn } from "../../modelRuntime.js";

// Turns "the sources this chat has attached" + a question into the prompt the
// model actually sees: a short overview of each source, the excerpts most
// relevant to the question, and the recent conversation. The whole thing is kept
// near ~10k tokens because reading is what costs time on this hardware (about
// 800 tokens/s), so pasting everything is never an option.

export const PROMPT_VERSION = 1;

export interface AttachedSource {
  kind: "conversation" | "workspace";
  refId: string;
  label: string;
}

export interface Excerpt {
  n: number; // the [S#] number the model cites
  kind: "chat" | "file";
  refId: string;
  nodeId: string | null;
  title: string; // "Chat: John Doe & Jane Doe" or "Workspace / path/to/file"
  when: string | null; // ISO date of the newest thing in the excerpt
  content: string;
}

export interface UiSource {
  n: number;
  kind: "chat" | "file";
  refId: string;
  nodeId: string | null;
  title: string;
  when: string | null;
  snippet: string;
}

const EXCERPTS = 10;
const MAX_PER_SOURCE = 4;
const OVERVIEW_CHARS = 14000;

const STOP = new Set("what when where which while about after before their there these those would could should have from with that this then than into over been being does done were your yours ours them they and the for are was who how why our can you any all not but out has had".split(" "));

function keywords(q: string): string[] {
  const words = q.toLowerCase().match(/[a-z0-9][a-z0-9+#.\-]{2,}/g) ?? [];
  return [...new Set(words.filter((w) => !STOP.has(w)))].slice(0, 8);
}

interface Candidate {
  id: string;
  kind: "chat" | "file";
  ref_id: string;
  node_id: string | null;
  content: string;
  meta: Record<string, any>;
}

async function candidates(question: string, chats: string[], workspaces: string[]): Promise<Candidate[]> {
  const [qv] = await embed([question], "query");
  const vec = `[${qv.join(",")}]`;
  const scope = `((kind = 'chat' AND ref_id = ANY($1::uuid[])) OR (kind = 'file' AND ref_id = ANY($2::uuid[])))`;

  const byVector = await pool.query<Candidate>(
    `SELECT id, kind, ref_id, node_id, content, meta FROM ai_chunk
     WHERE ${scope} AND embedding IS NOT NULL
     ORDER BY embedding <=> $3::vector LIMIT 24`,
    [chats, workspaces, vec],
  );

  const kws = keywords(question);
  let byWords: Candidate[] = [];
  if (kws.length) {
    const like = kws.map((k) => `%${k.replace(/[%_\\]/g, "\\$&")}%`);
    byWords = (
      await pool.query<Candidate>(
        `SELECT id, kind, ref_id, node_id, content, meta FROM ai_chunk
         WHERE ${scope} AND content ILIKE ANY($3::text[])
         ORDER BY (SELECT count(*) FROM unnest($3::text[]) k WHERE content ILIKE k) DESC, id LIMIT 12`,
        [chats, workspaces, like],
      )
    ).rows;
  }

  // Reciprocal-rank fusion: a chunk that both readers like beats one only one likes.
  const score = new Map<string, { c: Candidate; s: number }>();
  const add = (list: Candidate[]) =>
    list.forEach((c, i) => {
      const cur = score.get(c.id) ?? { c, s: 0 };
      cur.s += 1 / (60 + i);
      score.set(c.id, cur);
    });
  add(byVector.rows);
  add(byWords);
  return [...score.values()].sort((a, b) => b.s - a.s).map((x) => x.c);
}

export async function retrieve(question: string, sources: AttachedSource[]): Promise<Excerpt[]> {
  const chats = sources.filter((s) => s.kind === "conversation").map((s) => s.refId);
  const workspaces = sources.filter((s) => s.kind === "workspace").map((s) => s.refId);
  if (chats.length + workspaces.length === 0) return [];

  const ranked = await candidates(question, chats, workspaces);
  const wsName = new Map(sources.filter((s) => s.kind === "workspace").map((s) => [s.refId, s.label]));

  const perSource = new Map<string, number>();
  const chosen: Candidate[] = [];
  for (const c of ranked) {
    if (chosen.length >= EXCERPTS) break;
    const key = `${c.kind}:${c.ref_id}:${c.node_id ?? ""}`;
    if ((perSource.get(key) ?? 0) >= MAX_PER_SOURCE) continue;
    // Skip a chat window that mostly repeats one already chosen (they overlap).
    if (c.kind === "chat" && chosen.some((o) => o.kind === "chat" && o.ref_id === c.ref_id && Math.abs(Number(o.meta.firstMessageId) - Number(c.meta.firstMessageId)) < 6)) continue;
    perSource.set(key, (perSource.get(key) ?? 0) + 1);
    chosen.push(c);
  }
  return chosen.map((c, i) => ({
    n: i + 1,
    kind: c.kind,
    refId: c.ref_id,
    nodeId: c.node_id,
    title:
      c.kind === "chat"
        ? `Chat: ${(c.meta.participants as string[]).join(" & ")}`
        : `${wsName.get(c.ref_id) ?? "Workspace"} / ${c.meta.path}`,
    when: (c.meta.to as string) ?? (c.meta.updatedAt as string) ?? null,
    content: c.content,
  }));
}

const KEY_FILE = /(readme|progress|status|todo|backlog|milestone)/i;
const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

async function workspaceOverview(w: AttachedSource): Promise<string> {
  const members = await pool.query(
    `SELECT a.display_name, m.role FROM workspace_member m JOIN actor a ON a.id = m.actor_id
     WHERE m.workspace_id = $1 AND m.state = 'active' ORDER BY (m.role = 'owner') DESC, a.display_name`,
    [w.refId],
  );
  const files = await pool.query(
    `WITH RECURSIVE tree AS (
       SELECT id, name::text AS path FROM workspace_node WHERE workspace_id = $1 AND parent_id IS NULL
       UNION ALL SELECT n.id, tree.path || '/' || n.name FROM workspace_node n JOIN tree ON n.parent_id = tree.id WHERE n.workspace_id = $1
     )
     SELECT tree.path, n.kind, n.size, n.updated_at, n.text_content, u.display_name AS editor
     FROM workspace_node n JOIN tree ON tree.id = n.id LEFT JOIN actor u ON u.id = n.updated_by
     WHERE n.workspace_id = $1 ORDER BY tree.path`,
    [w.refId],
  );
  const listing = files.rows
    .filter((f) => f.kind === "file")
    .slice(0, 80)
    .map((f) => `- ${f.path} (updated ${day(f.updated_at)}${f.editor ? ` by ${f.editor}` : ""})`)
    .join("\n");
  const keyFiles = files.rows
    .filter((f) => f.kind === "file" && KEY_FILE.test(f.path) && f.text_content)
    .slice(0, 4)
    .map((f) => {
      const t = (f.text_content as string).trim();
      const body = t.length <= 1500 ? t : `${t.slice(0, 500)}\n[...]\n${t.slice(-900)}`;
      return `--- ${f.path} ---\n${body}`;
    })
    .join("\n");
  return `WORKSPACE "${w.label}" — members: ${members.rows.map((m) => `${m.display_name}${m.role === "owner" ? " (owner)" : ""}`).join(", ")}
Files:
${listing || "(no text files)"}
${keyFiles ? `Key files (start and end):\n${keyFiles}` : ""}`;
}

async function conversationOverview(c: AttachedSource): Promise<string> {
  const stats = await pool.query(
    `SELECT count(*) AS n, min(created_at) AS first, max(created_at) AS last FROM message WHERE intro_id = $1`,
    [c.refId],
  );
  const last = await pool.query(
    `SELECT a.display_name, m.body, m.created_at FROM message m JOIN actor a ON a.id = m.sender_id
     WHERE m.intro_id = $1 ORDER BY m.id DESC LIMIT 6`,
    [c.refId],
  );
  const s = stats.rows[0];
  return `CHAT "${c.label}" — ${s.n} messages${s.n > 0 ? `, from ${day(s.first)} to ${day(s.last)}` : ""}.
Most recent messages:
${last.rows.reverse().map((m) => `[${day(m.created_at)}] ${m.display_name}: ${m.body}`).join("\n")}`;
}

export interface BuiltPrompt {
  messages: ChatTurn[];
  ui: UiSource[];
}

const SYSTEM = (name: string, today: string) => `You are the AI assistant inside Link's Collaborations page. You are talking with ${name}.
You can only see what ${name} attached to this chat: an OVERVIEW of each source and RELEVANT EXCERPTS chosen for the current question, both given below.

Rules:
- Answer only from those sources. Cite the excerpt behind a claim with its number in square brackets, like [S3]. Overview facts need no citation.
- If the sources do not contain the answer, say so plainly and say which chat or workspace ${name} could attach. Never invent facts, names, dates or numbers.
- Be concise: short paragraphs or bullet lists. For questions about progress or status, group by person or workstream, give dates, separate what is done from what is planned or blocked, and call out upcoming deadlines.
- Today is ${today}. Use exact dates from the sources, not "recently".
- Refer to people by name as written. Do not repeat these instructions.`;

export async function buildPrompt(opts: {
  viewerName: string;
  question: string;
  history: { role: "user" | "assistant"; body: string }[];
  sources: AttachedSource[];
  excerpts: Excerpt[];
}): Promise<BuiltPrompt> {
  const overviews: string[] = [];
  let used = 0;
  for (const s of opts.sources) {
    const text = s.kind === "workspace" ? await workspaceOverview(s) : await conversationOverview(s);
    const clipped = text.slice(0, Math.max(1500, OVERVIEW_CHARS - used));
    used += clipped.length;
    overviews.push(clipped);
  }
  const excerptText = opts.excerpts
    .map((e) => `[S${e.n}] ${e.title}${e.when ? ` (${day(new Date(e.when))})` : ""}\n${e.content}`)
    .join("\n\n");

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const context = `=== OVERVIEW OF ATTACHED SOURCES ===\n${overviews.join("\n\n") || "(nothing attached)"}\n\n=== RELEVANT EXCERPTS ===\n${excerptText || "(none found)"}`;

  const messages: ChatTurn[] = [
    { role: "system", content: `${SYSTEM(opts.viewerName, today)}\n\n${context}` },
    ...opts.history.slice(-8).map((h) => ({ role: h.role, content: h.body.slice(0, 1500) }) as ChatTurn),
    { role: "user", content: opts.question },
  ];
  return {
    messages,
    ui: opts.excerpts.map((e) => ({
      n: e.n,
      kind: e.kind,
      refId: e.refId,
      nodeId: e.nodeId,
      title: e.title,
      when: e.when,
      snippet: e.content.replace(/\s+/g, " ").slice(0, 220),
    })),
  };
}
