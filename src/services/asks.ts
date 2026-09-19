import { pool, withTransaction } from "../db.js";
import { enqueue } from "../queue.js";
import { getMaxIdf, normalizeRarity } from "./idf.js";
import { getActorSummary } from "./viewModels.js";
import type { AskSummary, ConceptChip, Cursor } from "../types.js";

const PAGE_SIZE = 20;

// Free text is stored immediately; parse_ask resolves the requirement set
// asynchronously (the same "never block on the GPU" pattern as explain_pair).
export async function createAsk(authorId: string, text: string, openUntil?: string): Promise<string> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO ask (author_id, text, open_until) VALUES ($1, $2, $3) RETURNING id`,
      [authorId, text, openUntil ?? null],
    );
    const askId = rows[0].id;
    await enqueue(client, "parse_ask", { askId, text });
    return askId;
  });
}

async function getAskRequires(askId: string): Promise<ConceptChip[]> {
  const { rows } = await pool.query(
    `SELECT ak.raw_text, c.id AS concept_id, c.pref_label,
            coalesce(idf.idf, 0) AS idf
     FROM ask_concept ak
     LEFT JOIN concept c ON c.id = ak.concept_id
     LEFT JOIN concept_idf idf ON idf.concept_id = ak.concept_id
     WHERE ak.ask_id = $1`,
    [askId],
  );
  const maxIdf = await getMaxIdf();

  return rows
    .filter((r) => r.concept_id) // omit requirements not yet resolved
    .map((r) => ({
      conceptId: r.concept_id,
      label: r.pref_label,
      shownAs: r.raw_text,
      rarity: normalizeRarity(r.idf, maxIdf),
    }));
}

export async function listAsks(cursor?: string): Promise<Cursor<AskSummary>> {
  const offset = cursor ? Number(cursor) : 0;
  const { rows } = await pool.query(
    `SELECT id, author_id, text, open_until
     FROM ask
     ORDER BY created_at DESC
     OFFSET $1 LIMIT $2`,
    [offset, PAGE_SIZE + 1],
  );

  const page = rows.slice(0, PAGE_SIZE);
  const items: AskSummary[] = [];
  for (const row of page) {
    const author = await getActorSummary(row.author_id);
    if (!author) continue;
    items.push({
      id: row.id,
      author,
      text: row.text,
      requires: await getAskRequires(row.id),
      openUntil: row.open_until ?? undefined,
    });
  }

  return {
    items,
    nextCursor: rows.length > PAGE_SIZE ? String(offset + PAGE_SIZE) : undefined,
  };
}
