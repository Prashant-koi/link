import { createHash } from "node:crypto";

// mulberry32 — small, fast, deterministic PRNG. Same seed => same sequence,
// which is what "deterministic under --seed" requires everywhere below.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  float(): number {
    return this.next();
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  intRange(minInclusive: number, maxInclusive: number): number {
    return minInclusive + this.int(maxInclusive - minInclusive + 1);
  }

  bool(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  sample<T>(items: readonly T[], count: number): T[] {
    const pool = [...items];
    const result: T[] = [];
    for (let i = 0; i < count && pool.length > 0; i++) {
      const idx = this.int(pool.length);
      result.push(pool[idx]);
      pool.splice(idx, 1);
    }
    return result;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Sample a rank index (0-based) from a Zipf distribution over `n` items
  // with exponent `s`: P(rank) proportional to 1/rank^s. This is the
  // distribution that gives idf a real spread (uniform sampling collapses
  // it to nothing — see the seed data handoff).
  zipfIndex(n: number, s: number): number {
    // Precompute-free inverse-CDF sampling via rejection is overkill at
    // n ~ 1200; a direct cumulative-weight draw is fast enough for seeding.
    const weights: number[] = new Array(n);
    let total = 0;
    for (let rank = 1; rank <= n; rank++) {
      const w = 1 / Math.pow(rank, s);
      weights[rank - 1] = w;
      total += w;
    }
    let target = this.next() * total;
    for (let i = 0; i < n; i++) {
      target -= weights[i];
      if (target <= 0) return i;
    }
    return n - 1;
  }
}

function uuidFromHash(hash: string): string {
  return [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20, 32)].join(
    "-",
  );
}

// Stable, deterministic "UUID" derived from (seed, namespace, index) — same
// inputs always produce the same id, which is what makes --reset-less
// re-runs upsert instead of duplicate. Not a real UUIDv4 (no randomness),
// just a syntactically valid 8-4-4-4-12 hex string, which is all Postgres's
// uuid column requires.
export function deterministicUuid(seed: number, namespace: string, index: number): string {
  return uuidFromHash(createHash("sha256").update(`${seed}:${namespace}:${index}`).digest("hex"));
}

// Same idea but keyed only by a stable string, not the --seed value — for
// data whose identity shouldn't change across seeds, like a concept derived
// from a fixed CSO label.
export function stableUuid(namespace: string, key: string): string {
  return uuidFromHash(createHash("sha256").update(`${namespace}:${key}`).digest("hex"));
}
