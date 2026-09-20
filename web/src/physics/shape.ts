// The resting outline of an interest field.
//
// A field is a circle to the layout solver (which guarantees every member sits
// inside it and every non-member sits outside, each with clearance). Drawn as a
// perfect circle it looks mechanical, so each field gets an irregular resting
// shape instead — but the wobble is only allowed inside the band those two
// guarantees leave open, so the picture never lies about who belongs.
//
// For each of the ring's rays from the field centre:
//   - a member disc forces the boundary to reach at least its far side;
//   - a non-member disc forces the boundary to stop before its near side.
// The seeded noise is clamped into that band, smoothed, and clamped again.

import { clamp, hashUnit, TAU } from "./vec";

export interface ShapeNode {
  x: number;
  y: number;
  radius: number;
  /** Whether this person belongs to the field being shaped. */
  member: boolean;
}

/** Relative amplitude of each harmonic. 2..4 give the big lazy lobes, 5..6 a
 *  little finer wobble. Sums to ~0.135; the hard limit below is what actually bounds it. */
const HARMONICS: [number, number][] = [
  [2, 0.035],
  [3, 0.04],
  [4, 0.03],
  [5, 0.02],
  [6, 0.01],
];

/** Never stray further than this from the circle, as a fraction of radius. */
const LIMIT = 0.13;

export function restProfile(
  key: string,
  cx: number,
  cy: number,
  r: number,
  nodes: ShapeNode[],
  margin: number,
  points: number,
): Float32Array {
  const phases = HARMONICS.map(([n]) => hashUnit(key, n) * TAU);

  const lo = new Float32Array(points).fill(-LIMIT * r);
  const hi = new Float32Array(points).fill(LIMIT * r);
  const noise = new Float32Array(points);

  for (let k = 0; k < points; k++) {
    const theta = (TAU * k) / points;
    let n = 0;
    for (let h = 0; h < HARMONICS.length; h++) {
      n += HARMONICS[h][1] * Math.cos(HARMONICS[h][0] * theta + phases[h]);
    }
    noise[k] = n * r;

    const ux = Math.cos(theta);
    const uy = Math.sin(theta);
    for (const node of nodes) {
      const dx = node.x - cx;
      const dy = node.y - cy;
      const t = dx * ux + dy * uy; // distance along the ray to the node's closest approach
      const perp2 = dx * dx + dy * dy - t * t;
      const rad = node.radius + margin;
      if (perp2 >= rad * rad) continue; // the ray misses this disc
      const h = Math.sqrt(rad * rad - perp2);
      if (node.member) {
        lo[k] = Math.max(lo[k], t + h - r); // must reach past the far side
      } else if (t - h > 0) {
        hi[k] = Math.min(hi[k], t - h - r); // must stop short of the near side
      }
    }
    // If the two ever cross (a very tight crowd), compromise rather than
    // favour one side.
    if (lo[k] > hi[k]) {
      const mid = (lo[k] + hi[k]) / 2;
      lo[k] = mid;
      hi[k] = mid;
    }
  }

  const out = new Float32Array(points);
  for (let k = 0; k < points; k++) out[k] = clamp(noise[k], lo[k], hi[k]);

  // Smooth twice, then clamp again: smoothing alone could pull the outline
  // back across a member.
  const tmp = new Float32Array(points);
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < points; k++) {
      tmp[k] = 0.25 * out[(k - 1 + points) % points] + 0.5 * out[k] + 0.25 * out[(k + 1) % points];
    }
    out.set(tmp);
  }
  for (let k = 0; k < points; k++) out[k] = clamp(out[k], lo[k], hi[k]);
  return out;
}
