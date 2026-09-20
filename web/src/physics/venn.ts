// Deterministic placement of people inside overlapping interest fields.
//
// The rule this file exists to enforce: a sphere sits inside every field whose
// interest it shares and outside every field it does not. Position is the only
// thing on the canvas carrying that information, so it has to be true.
//
// Two hard constraints shape the whole approach:
//
//  1. No jitter. Constellation.tsx rejected a force simulation because it
//     settles differently on every load. Same data in must mean the same
//     picture out, byte for byte — so there is no Math.random, no Date.now and
//     no window access anywhere in this module. Every "random-looking"
//     quantity comes from a hash of the actor id, and every loop runs in a
//     fixed order.
//
//  2. Five circles cannot form a five-set Venn diagram. Some combinations of
//     interests have no region to sit in, and that is a fact about geometry,
//     not a bug to paper over. The solver detects it and degrades visibly:
//     the node is marked `partial` with the fields it could not honour, and
//     the UI rings it and says so in words.
//
// The method is a region raster. For a candidate set of radii, the canvas is
// sampled on a grid and each cell records which fields it is safely inside and
// which it is safely outside. That one pass answers everything the solver
// needs — whether a combination is representable at all, how much room it has,
// where its centre of mass is, and in what order to fill it. Analytic circle
// intersection would give boundary arcs, which is the wrong shape of answer;
// gradient descent from a seed point cannot even be trusted to find the right
// region, because the feasible area for a set like {0,2} is often two
// disconnected lobes.

import { clamp, dist, hashUnit } from "./vec";
import type { FieldGeometry, LayoutInput, LayoutResult, Placed } from "./types";

/**
 * Candidate radii, as fractions of the largest radius that still clears the
 * centre (computed per layout — see `maxRadiusFraction`).
 *
 * The clearance is a hard geometric bound, not a tuning knob: a field of
 * radius r centred ρ from the middle reaches the centre exactly when r >= ρ.
 * Capping r at ρ minus the profile's own size is what guarantees no interest
 * field ever touches the profile sitting in the middle.
 *
 * The bottom of the ladder leaves the circles fully separate. A field only
 * grows into its neighbour when the scoring below finds people who need that
 * intersection to exist.
 */
const RADIUS_LADDER = [0.55, 0.7, 0.85, 1.0];

/**
 * With all fields at the same radius k·ρ on a ring of radius ρ, the structure
 * that exists is fixed by k alone:
 *
 *   k < 0.588   five separate circles, no overlap at all
 *   0.588..0.951  singletons and adjacent pairs   (adjacent centres: 1.176ρ)
 *   0.951..1.0    also non-adjacent pairs and adjacent triples (1.902ρ)
 *   k > 1.0       also the five-way centre (every centre falls within R of V)
 *
 * Uniform radii therefore force a choice between tidy separate petals and
 * everything dissolving into one blob. Solving a radius per field instead lets
 * the combinations that actually occur in the data get the room they need —
 * and it reads honestly, because a field grows when more people share it.
 */
const RASTER_CELL_COARSE = 14; // radius search: cheap, ~3600 cells
const RASTER_CELL_FINE = 7; // final placement: ~14k cells
const SEARCH_SWEEPS = 3;
const RELAX_ITERATIONS = 12;
/**
 * Default gap between spheres, on top of their two radii. Sized for a name
 * label sitting under each one; a caller that does not draw those labels
 * passes something smaller, which lets far more people fit inside a field.
 */
const DEFAULT_SEPARATION_SLACK = 30;

/** How much of a region's score comes from simply existing, versus having
 *  room to spare. See the note in scoreRadii for why this is so high. */
const EXISTENCE_WEIGHT = 0.75;

interface Raster {
  cols: number;
  rows: number;
  cell: number;
  originX: number;
  originY: number;
  inMask: Uint8Array;
  outMask: Uint8Array;
}

function cellCentre(r: Raster, index: number): { x: number; y: number } {
  const col = index % r.cols;
  const row = (index - col) / r.cols;
  return {
    x: r.originX + (col + 0.5) * r.cell,
    y: r.originY + (row + 0.5) * r.cell,
  };
}

/**
 * Sample the canvas. `pad` is the clearance a sphere needs from a field's
 * boundary, so a cell marked "inside field i" has room for a whole sphere
 * inside it, not just its centre. A cell can be marked neither inside nor
 * outside a given field — that is the boundary band, and excluding it is
 * exactly what stops spheres straddling an edge ambiguously.
 */
