import { runStructuredPrompt } from "../modelRuntime.js";
import { getActivePrompt } from "../promptRegistry.js";
import { getProfileFacts, isGrounded } from "./profileFacts.js";

// One batched model call writes a query-tailored description for each of the top
// search results. Identical (query, profiles) inputs hit the llm_call cache, so a
// repeated search costs nothing. Anything that fails the grounding check is dropped:
// the card just shows no AI line.

interface Reply {
  blurbs: { index: number; text: string }[];
}

export async function searchBlurbs(query: string, actorIds: string[], timeoutMs = 20000): Promise<Record<string, string> | null> {
  const q = query.trim().slice(0, 200);
  if (!q) return null;
  const facts = (await Promise.all(actorIds.slice(0, 3).map((id) => getProfileFacts(id)))).filter((f): f is NonNullable<typeof f> => !!f);
  if (facts.length === 0) return null;

  const profiles = facts.map((f, i) => `Person [${i}]\n${f.text}`).join("\n\n");
  const prompt = await getActivePrompt("search_blurb");
  const call = runStructuredPrompt(prompt, { query: q, profiles });
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  let reply: Reply | null;
  try {
    reply = await Promise.race([call.then((r) => r.parsed as unknown as Reply), timeout]);
  } catch (err) {
    console.warn("search blurbs: model reply unusable:", err instanceof Error ? err.message : err);
    return null;
  }
  if (!reply?.blurbs) return null;

  const out: Record<string, string> = {};
  for (const b of reply.blurbs) {
    const f = facts[b.index];
    const text = typeof b.text === "string" ? b.text.trim() : "";
    if (!f || !text) continue;
    if (isGrounded(text, f.text) && text.startsWith(f.firstName)) out[f.actorId] = text;
    else console.warn(`search blurb for ${f.firstName} rejected by the grounding check`);
  }
  return Object.keys(out).length ? out : null;
}
