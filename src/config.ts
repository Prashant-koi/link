import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

export const config = {
  databaseUrl: required("DATABASE_URL"),
  apiPort: Number(process.env.API_PORT ?? 3001),
  llm: {
    baseUrl: process.env.LLM_BASE_URL ?? "",
    apiKey: process.env.LLM_API_KEY ?? "",
    instructModel: process.env.LLM_MODEL ?? "Qwen/Qwen2.5-14B-Instruct",
    embeddingModel: process.env.LLM_EMBEDDING_MODEL ?? "",
  },
  workers: {
    // Instruct concurrency stays low deliberately: this is one box, and
    // concurrent sequences thrash the KV cache rather than raising throughput.
    instructConcurrency: Number(process.env.INSTRUCT_CONCURRENCY ?? 2),
    embeddingConcurrency: Number(process.env.EMBEDDING_CONCURRENCY ?? 8),
    embeddingBatchSize: Number(process.env.EMBEDDING_BATCH_SIZE ?? 256),
    pollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS ?? 1000),
  },
  resolution: {
    vectorAcceptThreshold: Number(process.env.RESOLUTION_ACCEPT_THRESHOLD ?? 0.92),
    vectorAdjudicateFloor: Number(process.env.RESOLUTION_ADJUDICATE_FLOOR ?? 0.75),
    candidateCount: 5,
    // When the model runtime is unreachable, an unresolved row goes to
    // needs_review rather than failing the job outright — seed data
    // handoff, stage 7: "leaves vector-band and unmatched rows in
    // needs_review rather than failing". --strict (once a runtime exists to
    // point at) makes that a hard failure instead.
    strict: process.env.RESOLUTION_STRICT === "true",
  },
};
