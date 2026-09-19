import { NavLink, Outlet } from "react-router-dom";

const NAV_ITEMS = [
  { to: "/", label: "Home" },
  { to: "/view", label: "View" },
  { to: "/search", label: "Search" },
  { to: "/settings", label: "Settings" },
];

// Single top bar: left-aligned wordmark, four text links. No sidebar, no
// footer. The background wash lives on body::before globally.
export function AppShell() {
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
        <nav style={{ display: "flex", gap: 24 }}>
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
      </header>
      <main style={{ padding: "24px" }}>
        <Outlet />
      </main>
    </div>
  );
}
