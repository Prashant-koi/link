// Builds db/seed-data/open/*.json from open datasets, so seeding needs no
// network (same idea as build-cso-subset.mjs). Raw downloads are cached in
// db/seed-data/open/.cache (gitignored); delete it to force a fresh download.
//
//   node scripts/build-open-vocab.mjs
//
// Sources and licences are recorded in db/seed-data/open/SOURCES.md.

import fs from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve("db/seed-data/open");
const CACHE = path.join(OUT, ".cache");
const SOURCES = {
  "cip.csv": "https://nces.ed.gov/ipeds/cipcode/Files/CIPCode2020.csv",
  "sports.json": "https://raw.githubusercontent.com/dariusk/corpora/master/data/sports/sports.json",
  "genres.json": "https://raw.githubusercontent.com/dariusk/corpora/master/data/music/genres.json",
  "isms.json": "https://raw.githubusercontent.com/dariusk/corpora/master/data/art/isms.json",
  "forenames.csv": "https://raw.githubusercontent.com/sigpwned/popular-names-by-country-dataset/master/common-forenames-by-country.csv",
  "surnames.csv": "https://raw.githubusercontent.com/sigpwned/popular-names-by-country-dataset/master/common-surnames-by-country.csv",
};

async function fetchCached(name) {
  const file = path.join(CACHE, name);
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    const res = await fetch(SOURCES[name], { headers: { "User-Agent": "LinkHackathonSeed/1.0" } });
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    const text = await res.text();
    await fs.mkdir(CACHE, { recursive: true });
    await fs.writeFile(file, text);
    return text;
  }
}

// Minimal RFC-4180 parser (quoted fields, doubled quotes, newlines in quotes).
function parseCsv(text) {
  text = text.replace(/^﻿/, "");
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const ascii = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const unwrap = (s) => s.replace(/^="?/, "").replace(/"$/, "").trim(); // CIP writes codes as ="01.0101"
function titleCase(s) {
  return s.toLowerCase().replace(/(^|[\s\/(-])([a-z])/g, (_, p, c) => p + c.toUpperCase()).replace(/\b(And|Of|The|In|For|To|Or|On)\b(?!$)/g, (w, _1, off) => (off === 0 ? w : w.toLowerCase()));
}
const cleanTitle = (t) => t.replace(/\.$/, "").replace(/,\s*General$/i, "").trim();

// ---- CIP (US Dept of Education, public domain) -----------------------------
const cip = parseCsv(await fetchCached("cip.csv"));
const families = [], series = [], programs = [];
for (const r of cip) {
  if (/deleted/i.test(r.Action)) continue;
  const code = unwrap(r.CIPCode);
  const title = r.CIPTitle.trim();
  const definition = r.CIPDefinition.trim();
  if (/^Instructional content is defined in code/i.test(definition)) continue;
  if (code.length === 2) families.push({ code, title: titleCase(cleanTitle(title)), definition });
  else if (code.length === 5) series.push({ code, family: code.slice(0, 2), title: cleanTitle(title), definition });
  else if (code.length === 7) {
    if (/(^Other\b|, Other$|\bOther\b\.?$)/i.test(title)) continue;
    programs.push({ code, series: code.slice(0, 5), family: code.slice(0, 2), title: cleanTitle(title), definition });
  }
}
await fs.writeFile(path.join(OUT, "cip.json"), JSON.stringify({ families, series, programs }, null, 1));
console.log(`cip: ${families.length} families, ${series.length} series, ${programs.length} programs`);

// ---- Hobbies (dariusk/corpora, CC0) ----------------------------------------
const okLabel = (s) => /^[A-Za-z][A-Za-z '\-]*$/.test(s) && s.split(/\s+/).length <= 3 && s.length <= 28;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const uniq = (list) => [...new Map(list.map((x) => [x.toLowerCase(), x])).values()];
const sports = uniq(JSON.parse(await fetchCached("sports.json")).sports.filter(okLabel).map(cap));
const genres = uniq(JSON.parse(await fetchCached("genres.json")).genres.filter(okLabel).map(cap));
const art = uniq(JSON.parse(await fetchCached("isms.json")).isms.filter(okLabel).map((s) => titleCase(s)));
await fs.writeFile(path.join(OUT, "hobbies.json"), JSON.stringify({ sports, genres, art }, null, 1));
console.log(`hobbies: ${sports.length} sports, ${genres.length} music genres, ${art.length} art movements`);

// ---- Names by country (sigpwned, CC0) --------------------------------------
const forenames = {}, surnames = {};
for (const r of parseCsv(await fetchCached("forenames.csv"))) {
  const n = ascii(r["Romanized Name"] || r["Localized Name"] || "").trim();
  if (!/^[A-Za-z][A-Za-z'\-]{1,18}$/.test(n) || !/^[MF]$/.test(r.Gender)) continue;
  (forenames[r.Country] ??= []).push([n, r.Gender]);
}
for (const r of parseCsv(await fetchCached("surnames.csv"))) {
  const n = ascii(r["Romanized Name"] || r["Localized Name"] || "").trim();
  if (!/^[A-Za-z][A-Za-z'\-]{1,20}$/.test(n)) continue;
  (surnames[r.Country] ??= []).push(n);
}
for (const k of Object.keys(forenames)) forenames[k] = [...new Map(forenames[k].map((x) => [x[0] + x[1], x])).values()];
for (const k of Object.keys(surnames)) surnames[k] = [...new Set(surnames[k])];
// Only countries that have both lists can produce a full name.
for (const k of Object.keys(forenames)) if (!surnames[k] || surnames[k].length < 5 || forenames[k].length < 10) delete forenames[k];
await fs.writeFile(path.join(OUT, "names.json"), JSON.stringify({ forenames, surnames }));
console.log(`names: ${Object.keys(forenames).length} countries, ${Object.values(forenames).flat().length} forenames, ${Object.values(surnames).flat().length} surnames`);

await fs.writeFile(
  path.join(OUT, "SOURCES.md"),
  `# Open data used by \`npm run seed:expand\`

Built by \`scripts/build-open-vocab.mjs\`; the JSON here is checked in so seeding needs no network.

| File | Derived from | Licence |
| --- | --- | --- |
| \`cip.json\` | NCES *Classification of Instructional Programs* 2020, ${SOURCES["cip.csv"]} | US Government work, public domain |
| \`hobbies.json\` | dariusk/corpora \`sports\`, \`music/genres\`, \`art/isms\`, https://github.com/dariusk/corpora | CC0 / public domain |
| \`names.json\` | sigpwned/popular-names-by-country-dataset (forenames and surnames by country) | CC0 |

Person names are random first x last combinations from these lists; they do not identify real people.
Clubs, labs and departments are fictional campus entities named from these vocabularies.
`,
);
