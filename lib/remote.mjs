/**
 * Fetch env maps from Convex and Vercel CLIs.
 */
import fs from "node:fs";
import path from "node:path";
import { pnpmExec, run } from "./exec.mjs";

/**
 * @param {string[]} args
 */
function runVercel(args) {
  let r = run("vercel", args);
  if (!r.ok && (r.error || /not found|ENOENT/i.test(r.stderr))) {
    r = run("pnpm", ["dlx", "vercel", ...args]);
  }
  return r;
}
import { parseDotenv } from "./parse-dotenv.mjs";
import { SYNC_DIR } from "./paths.mjs";

/** @typedef {"dev" | "preview" | "prod"} TTarget */

/**
 * @param {TTarget} target
 * @returns {string[]} convex extra args (e.g. --prod)
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
 * Fetch Convex env as a Map (parses `convex env list` output).
 * @param {TTarget} target
 */
export function fetchConvexEnvMap(target) {
  const extra = convexArgsForTarget(target);
  const r = pnpmExec("convex", [...extra, "env", "list"]);
  if (!r.ok) {
    throw new Error(
      `convex env list failed (${r.status}):\n${r.stderr || r.stdout}`
    );
  }
  return parseConvexListOutput(r.stdout);
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
 * Pull Vercel env to a temp file and parse.
 * @param {TTarget} target
 */
export function fetchVercelEnvMap(target) {
  const env = vercelEnvName(target);
  fs.mkdirSync(SYNC_DIR, { recursive: true });
  const outFile = path.join(SYNC_DIR, `.cache.vercel.${target}.env`);
  const r = runVercel(["env", "pull", outFile, "--environment", env, "--yes"]);
  if (!r.ok) {
    throw new Error(
      `vercel env pull failed (${r.status}):\n${r.stderr || r.stdout}`
    );
  }
  const content = fs.readFileSync(outFile, "utf8");
  return parseDotenv(content);
}
