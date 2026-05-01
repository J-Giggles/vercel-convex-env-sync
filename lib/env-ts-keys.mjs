/**
 * Parse the host project's `env.ts` (zod validation file) to extract the set of
 * environment variables that are actively validated. Used by `env:sync:check` to
 * flag keys that exist in `.env.example` or hosted env but are no longer
 * validated by `env.ts` (deprecated / removed).
 *
 * Best-effort regex parser — handles the common pattern:
 *
 *   KEY: z.string()…
 *   KEY: z
 *       .string()…
 *
 * Multiple `z.object({...})` schemas in the same file are all walked; duplicate
 * keys across schemas are collapsed into one Set.
 */
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./paths.mjs";

/** Match `KEY:` followed by `z.` or `z<whitespace>` (so multi-line schemas count). */
const ENV_TS_KEY_RE = /^\s+([A-Z][A-Z0-9_]*)\s*:\s*z[\s.]/gm;

/**
 * Locate the host project's env validation file.
 *
 * @returns {string | null} Absolute path, or null if not present.
 */
export function resolveEnvTsPath() {
  for (const rel of ["env.ts", "src/env.ts", "lib/env.ts", "src/lib/env.ts"]) {
    const abs = path.join(REPO_ROOT, rel);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

/**
 * Read `env.ts` and return the set of validated environment variable names.
 *
 * @returns {Set<string> | null} `null` when no env.ts was found (cross-check is skipped).
 */
export function loadEnvTsKeys() {
  const envTsPath = resolveEnvTsPath();
  if (!envTsPath) return null;
  const content = fs.readFileSync(envTsPath, "utf8");
  const keys = new Set();
  ENV_TS_KEY_RE.lastIndex = 0;
  let m;
  while ((m = ENV_TS_KEY_RE.exec(content)) !== null) {
    keys.add(m[1]);
  }
  return keys;
}

/**
 * Read `.env.example` and return the set of declared keys.
 *
 * @returns {Set<string> | null} `null` when no template exists.
 */
export function loadEnvExampleKeys() {
  for (const rel of [".env.example", ".env.template"]) {
    const abs = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const content = fs.readFileSync(abs, "utf8");
    const keys = new Set();
    for (const rawLine of content.split(/\r?\n/)) {
      let line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      if (line.startsWith("export ")) line = line.slice(7).trim();
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      if (key) keys.add(key);
    }
    return keys;
  }
  return null;
}