function rasterise(
  fields: FieldGeometry[],
  pad: number,
  cell: number,
  width: number,
  height: number,
  keepOut: { x: number; y: number; r: number },
): Raster {
  const cols = Math.max(1, Math.floor(width / cell));
  const rows = Math.max(1, Math.floor(height / cell));
  const inMask = new Uint8Array(cols * rows);
  const outMask = new Uint8Array(cols * rows);
  const raster: Raster = { cols, rows, cell, originX: 0, originY: 0, inMask, outMask };

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      const px = (col + 0.5) * cell;
      const py = (row + 0.5) * cell;

      // The viewer occupies the middle, which is also where the deepest
      // overlap sits — exactly the region the best-matched people want. Void
      // those cells here rather than shoving spheres out afterwards, because
      // containment runs last in the relaxation and would just pull them back.
      // A cell with no bits set satisfies no membership test, including 0.
      if (dist(px, py, keepOut.x, keepOut.y) < keepOut.r) {
        inMask[idx] = 0;
        outMask[idx] = 0;
        continue;
      }

      let inBits = 0;
      let outBits = 0;
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        const d = dist(px, py, f.cx, f.cy);
        if (d <= f.r - pad) inBits |= 1 << i;
        if (d >= f.r + pad) outBits |= 1 << i;
      }
      inMask[idx] = inBits;
      outMask[idx] = outBits;
    }
  }
  return raster;
}

/** Cells that satisfy "inside every field in S, outside every field not in S". */
function validCells(raster: Raster, set: number, full: number): number[] {
  const complement = ~set & full;
  const cells: number[] = [];
  for (let i = 0; i < raster.inMask.length; i++) {
    if ((raster.inMask[i] & set) === set && (raster.outMask[i] & complement) === complement) {
      cells.push(i);
    }
  }
  return cells;
}

/**
 * Place the fields on the ring. `order[p]` is the interest sitting at ring
 * position p, so the returned array stays indexed by *interest*, which is what
 * every membership bitmask is keyed on — only the geometry moves.
 */
function ringFields(
  count: number,
  cx: number,
  cy: number,
  rho: number,
  ks: number[],
  order: number[],
): FieldGeometry[] {
  const fields: FieldGeometry[] = new Array(count);
  for (let position = 0; position < count; position++) {
    const i = order[position];
    const angle = (-90 + (360 / count) * position) * (Math.PI / 180);
    fields[i] = {
      index: i,
      cx: cx + rho * Math.cos(angle),
      cy: cy + rho * Math.sin(angle),
      r: rho * ks[i],
    };
  }
  return fields;
}

/**
 * Choose which interests sit next to each other on the ring.
 *
 * Two circles on a ring can only overlap if they are neighbours, so the
 * ordering decides which pairs of interests can have an intersection at all.
 * Putting the pairs that people actually share side by side means the overlaps
 * that appear are the ones somebody occupies, and the rest of the circles stay
 * apart — which is the whole point of the arrangement.
 *
 * Five items have only 12 distinct circular orderings once rotations and
 * reflections are folded together, so this enumerates all of them and keeps
 * the best. Exhaustive, and therefore deterministic.
 */
function bestRingOrder(count: number, counts: Map<number, number>): number[] {
  if (count <= 3) return Array.from({ length: count }, (_, i) => i);

  const pairWeight = (a: number, b: number): number => {
    let total = 0;
    for (const [set, n] of counts) {
      if (set & (1 << a) && set & (1 << b)) total += n;
    }
    return total;
  };

  const rest = Array.from({ length: count - 1 }, (_, i) => i + 1);
  let best: number[] = [0, ...rest];
  let bestScore = -Infinity;
  const seen = new Set<string>();

  const permute = (prefix: number[], remaining: number[]) => {
    if (remaining.length === 0) {
      const order = [0, ...prefix];
      // A circular order and its mirror image draw the same picture.
      const mirror = [0, ...[...prefix].reverse()].join(",");
      if (seen.has(mirror)) return;
      seen.add(order.join(","));

      let score = 0;
      for (let p = 0; p < order.length; p++) {
        score += pairWeight(order[p], order[(p + 1) % order.length]);
      }
      if (score > bestScore) {
        bestScore = score;
        best = order;
      }
      return;
    }
    for (let i = 0; i < remaining.length; i++) {
      permute([...prefix, remaining[i]], remaining.filter((_, j) => j !== i));
    }
  };

  permute([], rest);
  return best;
}

