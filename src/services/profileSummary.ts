import type { Response } from "express";
import { config } from "../config.js";
import { pool } from "../db.js";
import { streamChat } from "../modelRuntime.js";
import { HttpError } from "./httpError.js";
import { getProfileFacts, isGrounded, templateSummary } from "./profileFacts.js";

// "Learn more": a short AI summary of what a person does / has done, streamed to the
// panel. Cached per (person, facts hash). If the model can't be reached, or writes
// something the facts don't support, the reader gets a plain template built from the
// facts instead, so nothing untrue is ever presented as AI output.

const SYSTEM = `You write a short profile summary of one person for a university networking app, using ONLY the facts you are given.

Rules:
- 3 to 5 sentences, plain and friendly, third person. Use their name at the first mention, then "they". Gender is unknown: never use he, she, his, her or him.
- "Has experience in" means things they have worked on or studied: say "has experience in" or "has worked on". Never say published, expert, leading, or mention years, awards, employers or job titles.
- "Currently exploring" is present tense. "Wants to learn" is a goal. Courses "taking now" are current, "taken before" are past.
- Do not invent projects, papers, skills, numbers or details that are not in the facts. If little is listed, say so briefly and stop.
- Group related topics into a coherent picture of what kind of work they do; do not just list every item.
- No bullet points, no headings, no mention of "facts" or "profile data".`;

const asks = new Map<string, number[]>();
function checkRate(viewerId: string): void {
  const now = Date.now();
  const recent = (asks.get(viewerId) ?? []).filter((t) => now - t < 10 * 60_000);
  if (recent.length >= 40) throw new HttpError(429, "rate_limited");
  recent.push(now);
  asks.set(viewerId, recent);
}

export async function streamProfileSummary(viewerId: string, targetId: string, res: Response): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(targetId)) throw new HttpError(404, "not_found");
  const facts = await getProfileFacts(targetId);
  if (!facts) throw new HttpError(404, "not_found");
  checkRate(viewerId);

  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const cached = await pool.query(`SELECT text FROM ai_profile_summary WHERE actor_id = $1 AND facts_hash = $2`, [targetId, facts.hash]);
    if (cached.rows[0]) {
      send("token", { text: cached.rows[0].text });
      send("done", { cached: true, fallback: false });
      return;
    }

    let text = "";
    let failed = !config.llm.baseUrl;
    if (!failed) {
      try {
        for await (const ev of streamChat(
          [
            { role: "system", content: SYSTEM },
            { role: "user", content: `Facts:\n${facts.text}\n\nWrite the summary.` },
          ],
          { signal: controller.signal, maxTokens: 320, temperature: 0.3 },
        )) {
          if (ev.delta) {
            text += ev.delta;
            send("token", { text: ev.delta });
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return; // the reader left
        console.warn("profile summary generation failed:", err instanceof Error ? err.message : err);
        failed = true;
      }
    }

    text = text.trim();
    let grounded = false;
    try {
      grounded = !failed && !!text && isGrounded(text, facts.text);
    } catch (err) {
      console.warn("profile summary grounding check failed:", err); // never break the stream over the checker
    }
    if (!grounded) {
      // Replace whatever was streamed with the plain version.
      const plain = templateSummary(facts);
      send("replace", { text: plain });
      send("done", { cached: false, fallback: true });
      return;
    }
    await pool.query(
      `INSERT INTO ai_profile_summary (actor_id, facts_hash, text, model) VALUES ($1, $2, $3, $4) ON CONFLICT (actor_id, facts_hash) DO NOTHING`,
      [targetId, facts.hash, text, config.llm.instructModel],
    );
    send("done", { cached: false, fallback: false });
  } finally {
    res.end();
  }
}
