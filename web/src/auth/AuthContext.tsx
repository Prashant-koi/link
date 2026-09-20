import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "../api/client";
import type { ActorSummary } from "../types/api";

interface AuthState {
  actor: ActorSummary | null;
  authMode: "demo" | "real" | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

// GET /auth/me on mount decides authenticated-vs-not — render nothing until
// it resolves, to avoid the login form flashing for an already-authenticated
// user (auth handoff, "Route guard").
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [actor, setActor] = useState<ActorSummary | null>(null);
  const [authMode, setAuthMode] = useState<"demo" | "real" | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.me().then(({ body }) => {
      setAuthMode(body.authMode);
      setActor(body.actor ?? null);
      setLoading(false);
    });
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const { status, body } = await api.login(username, password);
    if (status !== 200 || !body.actor) {
      return { ok: false as const, error: body.error ?? "That username or password didn't match" };
    }
    setActor(body.actor);
    setAuthMode(body.authMode);
    return { ok: true as const };
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setActor(null);
  }, []);

  return (
    <AuthContext.Provider value={{ actor, authMode, loading, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
