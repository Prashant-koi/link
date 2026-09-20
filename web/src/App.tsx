import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { AppShell } from "./components/AppShell";
import { Home } from "./pages/Home";
import { Import } from "./pages/Import";
import { View } from "./pages/View";
import { Search } from "./pages/Search";
import { Settings } from "./pages/Settings";
import { Login } from "./pages/Login";

// Any unauthenticated route redirects to /login; render nothing until
// GET /auth/me resolves, to avoid a flash of the login form for an
// already-authenticated user (auth handoff, "Route guard").
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { actor, loading } = useAuth();
  if (loading) return null;
  if (!actor) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function LoginRoute() {
  const { actor, loading } = useAuth();
  if (loading) return null;
  if (actor) return <Navigate to="/" replace />;
  return <Login />;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route path="/" element={<Home />} />
            <Route path="/import" element={<Import />} />
            <Route path="/view" element={<View />} />
            <Route path="/search" element={<Search />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
