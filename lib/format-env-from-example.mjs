/**
 * Format a pulled env Map using `.env.example` (or per-target `*.example`) layout:
 * preserve comments / section headers / blank lines, fill values from the merge,
 * append keys not present in the template at the bottom.
 */
import fs from "node:fs";
import path from "node:path";
import { formatEnvLine } from "./parse-dotenv.mjs";

/**
 * First existing file wins (target-specific template, then shared `.env.example`).
 *
 * @param {string} repoRoot
 * @param {"dev" | "preview" | "prod"} target
 * @returns {string | null} Absolute path, or null if no template exists
 */
export function resolveExampleTemplatePath(repoRoot, target) {
  /** @type {string[]} */
  const candidates =
    target === "dev"
      ? [".env.development.example", ".env.example"]
      : target === "preview"
        ? [".env.preview.example", ".env.example"]
        : [".env.production.example", ".env.example"];
  for (const rel of candidates) {
    const abs = path.join(repoRoot, rel);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

/**
 * If the line is a assignable `KEY=...` (not a comment), return the key.
 * Supports optional leading `export `.
 *
 * @param {string} line
 * @returns {string | null}
 */
function envLineKey(line) {
  let t = line.trim();
  if (!t || t.startsWith("#")) return null;
  if (t.startsWith("export ")) {
    t = t.slice(7).trim();
  }
  const eq = t.indexOf("=");
  if (eq <= 0) return null;
  const key = t.slice(0, eq).trim();
  if (!key || key.includes(" ")) return null;
  return key;
}

const EXTRA_SECTION = [
  "",
  "# -----------------------------------------------------------------------------",
  "# Additional variables (synced from Convex / Vercel; not in env template)",
  "# -----------------------------------------------------------------------------",
];

/**
 * @param {string} templateContent — raw example file
 * @param {Map<string, string>} values — merged + filtered for local workspace
 * @returns {string}
 */
export function formatEnvFromExampleTemplate(templateContent, values) {
  const lines = templateContent.split(/\r?\n/);
  /** @type {string[]} */
  const out = [];
  const usedKeys = new Set();

  for (const line of lines) {
    const key = envLineKey(line);
    if (key !== null && values.has(key)) {
      usedKeys.add(key);
      out.push(formatEnvLine(key, values.get(key) ?? ""));
    } else {
      out.push(line);
    }
  }

  const extraKeys = [...values.keys()]
    .filter((k) => !usedKeys.has(k))
    .sort();

  if (extraKeys.length > 0) {
    out.push(...EXTRA_SECTION);
    for (const k of extraKeys) {
      const v = values.get(k);
      if (v !== undefined) {
        out.push(formatEnvLine(k, v));
      }
    }
  }

  return out.join("\n") + (out.length ? "\n" : "");
}
