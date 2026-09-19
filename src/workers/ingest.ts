import { readFile } from "node:fs/promises";
import { withTransaction } from "../db.js";
import { enqueue } from "../queue.js";

// Ingest worker: on-demand, batch, Postgres-only (data model handoff,
// section 8). Writes raw_text immediately and enqueues its resolution in
// the same transaction — either both land or neither does, so a crash never
// leaves an actor_concept row stuck unresolved with no job behind it.
export async function ingestActorInterest(
  actorId: string,
  rawText: string,
  source: string,
): Promise<void> {
  await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO actor_concept (actor_id, raw_text, source) VALUES ($1, $2, $3) RETURNING id`,
      [actorId, rawText, source],
    );
    await enqueue(client, "resolve_concept", {
      target: "actor_concept",
      targetId: rows[0].id,
      rawText,
    });
  });
}

export async function ingestBio(actorId: string, sourceText: string): Promise<void> {
  await withTransaction(async (client) => {
    await enqueue(client, "extract_bio", { actorId, sourceText });
  });
}

interface IngestRecord {
  actorId: string;
  rawText?: string;
  bioText?: string;
  source?: string;
}

// Batch entry point: a JSONL file of {actorId, rawText, source} or
// {actorId, bioText} records. Real scraping/upload sources are out of scope
// here — this is the seam they plug into.
export async function runBatchFromFile(filePath: string): Promise<{ ingested: number }> {
  const contents = await readFile(filePath, "utf8");
  const lines = contents.split("\n").map((l) => l.trim()).filter(Boolean);

  let ingested = 0;
  for (const line of lines) {
    const record = JSON.parse(line) as IngestRecord;
    if (record.bioText) {
      await ingestBio(record.actorId, record.bioText);
    } else if (record.rawText) {
      await ingestActorInterest(record.actorId, record.rawText, record.source ?? "ingest");
    }
    ingested++;
  }
  return { ingested };
}
