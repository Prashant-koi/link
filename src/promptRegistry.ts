import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { pool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.join(__dirname, "..", "prompts");

export type PromptName =
  | "concept_adjudication"
  | "concept_propose"
  | "bio_extract"
  | "explain_pair"
  | "parse_ask"
  | "search_interpret"
  | "search_blurb";

interface PromptFile {
  name: PromptName;
  version: number;
  model: string;
  system_body: string;
  user_template: string;
  params?: Record<string, unknown>;
}

export interface RegisteredPrompt extends PromptFile {
  bodyHash: string;
}

function bodyHash(systemBody: string, userTemplate: string): string {
  return createHash("sha256").update(systemBody).update("\u0000").update(userTemplate).digest("hex");
}

async function readPromptFiles(): Promise<PromptFile[]> {
  const files = (await readdir(PROMPTS_DIR)).filter((f) => f.endsWith(".yaml"));
  const prompts: PromptFile[] = [];
  for (const file of files) {
    const raw = await readFile(path.join(PROMPTS_DIR, file), "utf8");
    prompts.push(yaml.load(raw) as PromptFile);
  }
  return prompts;
}

// Hashes each prompts/*.yaml on boot and registers it in the `prompt` table.
// A given (name, version) is immutable once registered: if the file content
// changed without a version bump, that's an authoring error, not something
// to silently absorb.
export async function loadPrompts(): Promise<RegisteredPrompt[]> {
  const files = await readPromptFiles();
  const registered: RegisteredPrompt[] = [];

  for (const file of files) {
    const hash = bodyHash(file.system_body, file.user_template);
    const existing = await pool.query(
      `SELECT body_hash FROM prompt WHERE name = $1 AND version = $2`,
      [file.name, file.version],
    );

    if (existing.rows.length > 0) {
      if (existing.rows[0].body_hash !== hash) {
        throw new Error(
          `prompts/${file.name}.yaml changed without a version bump ` +
            `(name=${file.name}, version=${file.version})`,
        );
      }
    } else {
      await pool.query(
        `INSERT INTO prompt (name, version, system_body, user_template, model, params, body_hash, active)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, true)`,
        [
          file.name,
          file.version,
          file.system_body,
          file.user_template,
          file.model,
          JSON.stringify(file.params ?? {}),
          hash,
        ],
      );
      await pool.query(
        `UPDATE prompt SET active = false WHERE name = $1 AND version <> $2`,
        [file.name, file.version],
      );
    }

    registered.push({ ...file, bodyHash: hash });
  }

  return registered;
}

export async function getActivePrompt(name: PromptName): Promise<RegisteredPrompt> {
  const { rows } = await pool.query(
    `SELECT name, version, system_body, user_template, model, params, body_hash
     FROM prompt WHERE name = $1 AND active = true
     ORDER BY version DESC LIMIT 1`,
    [name],
  );
  if (rows.length === 0) {
    throw new Error(`No active prompt registered for ${name}`);
  }
  const row = rows[0];
  return {
    name: row.name,
    version: row.version,
    system_body: row.system_body,
    user_template: row.user_template,
    model: row.model,
    params: row.params,
    bodyHash: row.body_hash,
  };
}
