import { runBatchFromFile } from "./workers/ingest.js";

// On-demand, batch (data model handoff runtime roles table) — not a daemon.
// Usage: node dist/run-ingest-worker.js path/to/batch.jsonl
async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: run-ingest-worker <path-to-jsonl>");
    process.exit(1);
  }
  const { ingested } = await runBatchFromFile(filePath);
  console.log(`Ingested ${ingested} record(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
