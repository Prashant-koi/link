import { useEffect, useState } from "react";

/**
 * The canvas switches to a taller frame below this, and the page shows fewer
 * spheres — a name label needs real pixels, and scaling forty of them into a
 * phone-width viewBox produces a picture nobody can read.
 */
export const NARROW_BREAKPOINT = 760;

export function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW_BREAKPOINT);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < NARROW_BREAKPOINT);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return narrow;
}
