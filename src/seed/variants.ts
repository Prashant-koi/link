import type { Rng } from "./rng.js";

export type VariantKind = "canonical" | "alt_label" | "mangle" | "acronym" | "qualified" | "typo";

export interface SeedConcept {
  label: string;
  acronym: string | null;
}

// Section 4 of the seed data handoff: the distribution that makes
// resolution's exact/vector/model paths all actually get exercised, rather
// than every raw_text arriving pre-canonicalised (which would make
// resolution a no-op and prove nothing).
const DISTRIBUTION: { kind: VariantKind; share: number }[] = [
  { kind: "canonical", share: 0.4 },
  { kind: "alt_label", share: 0.25 },
  { kind: "mangle", share: 0.15 },
  { kind: "acronym", share: 0.1 },
  { kind: "qualified", share: 0.07 },
  { kind: "typo", share: 0.03 },
];

const QWERTY_NEIGHBORS: Record<string, string> = {
  a: "s", b: "v", c: "x", d: "s", e: "w", f: "d", g: "f", h: "j", i: "u",
  j: "h", k: "j", l: "k", m: "n", n: "m", o: "i", p: "o", q: "w", r: "e",
  s: "a", t: "r", u: "y", v: "c", w: "q", x: "z", y: "t", z: "x",
};

function caseOrSeparatorMangle(rng: Rng, label: string): string {
  const transforms: Array<(s: string) => string> = [
    (s) => s.replace(/\s+/g, "-").replace(/\b\w/g, (c) => c.toUpperCase()), // Machine-Learning
    (s) => s.replace(/\s+/g, ""), // machinelearning
    (s) => s.toUpperCase(),
    (s) => s.replace(/\s+/g, "_"),
  ];
  return rng.pick(transforms)(label);
}

function qualifiedPhrase(rng: Rng, label: string): string {
  const templates = [
    (s: string) => `applied ${s}`,
    (s: string) => `${s} stuff`,
    (s: string) => `intro to ${s}`,
    (s: string) => `advanced ${s}`,
  ];
  return rng.pick(templates)(label);
}

function typo(rng: Rng, label: string): string {
  const chars = label.split("");
  const letterPositions = chars
    .map((c, i) => (/[a-z]/i.test(c) ? i : -1))
    .filter((i) => i >= 0);
  if (letterPositions.length === 0) return label;

  const pos = rng.pick(letterPositions);
  if (rng.bool(0.5)) {
    // adjacent-key substitution
    const lower = chars[pos].toLowerCase();
    const neighbor = QWERTY_NEIGHBORS[lower];
    if (neighbor) {
      chars[pos] = neighbor;
      return chars.join("");
    }
  }
  // dropped character
  chars.splice(pos, 1);
  return chars.join("");
}

export function pickVariantKind(rng: Rng): VariantKind {
  const roll = rng.float();
  let cumulative = 0;
  for (const { kind, share } of DISTRIBUTION) {
    cumulative += share;
    if (roll < cumulative) return kind;
  }
  return "canonical";
}

// Produces the raw_text a person "typed" for a concept, plus which variant
// kind it is (for the seed report). knownAltLabels are the real CSO
// alternative labels for this concept, if any.
export function mangleSurface(
  rng: Rng,
  concept: SeedConcept,
  knownAltLabels: string[],
): { text: string; kind: VariantKind } {
  let kind = pickVariantKind(rng);

  if (kind === "alt_label" && knownAltLabels.length === 0) kind = "mangle";
  if (kind === "acronym" && !concept.acronym) kind = "mangle";

  switch (kind) {
    case "canonical":
      return { text: concept.label, kind };
    case "alt_label":
      return { text: rng.pick(knownAltLabels), kind };
    case "mangle":
      return { text: caseOrSeparatorMangle(rng, concept.label), kind };
    case "acronym":
      return { text: concept.acronym!, kind };
    case "qualified":
      return { text: qualifiedPhrase(rng, concept.label), kind };
    case "typo":
      return { text: typo(rng, concept.label), kind };
  }
}
