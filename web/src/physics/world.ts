// The simulation: spheres on springs, fields that deform, and the step order
// that ties them together.

import { blobEnergy, blobHit, createBlob, injectBlob, stepBlob } from "./blob";
import { clamp, hashUnit, TAU } from "./vec";
import type { Body, BlobState, LayoutResult } from "./types";

// Sphere springs. zeta = 13 / (2*sqrt(120)) = 0.59, which overshoots home by
// exp(-pi*zeta/sqrt(1-zeta^2)) = 9.8% — one visible bounce past the mark and
// settled in about 0.6s. That is "springs away slightly, then comes back".
// At zeta 0.35 it overshoots 30% and reads like a toy; at 1.0 it is dead.
const K_HOME = 120;
const D_HOME = 13;

/** Mutual shove, so a dragged sphere pushes its neighbours out of the way. */
const K_SEP = 60;
const SEP_SLACK = 10;

/** Idle float amplitude, in canvas units. Small against the separation gap. */
const DRIFT = 5;

const MAX_RELEASE_SPEED = 1800;

export interface World {
  blobs: BlobState[];
  bodies: Body[];
  byId: Map<string, Body>;
  viewerX: number;
  viewerY: number;
  viewerRadius: number;
  width: number;
  height: number;
  /** Simulated seconds since the world was created — drives the idle float. */
  time: number;
}

export function createBody(id: string, x: number, y: number, radius: number, pinned: boolean): Body {
  // Every per-sphere "random" quantity is hashed from the actor id, so the
  // float pattern is identical on every reload. Periods land between 21 and
  // 30 seconds, slow enough to read as drifting rather than vibrating.
  return {
    id,
    homeX: x,
    homeY: y,
    x,
    y,
    vx: 0,
    vy: 0,
    radius,
    pinned,
    a1: hashUnit(id, 1) * TAU,
    a2: hashUnit(id, 2) * TAU,
    w1: 0.21 + hashUnit(id, 3) * 0.1,
    w2: 0.33 + hashUnit(id, 4) * 0.13,
    dragging: false,
    focused: false,
  };
}

export function createWorld(layout: LayoutResult, pinnedIds: Set<string>): World {
  const blobs = layout.fields.map((f) => createBlob(f.index, f.cx, f.cy, f.r));
  const bodies = layout.placed.map((p) => createBody(p.id, p.x, p.y, p.radius, pinnedIds.has(p.id)));
  return {
    blobs,
    bodies,
    byId: new Map(bodies.map((b) => [b.id, b])),
    viewerX: layout.viewerX,
    viewerY: layout.viewerY,
    viewerRadius: layout.viewerRadius,
    width: layout.width,
    height: layout.height,
    time: 0,
  };
}

export interface PointerSample {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Set when this pointer has grabbed a sphere. */
  bodyId: string | null;
  grabDx: number;
  grabDy: number;
}

/**
 * One fixed-size step. Order matters: pointers press the fields, the fields
 * relax, then the spheres resolve against their homes and each other. Pinned
 * bodies are never integrated at all — that is what makes a bridge read as
 * firm rather than merely heavy.
 */
export function stepWorld(world: World, dt: number, pointers: PointerSample[]): void {
  world.time += dt;

  for (const p of pointers) {
    const dragged = p.bodyId ? world.byId.get(p.bodyId) : undefined;
    // A sphere being dragged through a field squishes it too, with a reach
    // widened by its own radius. One code path, and it is the interaction
    // that makes the canvas feel physical rather than layered.
    const reach = dragged ? dragged.radius : 0;
    for (const blob of world.blobs) {
      if (blobHit(blob, p.x, p.y) || reach > 0) {
        injectBlob(blob, p.x, p.y, p.vx, p.vy, reach, dt);
      }
    }
  }

  for (const blob of world.blobs) stepBlob(blob, dt);

  for (const body of world.bodies) {
    if (body.pinned) continue;

    if (body.dragging) {
      // Position is driven straight from the pointer; velocity is recorded so
      // a release carries the throw.
      continue;
    }

    // The float is added to the spring's target rather than integrated into
    // position, so it can never fight the spring or accumulate drift.
    const driftX = body.focused ? 0 : DRIFT * Math.cos(body.w1 * world.time + body.a1);
    const driftY = body.focused ? 0 : DRIFT * Math.sin(body.w2 * world.time + body.a2);
    const targetX = body.homeX + driftX;
    const targetY = body.homeY + driftY;

    let ax = -K_HOME * (body.x - targetX) - D_HOME * body.vx;
    let ay = -K_HOME * (body.y - targetY) - D_HOME * body.vy;

    // With at most a few dozen spheres the naive pair loop costs about 10
    // microseconds. A spatial hash here would be pure overhead.
    for (const other of world.bodies) {
      if (other === body) continue;
      const dx = body.x - other.x;
      const dy = body.y - other.y;
      const d = Math.hypot(dx, dy);
      const need = body.radius + other.radius + SEP_SLACK;
      if (d >= need || d === 0) continue;
      const push = (K_SEP * (need - d)) / need;
      ax += (dx / d) * push;
      ay += (dy / d) * push;
    }

    // Keep clear of the viewer at the centre.
    const vdx = body.x - world.viewerX;
    const vdy = body.y - world.viewerY;
    const vd = Math.hypot(vdx, vdy);
    const vNeed = body.radius + world.viewerRadius + 12;
    if (vd < vNeed && vd > 0) {
      const push = (K_SEP * (vNeed - vd)) / vNeed;
      ax += (vdx / vd) * push;
      ay += (vdy / vd) * push;
    }

    body.vx += ax * dt;
    body.vy += ay * dt;
    body.x = clamp(body.x + body.vx * dt, body.radius, world.width - body.radius);
    body.y = clamp(body.y + body.vy * dt, body.radius, world.height - body.radius);
  }
}

export function worldEnergy(world: World): number {
  let e = 0;
  for (const blob of world.blobs) e += blobEnergy(blob);
  for (const body of world.bodies) {
    if (body.pinned) continue;
    e += body.vx * body.vx + body.vy * body.vy;
  }
  return e;
}

export function releaseBody(body: Body, vx: number, vy: number): void {
  body.dragging = false;
  const speed = Math.hypot(vx, vy);
  const scale = speed > MAX_RELEASE_SPEED ? MAX_RELEASE_SPEED / speed : 1;
  body.vx = vx * scale;
  body.vy = vy * scale;
}

/** Nearest sphere within grab range, or null. Touch slop included. */
export function hitBody(world: World, x: number, y: number): Body | null {
  let best: Body | null = null;
  let bestD = Infinity;
  for (const body of world.bodies) {
    const d = Math.hypot(body.x - x, body.y - y);
    if (d <= body.radius + 6 && d < bestD) {
      bestD = d;
      best = body;
    }
  }
  return best;
}

/** Settle the world instantly — used for the reduced-motion render. */
export function settleWorld(world: World): void {
  for (const body of world.bodies) {
    body.x = body.homeX;
    body.y = body.homeY;
    body.vx = 0;
    body.vy = 0;
  }
  for (const blob of world.blobs) {
    blob.u.fill(0);
    blob.v.fill(0);
    blob.ox = 0;
    blob.oy = 0;
    blob.ovx = 0;
    blob.ovy = 0;
  }
}