/**
 * How well a candidate set of radii serves the membership sets that actually
 * occur. Sets are weighted by how many people are in them, so the common
 * combinations win the room — which is the whole point of solving radii at all.
 */
function scoreRadii(
  raster: Raster,
  counts: Map<number, number>,
  ks: number[],
  full: number,
  slotArea: number,
): number {
  let total = 0;
  for (const [set, count] of counts) {
    if (set === 0) continue; // "matches nothing" always has the whole margin
    const area = validCells(raster, set, full).length * raster.cell * raster.cell;
    if (area === 0) continue;
    // Existence dominates roominess, and deliberately so. The intersection of
    // two circles is a thin lens, so scoring purely on area makes creating one
    // worth almost nothing — less than the inflation penalty — and the search
    // shrinks every field until nothing overlaps and half the people have
    // nowhere to go. What matters is whether the region exists at all; the
    // relaxation pass is what strings people along it afterwards.
    const roominess = Math.min(1, area / (count * slotArea));
    total += count * (EXISTENCE_WEIGHT + (1 - EXISTENCE_WEIGHT) * roominess);
  }
  // Inflation is penalised hard, because a circle that grew for no reason
  // creates an intersection that claims people share two interests when
  // nobody in the data does. Overlap has to be earned by the count above.
  for (let i = 0; i < ks.length; i++) {
    total -= 1.6 * ks[i] * ks[i];
    total += 0.05 * ((ks.length - i) / ks.length) * ks[i];
  }
  return total;
}

export interface LayoutOptions {
  width: number;
  height: number;
  fieldCount: number;
  ringRadius: number;
  viewerRadius: number;
  /** Gap to leave between spheres beyond their radii. Defaults to enough room
   *  for a name label under each. */
  separationSlack?: number;
}

/**
 * Place every input. Pure, and deterministic given identical arguments.
 */
