import { useEffect, useState } from "react";

const STILL_KEY = "link.stillCanvas";

/**
 * Whether the canvas should hold still.
 *
 * The `prefers-reduced-motion` block in global.css only neutralises CSS
 * animations — it has no reach into a requestAnimationFrame loop, so the
 * preference has to be read in JS as well.
 *
 * The local override exists because plenty of people who want less movement
 * have never set the OS preference. It can only ever turn motion off, never
 * force it back on over a stated system preference.
 */
export function useReducedMotion(): [boolean, (still: boolean) => void] {
  const [systemPrefers, setSystemPrefers] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  const [override, setOverride] = useState(() => {
    try {
      return window.localStorage.getItem(STILL_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setSystemPrefers(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setStill = (still: boolean) => {
    setOverride(still);
    try {
      window.localStorage.setItem(STILL_KEY, still ? "1" : "0");
    } catch {
      // Not being able to remember the choice is not a reason to ignore it.
    }
  };

  return [systemPrefers || override, setStill];
}
