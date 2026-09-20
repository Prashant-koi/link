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
  github: {
    // Unauthenticated GitHub API calls are capped at 60/hour per IP, which a
    // demo can burn through. Optional, and nothing else changes when it is set.
    token: process.env.GITHUB_TOKEN ?? "",
  },
  resolution: {
    exactAliasOnly: false,
    vectorAcceptThreshold: Number(process.env.RESOLUTION_ACCEPT_THRESHOLD ?? 0.92),
    vectorAdjudicateFloor: Number(process.env.RESOLUTION_ADJUDICATE_FLOOR ?? 0.75),
    candidateCount: 5,
  },
};
