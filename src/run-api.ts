import { createServer } from "./api/server.js";
import { checkAuthModeGate } from "./auth/modeGate.js";
import { attachCollab } from "./collab/server.js";
import { config } from "./config.js";
import { loadPrompts } from "./promptRegistry.js";

async function main() {
  checkAuthModeGate(); // runs before the server listens — fails closed
  await loadPrompts();
  const app = createServer();
  const server = app.listen(config.apiPort, () => {
    console.log(`API server listening on :${config.apiPort}`);
  });
  attachCollab(server); // WebSocket co-editing on /collab
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
