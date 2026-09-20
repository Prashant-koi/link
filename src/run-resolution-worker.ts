import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { keepModelsWarm } from "./modelRuntime.js";
import { loadPrompts } from "./promptRegistry.js";
import { runForever } from "./workers/resolutionWorker.js";

async function main() {
  await loadPrompts();
  keepModelsWarm(); // preloads both models and keeps them resident — see modelRuntime.ts
  const workerId = `resolution-${randomUUID()}`;
  console.log(`Resolution worker ${workerId} started`);
  await runForever(workerId, config.workers.pollIntervalMs);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
