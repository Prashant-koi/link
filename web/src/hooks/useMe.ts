import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "link.me";

// Auth is an explicit open question in the backend handoff — actor identity
// vs. session identity isn't reconciled yet. This stands in for a session:
// a locally-remembered actor id, set once in Settings.
export function useMe(): [string, (id: string) => void] {
  const [me, setMeState] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  });

  useEffect(() => {
    try {
      if (me) localStorage.setItem(STORAGE_KEY, me);
    } catch {
      // best-effort only — a private window or blocked storage just means
      // the id won't persist across reloads.
    }
  }, [me]);

  const setMe = useCallback((id: string) => setMeState(id), []);
  return [me, setMe];
}