export function solveLayout(inputs: LayoutInput[], opts: LayoutOptions): LayoutResult {
  const { width, height, fieldCount, ringRadius, viewerRadius } = opts;
  const viewerX = width / 2;
  const viewerY = height / 2;
  const full = (1 << fieldCount) - 1;

  if (fieldCount === 0) {
    return {
      width,
      height,
      viewerX,
      viewerY,
      viewerRadius,
      fields: [],
      placed: fallbackRing(inputs, viewerX, viewerY, ringRadius),
      partialCount: 0,
      pad: 0,
      minSep: 0,
    };
  }

  const maxRadius = inputs.reduce((m, n) => Math.max(m, n.radius), 16);
  // The sphere's own radius, and no more. Padding beyond this buys tidiness at
  // the boundary but narrows every intersection, and an intersection between
  // two circles is already a thin lens — a few extra units here is the
  // difference between two people fitting in a shared region and one of them
  // being pushed out of it.
  const pad = maxRadius;
  const minSep = 2 * maxRadius + (opts.separationSlack ?? DEFAULT_SEPARATION_SLACK);
  const slotArea = minSep * minSep; // the relaxation pass handles tight packing

  const counts = new Map<number, number>();
  for (const node of inputs) counts.set(node.membership, (counts.get(node.membership) ?? 0) + 1);

  // Keep the middle clear. This is the bound that stops a field reaching the
  // profile: a field centred `ringRadius` out with radius at most
  // `ringRadius - clearance` leaves a hole of at least `clearance` around the
  // centre, whatever the solver decides to do with the rest.
  const clearance = viewerRadius + 26;
  const maxRadiusFraction = Math.max(0.3, (ringRadius - clearance) / ringRadius);
  const keepOut = { x: viewerX, y: viewerY, r: clearance + maxRadius };

  const order = bestRingOrder(fieldCount, counts);

  // --- Radius search: coordinate descent over the ladder, fixed order ------
  const ladder = RADIUS_LADDER.map((f) => f * maxRadiusFraction);

  // Start at the top and shrink, never the other way round. The search moves
  // one field at a time, and an intersection needs *two* fields to be large —
  // so from a small start no single step can ever create one, and the search
  // settles in a state where nobody fits anywhere. Starting with every field
  // at its maximum means the overlaps all exist up front, and each step asks
  // the only question worth asking: is anyone actually using this room?
  const ks = new Array(fieldCount).fill(ladder[ladder.length - 1]);
  for (let sweep = 0; sweep < SEARCH_SWEEPS; sweep++) {
    for (let i = 0; i < fieldCount; i++) {
      let bestK = ks[i];
      let bestScore = -Infinity;
      for (const candidate of ladder) {
        ks[i] = candidate;
        const fields = ringFields(fieldCount, viewerX, viewerY, ringRadius, ks, order);
        const raster = rasterise(fields, pad, RASTER_CELL_COARSE, width, height, keepOut);
        const score = scoreRadii(raster, counts, ks, full, slotArea);
        if (score > bestScore) {
          bestScore = score;
          bestK = candidate;
        }
      }
      ks[i] = bestK;
    }
  }

  const fields = ringFields(fieldCount, viewerX, viewerY, ringRadius, ks, order);
  const raster = rasterise(fields, pad, RASTER_CELL_FINE, width, height, keepOut);

  // --- Placement ----------------------------------------------------------
  // Strongest match first, so it lands deepest in the shared region.
  const ordered = [...inputs].sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : 1));
  const placed: Placed[] = [];
  const cellCache = new Map<number, number[]>();

  const cellsFor = (set: number): number[] => {
    let cached = cellCache.get(set);
    if (!cached) {
      cached = orderedRegionCells(raster, set, full);
      cellCache.set(set, cached);
    }
    return cached;
  };

  for (const node of ordered) {
    let set = node.membership;
    const dropped: number[] = [];

    // Drop the lowest-ranked interest and retry until a region with room
    // exists. Never place someone in a region they do not belong to.
    for (;;) {
      const cells = cellsFor(set);
      const spot = firstFreeCell(raster, cells, placed, node.radius, minSep, width, height);
      if (spot) {
        placed.push({
          id: node.id,
          x: spot.x,
          y: spot.y,
          radius: node.radius,
          partial: dropped.length > 0,
          dropped: dropped.slice(),
        });
        break;
      }
      if (set === 0) {
        // Floor case: even "outside everything" is full. Shelve it below the
        // canvas body rather than dropping anyone from the picture.
        const shelfIndex = placed.filter((p) => p.y > height - 56).length;
        placed.push({
          id: node.id,
          x: clamp(60 + shelfIndex * minSep, 40, width - 40),
          y: height - 34,
          radius: node.radius,
          partial: true,
          dropped: bitsOf(node.membership),
        });
        break;
      }
      const highest = 31 - Math.clz32(set);
      dropped.push(highest);
      set &= ~(1 << highest);
    }
  }

  relax(placed, fields, inputs, [], RELAX_ITERATIONS, pad, minSep, width, height, viewerX, viewerY, viewerRadius);

  return {
    width,
    height,
    viewerX,
    viewerY,
    viewerRadius,
    fields,
    placed,
    partialCount: placed.filter((p) => p.partial).length,
    pad,
    minSep,
  };
}

function bitsOf(mask: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 32; i++) if (mask & (1 << i)) out.push(i);
  return out;
}

/** Region cells sorted from the centre of the region outwards. */
function orderedRegionCells(raster: Raster, set: number, full: number): number[] {
  const cells = validCells(raster, set, full);
  if (cells.length === 0) return cells;
  let sx = 0;
  let sy = 0;
  for (const c of cells) {
    const p = cellCentre(raster, c);
    sx += p.x;
    sy += p.y;
  }
  const gx = sx / cells.length;
  const gy = sy / cells.length;
  return cells.sort((a, b) => {
    const pa = cellCentre(raster, a);
    const pb = cellCentre(raster, b);
    const da = dist(pa.x, pa.y, gx, gy);
    const db = dist(pb.x, pb.y, gx, gy);
    // Tie-break on index so the ordering is total and stable.
    return da - db || a - b;
  });
}

function firstFreeCell(
  raster: Raster,
  cells: number[],
  placed: Placed[],
  radius: number,
  minSep: number,
  width: number,
  height: number,
): { x: number; y: number } | null {
  for (const c of cells) {
    const p = cellCentre(raster, c);
    if (p.x < radius + 8 || p.x > width - radius - 8) continue;
    if (p.y < radius + 8 || p.y > height - radius - 8) continue;
    let free = true;
    for (const other of placed) {
      if (dist(p.x, p.y, other.x, other.y) < minSep) {
        free = false;
        break;
      }
    }
    if (free) return p;
  }
  return null;
}

