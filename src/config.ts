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
  nodeEnv: process.env.NODE_ENV ?? "development",
  auth: {
    // No default: an unrecognised or missing AUTH_MODE is an error, not a
    // silent fall-through to the permissive branch (auth handoff, "Mode
    // gate" — "it fails closed").
    mode: process.env.AUTH_MODE,
    allowDemoAuth: process.env.ALLOW_DEMO_AUTH === "1",
    sessionSecret: process.env.SESSION_SECRET ?? "dev-only-change-me-to-a-long-random-string",
    bcryptCost: Number(process.env.AUTH_BCRYPT_COST ?? 8), // real mode must raise this to 12 + argon2id
  },
  llm: {
    baseUrl: process.env.LLM_BASE_URL ?? "",
    apiKey: process.env.LLM_API_KEY ?? "",
    // Deployment handoff settled Ollama over vLLM on the GX10 (aarch64 +
    // CUDA 13 has no stable vLLM release). nomic-embed-text is 768
    // dimensions, matching concept.embedding vector(768) exactly — swapping
    // embedding models means a migration and a full re-embed, not a config
    // change.
    instructModel: process.env.LLM_INSTRUCT_MODEL ?? "qwen2.5:14b-instruct",
    embeddingModel: process.env.LLM_EMBED_MODEL ?? "nomic-embed-text",
  },
  workers: {
    // Ollama serialises requests per model by default, so instruct
    // concurrency above 1-2 just adds queueing latency you can't see rather
    // than raising throughput (deployment handoff, "Wiring the worker").
    instructConcurrency: Number(process.env.LLM_INSTRUCT_CONCURRENCY ?? 2),
    embeddingConcurrency: Number(process.env.EMBEDDING_CONCURRENCY ?? 8),
    embeddingBatchSize: Number(process.env.LLM_EMBED_BATCH ?? 256),
    pollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS ?? 1000),
  },
  github: {
    // Unauthenticated GitHub API calls are capped at 60/hour per IP, which a
    // demo can burn through. Optional, and nothing else changes when it is set.
    token: process.env.GITHUB_TOKEN ?? "",
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
