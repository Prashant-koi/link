// Small pure helpers shared by the layout solver and the simulation.
// Deliberately dependency-free and side-effect-free: `venn.ts` imports this
// and nothing else, which is what keeps the layout provably deterministic.

export interface Vec {
  x: number;
  y: number;
}

export const TAU = Math.PI * 2;

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Hermite smoothstep. Used for every falloff in the blob forces because its
// derivative is exactly zero at both ends — a linear ramp leaves a visible
// crease in the surface right where the pointer's influence stops.
export function smoothstep(v: number): number {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

// Shortest signed angular distance, in (-PI, PI].
export function wrapPi(a: number): number {
  let x = a;
  while (x > Math.PI) x -= TAU;
  while (x <= -Math.PI) x += TAU;
  return x;
}

// FNV-1a over a string. The canvas needs per-person variation (float phase,
// placement tie-breaks) that is stable across reloads, so every "random"
// quantity is derived from the actor id through this rather than from
// Math.random.
export function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// A stable 0..1 from a hash plus a salt, so one id can seed several
// independent-looking quantities.
export function hashUnit(str: string, salt: number): number {
  return (hash(str + ":" + salt) % 100000) / 100000;
}
