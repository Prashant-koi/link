import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    server: {
      // No path rewrite: the API owns /api/* itself (deployment handoff,
      // "Serve the frontend from the API container" — same-origin in prod
      // means dev has to hit the same paths, or the two environments drift
      // and a bug only shows up after the tunnel is already open).
      proxy: {
        "/api": {
          target: env.API_PROXY_TARGET || "http://localhost:3001",
        },
        // Live co-editing WebSocket (Hocuspocus).
        "/collab": {
          target: env.API_PROXY_TARGET || "http://localhost:3001",
          ws: true,
        },
      },
    },
  };
});