/**
 * Alternating projection. Soft pair repulsion first, then the containment
 * constraints applied last so they always win — a node may be nudged into a
 * neighbour's space by repulsion, but it will never be left outside a field it
 * belongs to. Seeded from the raster, so it starts inside the correct region
 * and only has to de-grid, never to search.
 *
 * Exported because bridges are positioned from finished people, then fed back
 * in here as fixed obstacles for a second, shorter pass.
 */
export function relax(
  placed: Placed[],
  fields: FieldGeometry[],
  inputs: LayoutInput[],
  obstacles: { x: number; y: number; radius: number }[],
  iterations: number,
  pad: number,
  minSep: number,
  width: number,
  height: number,
  viewerX: number,
  viewerY: number,
  viewerRadius: number,
): void {
  const membershipById = new Map(inputs.map((n) => [n.id, n.membership]));

  for (let iter = 0; iter < iterations; iter++) {
    // 1. Soft pair repulsion.
    for (let a = 0; a < placed.length; a++) {
      for (let b = a + 1; b < placed.length; b++) {
        const pa = placed[a];
        const pb = placed[b];
        const d = dist(pa.x, pa.y, pb.x, pb.y);
        if (d >= minSep || d === 0) continue;
        const push = 0.5 * (minSep - d);
        const ux = (pb.x - pa.x) / d;
        const uy = (pb.y - pa.y) / d;
        pa.x -= push * ux;
        pa.y -= push * uy;
        pb.x += push * ux;
        pb.y += push * uy;
      }
    }

    // 2. Containment.
    for (const node of placed) {
      const membership = membershipById.get(node.id) ?? 0;
      // A `partial` node was placed against a reduced set; re-deriving the
      // effective set here keeps the projection consistent with where it
      // actually went.
      let effective = membership;
      for (const d of node.dropped) effective &= ~(1 << d);

      for (const f of fields) {
        const inside = (effective & (1 << f.index)) !== 0;
        const d = dist(node.x, node.y, f.cx, f.cy);
        if (inside && d > f.r - pad) {
          const t = (f.r - pad) / (d || 1);
          node.x = f.cx + (node.x - f.cx) * t;
          node.y = f.cy + (node.y - f.cy) * t;
        } else if (!inside && d < f.r + pad) {
          const t = (f.r + pad) / (d || 1);
          node.x = f.cx + (node.x - f.cx) * (d === 0 ? 0 : t);
          node.y = f.cy + (node.y - f.cy) * (d === 0 ? 0 : t);
          if (d === 0) node.x = f.cx + f.r + pad;
        }
      }

      node.x = clamp(node.x, node.radius + 6, width - node.radius - 6);
      node.y = clamp(node.y, node.radius + 6, height - node.radius - 6);
    }

    // 3. Fixed obstacles — the viewer and any bridges — applied last so they
    // always win. The push is radially outward, which for a node in a deep
    // overlap keeps it inside the same region it was already in, so this
    // rarely undoes the containment above.
    for (const node of placed) {
      for (const ob of [...obstacles, { x: viewerX, y: viewerY, radius: viewerRadius }]) {
        const need = ob.radius + node.radius + 16;
        const d = dist(node.x, node.y, ob.x, ob.y);
        if (d >= need) continue;
        if (d === 0) {
          node.x = ob.x + need;
          continue;
        }
        node.x = ob.x + ((node.x - ob.x) / d) * need;
        node.y = ob.y + ((node.y - ob.y) / d) * need;
      }
    }
  }
}

/** No interests to draw fields from: fall back to the old radial arrangement. */
function fallbackRing(inputs: LayoutInput[], cx: number, cy: number, rho: number): Placed[] {
  const n = Math.max(1, inputs.length);
  return inputs.map((node, i) => {
    const angle = (-90 + (360 / n) * i) * (Math.PI / 180);
    const jitter = 0.9 + hashUnit(node.id, 1) * 0.2;
    return {
      id: node.id,
      x: cx + rho * jitter * Math.cos(angle),
      y: cy + rho * jitter * Math.sin(angle),
      radius: node.radius,
      partial: false,
      dropped: [],
    };
  });
}
