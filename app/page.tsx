"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { useOS } from "@/lib/client/store";
import { Desktop } from "@/components/shell/Desktop";
import { LoginScreen } from "@/components/shell/LoginScreen";
import type { Scope } from "@/lib/auth/roles";

export default function Page() {
  const { scope, setSession } = useOS();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    api<{ scope: Scope; llm: { configured: boolean; model: string | null } }>("/api/auth/me")
      .then((d) => setSession(d.scope, d.llm))
      .catch(() => setSession(null))
      .finally(() => setChecked(true));
  }, [setSession]);

  if (!checked) return <div className="flex h-screen items-center justify-center text-sm text-slate-400">starting StudentOS…</div>;
  return scope ? <Desktop /> : <LoginScreen />;
}
