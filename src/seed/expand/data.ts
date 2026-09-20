import fs from "node:fs";
import path from "node:path";

// The vendored open datasets (see db/seed-data/open/SOURCES.md).
const DIR = path.resolve("db/seed-data/open");
const read = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8")) as T;

export interface CipFamily { code: string; title: string; definition: string }
export interface CipSeries { code: string; family: string; title: string; definition: string }
export interface CipProgram { code: string; series: string; family: string; title: string; definition: string }

export const cip = read<{ families: CipFamily[]; series: CipSeries[]; programs: CipProgram[] }>("cip.json");
export const hobbies = read<{ sports: string[]; genres: string[]; art: string[] }>("hobbies.json");
export const names = read<{ forenames: Record<string, [string, "M" | "F"][]>; surnames: Record<string, string[]> }>("names.json");
