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
  // Binary workspace files (uploads) live here, one dir per workspace. A
  // Docker volume in the deployment; text files are Yjs docs in Postgres.
  workspaceDir: process.env.WORKSPACE_DIR ?? "./data/workspaces",
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
    // Thinking models (qwen3.x, nemotron) spend the whole max_tokens budget
    // reasoning and return empty content: measured on qwen3.8, 3 of our 5
    // prompts failed that way. `reasoning_effort: "none"` is what actually
    // switches thinking off on Ollama's OpenAI-compatible endpoint
    // (`think:false` alone did not). Empty string = don't send the field.
    reasoningEffort: process.env.LLM_REASONING_EFFORT ?? "none",
    // nomic-embed-text is trained with task prefixes. Set both to "" for an
    // embedding model that doesn't use them.
    embedQueryPrefix: process.env.LLM_EMBED_QUERY_PREFIX ?? "search_query: ",
    embedDocumentPrefix: process.env.LLM_EMBED_DOCUMENT_PREFIX ?? "search_document: ",
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
    // Was 0.75, a placeholder. Measured with nomic-embed-text on 324 labelled
    // messy strings: a 0.75 floor sent ~72% of the unresolved strings to
    // "propose a brand-new concept" (creating duplicates like "applied optical
    // cables" beside "optical cables"); 0.60 sends ~80% to adjudication, where
    // the model checks the match against its top-5 candidates instead.
    vectorAdjudicateFloor: Number(process.env.RESOLUTION_ADJUDICATE_FLOOR ?? 0.6),
    candidateCount: 5,
    // When the model runtime is unreachable, an unresolved row goes to
    // needs_review rather than failing the job outright — seed data
    // handoff, stage 7: "leaves vector-band and unmatched rows in
    // needs_review rather than failing". --strict (once a runtime exists to
    // point at) makes that a hard failure instead.
    strict: process.env.RESOLUTION_STRICT === "true",
  },
};
