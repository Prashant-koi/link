import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

// Route /login. Single centred card, nothing else on the page — no nav bar,
// since there is nowhere to navigate to yet (frontend/auth handoff).
export function Login() {
  const { login, authMode } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await login(username, password);
    setSubmitting(false);
    if (result.ok) {
      navigate("/", { replace: true });
    } else {
      setError(result.error);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <div
        style={{
          width: "min(380px, calc(100vw - 32px))",
          background: "var(--surface)",
          border: "1px solid var(--ink-200)",
          borderRadius: 12,
          padding: 32,
          display: "grid",
          gap: 20,
        }}
      >
        <h1 style={{ fontSize: "var(--fs-xl)", color: "var(--ink-900)" }}>Link</h1>

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: "var(--fs-sm)", color: "var(--ink-500)" }}>Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className="login-input"
              style={{
                fontSize: "var(--fs-base)",
                color: "var(--ink-900)",
                padding: "8px 12px",
                border: "1px solid var(--ink-200)",
                borderRadius: 8,
              }}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: "var(--fs-sm)", color: "var(--ink-500)" }}>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="login-input"
              style={{
                fontSize: "var(--fs-base)",
                color: "var(--ink-900)",
                padding: "8px 12px",
                border: "1px solid var(--ink-200)",
                borderRadius: 8,
              }}
            />
          </label>

          {error && (
            <p
              style={{
                fontSize: "var(--fs-sm)",
                color: "var(--ink-900)",
                borderLeft: "3px solid var(--tq-500)",
                paddingLeft: 10,
                margin: 0,
              }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              fontSize: "var(--fs-base)",
              fontWeight: 600,
              color: "var(--surface)",
              background: "var(--tq-600)",
              border: "none",
              borderRadius: 8,
              padding: "10px 16px",
              cursor: submitting ? "default" : "pointer",
              opacity: submitting ? 0.6 : 1,
            }}
          >
            Log in
          </button>
        </form>

        {authMode === "demo" && (
          <p
            style={{
              fontSize: "var(--fs-xs)",
              color: "var(--ink-500)",
              background: "var(--tq-050)",
              borderRadius: 6,
              padding: "8px 10px",
              margin: 0,
            }}
          >
            Demo build: passwords are derived from names and are public. Not for real accounts.
          </p>
        )}
      </div>
    </div>
  );
}
