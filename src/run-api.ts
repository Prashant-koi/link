import { createServer } from "./api/server.js";
import { config } from "./config.js";
import { loadPrompts } from "./promptRegistry.js";

async function main() {
  await loadPrompts();
  const app = createServer();
  app.listen(config.apiPort, () => {
    console.log(`API server listening on :${config.apiPort}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
