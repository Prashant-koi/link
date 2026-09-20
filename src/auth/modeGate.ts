import { config } from "../config.js";

// Runs at boot, before the server listens. A demo credential scheme that
// can be left on by accident is worse than no gate at all, because nobody
// notices — auth handoff, "Mode gate". Fails closed: a missing or
// unrecognised AUTH_MODE is an error, never a default to demo.
export function checkAuthModeGate(): void {
  const mode = config.auth.mode;

  if (mode !== "demo" && mode !== "real") {
    throw new Error(`AUTH_MODE must be "demo" or "real" (got ${JSON.stringify(mode)})`);
  }

  if (mode === "demo") {
    if (config.nodeEnv === "production") {
      throw new Error("AUTH_MODE=demo refuses to start in production");
    }
    if (!config.auth.allowDemoAuth) {
      throw new Error("AUTH_MODE=demo requires ALLOW_DEMO_AUTH=1");
    }
    console.warn("DEMO AUTH: passwords are derived from names and are public");
  }
}
