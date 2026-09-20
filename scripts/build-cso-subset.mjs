// One-time (re-runnable) build step: downloads the real Computer Science
// Ontology CSV, extracts a depth-3 subset under 8 top-level branches, and
// writes a small deterministic JSON artifact the seeder loads from —
// see db/seed-data/README.md. Re-run only if you want a different branch
// set or the ontology version changes; the output is checked into the repo
// so seeding itself needs no network access.
import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "db", "seed-data");
const CSV_URL = "https://cso.kmi.open.ac.uk/download/version-3.5/cso_v3.5.csv";
const CACHE_PATH = path.join(OUT_DIR, ".cso-cache.csv");

const BRANCHES = [
  "machine learning",
  "computer networks",
  "software engineering",
  "computer vision",
  "cryptography",
  "database systems",
  "human computer interaction",
  "robotics",
];

const MAX_DEPTH = 3;
const PER_BRANCH_CAP = 160; // 8 branches * 160 ~= 1200 total, doc's target
const MAX_ALIASES_PER_CONCEPT = 5;

function parseCsvLine(line) {
  // CSO's csv_for_classifier export: subject;predicate;object, fields
  // double-quoted only when they contain a comma/semicolon/space-sensitive
  // content. A tiny hand-rolled splitter is enough here (no embedded
  // semicolons inside quoted fields in this dataset).
  const parts = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === ";" && !inQuotes) {
      parts.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  parts.push(cur);
  return parts;
}

async function main() {
  let text;
  try {
    text = await readFile(CACHE_PATH, "utf8");
    console.log(`Using cached CSV at ${CACHE_PATH}`);
  } catch {
    console.log(`Downloading ${CSV_URL} ...`);
    const res = await fetch(CSV_URL);
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    text = await res.text();
    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(CACHE_PATH, text);
  }
  const lines = text.split("\n").filter(Boolean);
  console.log(`Parsed ${lines.length} raw triples`);

  const primaryLabel = new Map(); // label -> canonical label
  const broader = new Map(); // canonical -> Set(canonical child)
  const related = new Map(); // canonical -> Set(canonical related)
  const aliasCandidates = new Map(); // canonical -> Set(surface variant)

  function addTo(map, key, value) {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(value);
  }

  for (const line of lines) {
    const [subj, pred, obj] = parseCsvLine(line);
    if (pred === "klink:primaryLabel") {
      primaryLabel.set(subj, obj);
    }
  }

  const canonical = (label) => primaryLabel.get(label) ?? label;

  for (const line of lines) {
    const [subj, pred, obj] = parseCsvLine(line);
    if (pred === "klink:broaderGeneric") {
      const a = canonical(subj);
      const b = canonical(obj);
      if (a !== b) addTo(broader, a, b);
    } else if (pred === "klink:contributesTo") {
      const a = canonical(subj);
      const b = canonical(obj);
      if (a !== b) addTo(related, a, b);
    }
  }

  for (const [surface, canon] of primaryLabel) {
    if (surface !== canon) addTo(aliasCandidates, canon, surface);
  }

  for (const branch of BRANCHES) {
    if (!broader.has(canonical(branch))) {
      console.warn(`WARNING: branch root "${branch}" not found as canonical(...) with children in this CSO version`);
    }
  }

  // Breadth-first per branch, capped, so no single huge subtree (machine
  // learning) starves the others before they're ever visited.
  const depthOf = new Map(); // canonical label -> min depth across branches
  const parentOf = new Map(); // canonical label -> the parent it was first discovered from
  const branchOf = new Map();

  for (const branchRaw of BRANCHES) {
    const root = canonical(branchRaw);
    if (depthOf.has(root)) continue;
    depthOf.set(root, 0);
    branchOf.set(root, root);

    let frontier = [root];
    let collectedThisBranch = 1;
    for (let depth = 1; depth <= MAX_DEPTH && collectedThisBranch < PER_BRANCH_CAP; depth++) {
      const nextFrontier = [];
      for (const node of frontier) {
        const children = broader.get(node);
        if (!children) continue;
        for (const child of children) {
          if (depthOf.has(child)) continue; // already placed at a shallower depth
          if (collectedThisBranch >= PER_BRANCH_CAP) break;
          depthOf.set(child, depth);
          parentOf.set(child, node);
          branchOf.set(child, root);
          nextFrontier.push(child);
          collectedThisBranch++;
        }
        if (collectedThisBranch >= PER_BRANCH_CAP) break;
      }
      frontier = nextFrontier;
    }
    console.log(`Branch "${root}": ${collectedThisBranch} concepts`);
  }

  const conceptSet = new Set(depthOf.keys());
  console.log(`Total concepts collected: ${conceptSet.size}`);

  function acronymFor(label) {
    const words = label
      .replace(/[()]/g, "")
      .split(/[\s-]+/)
      .filter((w) => /^[a-z]+$/i.test(w));
    if (words.length < 2) return null;
    const acronym = words.map((w) => w[0]).join("").toLowerCase();
    return acronym.length >= 2 && acronym.length <= 4 ? acronym : null;
  }

  const concepts = [...conceptSet].map((label) => {
    const depth = depthOf.get(label);
    const parentLabel = parentOf.get(label) ?? null;
    const definition =
      depth === 0
        ? `${label} — a top-level area of computer science`
        : `${label} — a topic in ${parentLabel}`;
    return { label, depth, parentLabel, branch: branchOf.get(label), definition, acronym: acronymFor(label) };
  });

  const aliases = [];
  for (const label of conceptSet) {
    const candidates = [...(aliasCandidates.get(label) ?? [])]
      .filter((s) => s !== label)
      .sort((a, b) => a.length - b.length) // prefer shorter/cleaner variants
      .slice(0, MAX_ALIASES_PER_CONCEPT);
    for (const surface of candidates) aliases.push({ surface, conceptLabel: label });
  }
  console.log(`Total CSO-derived aliases: ${aliases.length}`);

  const relations = [];
  for (const [src, children] of broader) {
    if (!conceptSet.has(src)) continue;
    for (const dst of children) {
      if (conceptSet.has(dst)) relations.push({ srcLabel: src, dstLabel: dst, kind: "broader" });
    }
  }
  for (const [src, others] of related) {
    if (!conceptSet.has(src)) continue;
    for (const dst of others) {
      if (conceptSet.has(dst) && src !== dst) relations.push({ srcLabel: src, dstLabel: dst, kind: "related" });
    }
  }
  console.log(`Total concept relations: ${relations.length}`);

  await mkdir(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, "cso-subset.json");
  await writeFile(
    outPath,
    JSON.stringify({ source: CSV_URL, branches: BRANCHES, concepts, aliases, relations }, null, 2),
  );
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
