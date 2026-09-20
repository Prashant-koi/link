import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const NAV_ITEMS = [
  { to: "/", label: "Home" },
  { to: "/import", label: "Import" },
  { to: "/view", label: "View" },
  { to: "/search", label: "Search" },
  { to: "/settings", label: "Settings" },
];

// Single top bar: left-aligned wordmark, four text links. No sidebar, no
// footer (frontend handoff, "Routes"). Log out sits at the far right —
// not a fifth nav item, since the spec fixes the nav at four.
export function AppShell() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 32,
          padding: "16px 24px",
        }}
      >
        <span style={{ fontSize: "var(--fs-lg)", fontWeight: 600, color: "var(--ink-900)" }}>Link</span>
        <nav style={{ display: "flex", gap: 24, flex: 1 }}>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              style={({ isActive }) => ({
                fontSize: "var(--fs-base)",
                color: isActive ? "var(--tq-600)" : "var(--ink-600)",
                textDecoration: "none",
                paddingBottom: 4,
                borderBottom: isActive ? "2px solid var(--tq-600)" : "2px solid transparent",
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={handleLogout}
          style={{
            fontSize: "var(--fs-sm)",
            color: "var(--ink-500)",
            background: "none",
            border: "none",
            cursor: "pointer",
          }}
        >
          Log out
        </button>
      </header>
      <main style={{ padding: "24px" }}>
        <Outlet />
      </main>
    </div>
  );
}
