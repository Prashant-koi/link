// The gummy interest fields.
//
// A field is a ring of control points that may only move radially. That single
// restriction is what makes the whole thing well-behaved: the outline stays
// star-shaped, so it can never fold through itself, the spline through it is
// always smooth, and the state is one number per point instead of two.

import { clamp, clamp01, smoothstep, TAU, wrapPi } from "./vec";
import type { BlobState } from "./types";

/** 48 points ≈ 7.5° apart. 32 reads faceted at this size; 64 buys nothing. */
const POINTS = 48;

// Spring constants. The feel lives entirely in these four numbers.
//
//   K_REST 140  -> w0 = sqrt(140) = 11.8 rad/s ~ 1.9 Hz. A wobble you can see
//                  sits between 1.5 and 2.5 Hz.
//   DAMP   5.0  -> zeta = 5 / (2*sqrt(140)) = 0.21. Roughly four visible
//                  oscillations, gone in about 1.2s. Near 1.0 reads as stone;
//                  down at 0.05 it never stops and reads as a rubber sheet.
//   K_LINK 320  -> must dominate K_REST or a poke is a single spike on one
//                  vertex instead of a dent. At this ratio a press spreads
//                  over about 60 degrees of arc within 150ms.
//
// Stability: the explicit-Euler bound for the coupling term is
// dt < 2/sqrt(4*K_LINK) = 56ms. The fixed 1/120s step sits 6.7x inside it.
const K_REST = 140;
const DAMP = 5.0;
const K_LINK = 320;

/** How much of the mean displacement is pushed back out each step. This is the
 *  pseudo-volume term — press one side in and the other side bulges out, which
 *  is most of what separates "jelly" from "dented paper". */
const VOLUME = 0.6;

const PUSH = 90; // inward force under the pointer
const SHEAR = 0.55; // sideways smear, proportional to pointer speed
const SPREAD = 0.62; // angular reach of a press, in radians (~36 degrees)
const BAND = 0.55; // radial reach, as a fraction of the field radius

const MAX_IN = 0.28; // displacement clamps, as a fraction of radius
const MAX_OUT = 0.22;

const BODY_K = 90; // whole-body sag: zeta = 12/(2*sqrt(90)) = 0.63, no bounce
const BODY_DAMP = 12;
const BODY_MAX = 0.1;

export function createBlob(index: number, cx: number, cy: number, r: number, rest?: Float32Array): BlobState {
  const resting = rest ?? new Float32Array(POINTS);
  return {
    index,
    cx,
    cy,
    r,
    rest: resting,
    u: new Float32Array(resting),
    v: new Float32Array(POINTS),
    ox: 0,
    oy: 0,
    ovx: 0,
    ovy: 0,
  };
}

export function blobPointCount(): number {
  return POINTS;
}

/**
 * Press the surface. `px,py` is the pointer in canvas units, `vx,vy` its
 * smoothed velocity. Every force falls off through smoothstep rather than
 * linearly, because a linear ramp leaves a visible crease exactly where the
 * pointer's influence ends.
 */
export function injectBlob(
  blob: BlobState,
  px: number,
  py: number,
  vx: number,
  vy: number,
  extraReach: number,
  dt: number,
): void {
  const cx = blob.cx + blob.ox;
  const cy = blob.cy + blob.oy;
  const dx = px - cx;
  const dy = py - cy;
  const d = Math.hypot(dx, dy);
  if (d === 0) return;

  const phi = Math.atan2(dy, dx);
  // The outline is irregular now, so "the surface" is wherever the resting
  // shape is in the pointer's direction, not a fixed radius.
  const local = blob.r + blob.rest[(Math.round((phi / TAU) * POINTS) + POINTS) % POINTS];
  const reach = BAND * blob.r + extraReach;
  const radialGate = smoothstep(1 - Math.abs(d - local) / reach);
  if (radialGate <= 0) return;

  const penetration = d < local ? Math.min(local - d, 0.35 * blob.r) : 0;

  for (let k = 0; k < POINTS; k++) {
    const theta = (TAU * k) / POINTS;
    const angularGate = smoothstep(1 - Math.abs(wrapPi(theta - phi)) / SPREAD);
    if (angularGate <= 0) continue;
    const gate = radialGate * angularGate;

    // Normal at this point, which for a radial ring is just its direction.
    const nx = Math.cos(theta);
    const ny = Math.sin(theta);
    const along = vx * nx + vy * ny;

    const force = -PUSH * gate * penetration - SHEAR * gate * along;
    blob.v[k] += force * dt;
  }

  // The body follows the pointer lazily and returns without bouncing, while
  // the skin wobbles fast. Separating those two timescales is the illusion.
  blob.ovx += 0.25 * PUSH * radialGate * (dx / d) * dt;
  blob.ovy += 0.25 * PUSH * radialGate * (dy / d) * dt;
}

