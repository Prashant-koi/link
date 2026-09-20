import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { CollabProvider, useCollab } from "../collab/CollabContext";

const NAV_ITEMS = [
  { to: "/", label: "Home" },
  { to: "/import", label: "Import" },
  { to: "/view", label: "View" },
  { to: "/search", label: "Search" },
  { to: "/collaborations", label: "Collaborations" },
  { to: "/settings", label: "Settings" },
];

// Single top bar: left-aligned wordmark, four text links. No sidebar, no
// footer (frontend handoff, "Routes"). Log out sits at the far right —
// not a fifth nav item, since the spec fixes the nav at four.
export function AppShell() {
  return (
    <CollabProvider>
      <Shell />
    </CollabProvider>
  );
}

function Shell() {
  const { logout } = useAuth();
  const { unreadTotal, inviteCount } = useCollab();
  const fullBleed = useLocation().pathname.startsWith("/collaborations");
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    // The collaborations page fills the viewport (rail + panes manage their own
    // scrolling); every other page keeps the padded, page-scrolling layout.
    <div style={fullBleed ? { height: "100%", display: "flex", flexDirection: "column" } : undefined}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap", // six links no longer fit a phone-width bar on one line
          gap: "8px 32px",
          padding: "16px 24px",
        }}
      >
        <span style={{ fontSize: "var(--fs-lg)", fontWeight: 600, color: "var(--ink-900)" }}>Link</span>
        <nav style={{ display: "flex", flexWrap: "wrap", gap: "4px 24px", flex: 1 }}>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className="nav-link"
              style={({ isActive }) => ({
                fontSize: "var(--fs-base)",
                color: isActive ? "var(--tq-600)" : "var(--ink-600)",
                textDecoration: "none",
                paddingBottom: 4,
                whiteSpace: "nowrap",
                borderBottom: isActive ? "2px solid var(--tq-600)" : "2px solid transparent",
              })}
            >
              {item.label}
              {item.to === "/collaborations" && unreadTotal + inviteCount > 0 && (
                <span
                  aria-label={`${unreadTotal + inviteCount} new`}
                  style={{
                    marginLeft: 6,
                    padding: "0 6px",
                    borderRadius: 8,
                    background: "var(--tq-600)",
                    color: "var(--surface)",
                    fontSize: "var(--fs-xs)",
                    fontWeight: 600,
                  }}
                >
                  {unreadTotal + inviteCount}
                </span>
              )}
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
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          Log out
        </button>
      </header>
      <main style={fullBleed ? { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" } : { padding: "24px" }}>
        <Outlet />
      </main>
    </div>
  );
}
