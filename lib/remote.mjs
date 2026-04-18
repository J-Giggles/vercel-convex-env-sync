/**
 * Fetch env maps from Convex and Vercel CLIs.
 */
import fs from "node:fs";
import { pnpmExec, run } from "./exec.mjs";

/**
 * Run the Vercel CLI (`vercel` on PATH, else `pnpm dlx vercel`).
 *
 * @param {string[]} args
 */
export function runVercel(args) {
  let r = run("vercel", args);
  if (!r.ok && (r.error || /not found|ENOENT/i.test(r.stderr))) {
    r = run("pnpm", ["dlx", "vercel", ...args]);
  }
  return r;
}
import { parseDotenv } from "./parse-dotenv.mjs";
import { envSyncPath } from "./paths.mjs";

/** @typedef {"dev" | "preview" | "prod"} TTarget */

/**
 * @param {TTarget} target
 * @returns {string[]} suffix args for `convex env …` (e.g. `--prod` must come **after** `env list` / `env set`, not before `env`).
 */
export function convexArgsForTarget(target) {
  if (target === "prod") return ["--prod"];
  return [];
}

/**
 * Map target to Vercel environment name.
 * @param {TTarget} target
 */
export function vercelEnvName(target) {
  if (target === "prod") return "production";
  if (target === "preview") return "preview";
  return "development";
}

/**
 * Map Vercel env pull scope to the preset used for `.env` templates and file paths.
 *
 * @param {"development" | "preview" | "production"} vercelEnvironment
 * @returns {TTarget}
 */
export function vercelEnvironmentToPresetTarget(vercelEnvironment) {
  if (vercelEnvironment === "production") return "prod";
  if (vercelEnvironment === "preview") return "preview";
  return "dev";
}

/**
 * Fetch Convex env as a Map (parses `convex env list` output).
 * @param {{ useProd: boolean }} opts — `useProd: true` → production deployment (`--prod`).
 */
export function fetchConvexEnvMapOptions(opts) {
  const extra = opts.useProd ? ["--prod"] : [];
  const r = pnpmExec("convex", ["env", "list", ...extra]);
  if (!r.ok) {
    throw new Error(
      `convex env list failed (${r.status}):\n${r.stderr || r.stdout}`
    );
  }
  return parseConvexListOutput(r.stdout);
}

/**
 * @param {TTarget} target
 */
export function fetchConvexEnvMap(target) {
  return fetchConvexEnvMapOptions({ useProd: target === "prod" });
}

/**
 * Convex prints lines like NAME=value (value may be quoted).
 * @param {string} stdout
 */
function parseConvexListOutput(stdout) {
  const map = new Map();
  for (const line of stdout.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map.set(key, value);
  }
  return map;
}

/**
 * @param {"development" | "preview" | "production"} environment
 */
export function fetchVercelEnvMapOptions(environment) {
  const safe = environment.replace(/[^a-z0-9-]/gi, "-");
  const outFile = envSyncPath(`cache.vercel.${safe}`);
  const r = runVercel([
    "env",
    "pull",
    outFile,
    "--environment",
    environment,
    "--yes",
  ]);
  if (!r.ok) {
    throw new Error(
      `vercel env pull failed (${r.status}):\n${r.stderr || r.stdout}`
    );
  }
  const content = fs.readFileSync(outFile, "utf8");
  return parseDotenv(content);
}

/**
 * Pull Vercel env to a temp file and parse.
 * @param {TTarget} target
 */
export function fetchVercelEnvMap(target) {
  return fetchVercelEnvMapOptions(vercelEnvName(target));
}