export function stepBlob(blob: BlobState, dt: number): void {
  const { u, v, r, rest } = blob;
  const maxIn = -MAX_IN * r;
  const maxOut = MAX_OUT * r;

  // Everything below works on the displacement from the resting outline, so
  // an irregular rest shape springs exactly like a circle would.
  let mean = 0;
  for (let k = 0; k < POINTS; k++) {
    const kp = k === 0 ? POINTS - 1 : k - 1;
    const kn = k === POINTS - 1 ? 0 : k + 1;
    const d = u[k] - rest[k];
    const dPrev = u[kp] - rest[kp];
    const dNext = u[kn] - rest[kn];
    // Restoring pull to the rest outline, plus a discrete Laplacian along the
    // ring that lets a dent travel as a wave instead of spiking one point.
    const a = -K_REST * d + K_LINK * (dPrev + dNext - 2 * d) - DAMP * v[k];
    v[k] += a * dt;
    const nd = clamp(d + v[k] * dt, maxIn, maxOut);
    u[k] = rest[k] + nd;
    mean += nd;
  }

  mean /= POINTS;
  if (mean !== 0) {
    for (let k = 0; k < POINTS; k++) u[k] -= VOLUME * mean;
  }

  // Whole-body sag.
  const bodyMax = BODY_MAX * r;
  blob.ovx += (-BODY_K * blob.ox - BODY_DAMP * blob.ovx) * dt;
  blob.ovy += (-BODY_K * blob.oy - BODY_DAMP * blob.ovy) * dt;
  blob.ox = clamp(blob.ox + blob.ovx * dt, -bodyMax, bodyMax);
  blob.oy = clamp(blob.oy + blob.ovy * dt, -bodyMax, bodyMax);
}

export function blobEnergy(blob: BlobState): number {
  let e = 0;
  for (let k = 0; k < POINTS; k++) e += blob.v[k] * blob.v[k];
  return e + blob.ovx * blob.ovx + blob.ovy * blob.ovy;
}

/**
 * Catmull-Rom through the ring, emitted as cubic Béziers.
 *
 * The tangent at P_i is (P_{i+1} - P_{i-1})/2, and a cubic Bézier's tangent at
 * its start is 3(C1 - P_i). Matching the two gives C1 = P_i + (P_{i+1} -
 * P_{i-1})/6, hence the 1/6. Slightly under that removes a faint overshoot
 * bulge on the shoulders of a dent, which is the one place it shows.
 *
 * Every index wraps, so the curve is closed and C1-continuous with no
 * endpoint special cases.
 */
const TENSION = 0.16;

export function blobPath(blob: BlobState): string {
  const { u, r } = blob;
  const cx = blob.cx + blob.ox;
  const cy = blob.cy + blob.oy;
  const px = new Array<number>(POINTS);
  const py = new Array<number>(POINTS);

  for (let k = 0; k < POINTS; k++) {
    const theta = (TAU * k) / POINTS;
    const rad = r + u[k];
    px[k] = cx + rad * Math.cos(theta);
    py[k] = cy + rad * Math.sin(theta);
  }

  const f = (n: number) => Math.round(n * 10) / 10;
  let d = `M${f(px[0])} ${f(py[0])}`;
  for (let k = 0; k < POINTS; k++) {
    const i0 = (k - 1 + POINTS) % POINTS;
    const i1 = k;
    const i2 = (k + 1) % POINTS;
    const i3 = (k + 2) % POINTS;
    const c1x = px[i1] + (px[i2] - px[i0]) * TENSION;
    const c1y = py[i1] + (py[i2] - py[i0]) * TENSION;
    const c2x = px[i2] - (px[i3] - px[i1]) * TENSION;
    const c2y = py[i2] - (py[i3] - py[i1]) * TENSION;
    d += `C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(px[i2])} ${f(py[i2])}`;
  }
  return d + "Z";
}

/** Whether the pointer is close enough to this field's surface to press it. */
export function blobHit(blob: BlobState, px: number, py: number): boolean {
  const dx = px - (blob.cx + blob.ox);
  const dy = py - (blob.cy + blob.oy);
  const phi = Math.atan2(dy, dx);
  const local = blob.r + blob.rest[(Math.round((phi / TAU) * POINTS) + POINTS) % POINTS];
  return Math.abs(Math.hypot(dx, dy) - local) < BAND * blob.r;
}

export { clamp01 };
