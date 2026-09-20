// Shapes shared between the layout solver and the simulation.
//
// Note these are deliberately *not* the API types. The solver takes an actor
// id, a membership bitmask and a rank — nothing else — so it can be reasoned
// about (and its determinism argued) without any knowledge of suggestions,
// reasons or concepts.

/** One thing to place on the canvas. `membership` is a bitmask over fields. */
export interface LayoutInput {
  id: string;
  /** Bit i set means "belongs in field i". 0 means it matches no field. */
  membership: number;
  /** 0 = strongest match. Drives size and placement priority. */
  rank: number;
  radius: number;
}

/** A placed node, in viewBox units. */
export interface Placed {
  id: string;
  x: number;
  y: number;
  radius: number;
  /**
   * True when the node's real membership could not be expressed by the
   * geometry and some fields had to be dropped to place it. The UI must
   * surface this rather than letting the position quietly lie.
   */
  partial: boolean;
  /** Field indices that had to be dropped. Empty unless `partial`. */
  dropped: number[];
}

export interface FieldGeometry {
  index: number;
  cx: number;
  cy: number;
  r: number;
}

export interface LayoutResult {
  width: number;
  height: number;
  viewerX: number;
  viewerY: number;
  viewerRadius: number;
  fields: FieldGeometry[];
  placed: Placed[];
  /** How many nodes ended up `partial`. Drives the caption under the canvas. */
  partialCount: number;
  /** The clearance and spacing the solver used, so a second relaxation pass
   *  (once bridges are known) can reuse exactly the same numbers. */
  pad: number;
  minSep: number;
}

/** Live simulation state for one deformable field. */
export interface BlobState {
  index: number;
  cx: number;
  cy: number;
  r: number;
  /** Radial displacement per control point, resting at 0. */
  u: Float32Array;
  /** Radial velocity per control point. */
  v: Float32Array;
  /** Whole-body sag offset — the body follows a drag lazily and returns dead. */
  ox: number;
  oy: number;
  ovx: number;
  ovy: number;
}

/** Live simulation state for one sphere. */
export interface Body {
  id: string;
  homeX: number;
  homeY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  /** Pinned bodies never float, never drag, and never yield to repulsion. */
  pinned: boolean;
  /** Phase/frequency seeds for the idle float, derived from the actor id. */
  a1: number;
  a2: number;
  w1: number;
  w2: number;
  dragging: boolean;
  /** Suppresses the idle float while focused, so the ring doesn't wander. */
  focused: boolean;
}
