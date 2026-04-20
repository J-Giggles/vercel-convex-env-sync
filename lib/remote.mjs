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
import { SYNC_DIR, cachePath } from "./paths.mjs";
import { getVercelPreviewGitBranch } from "./vercel-preview-branch.mjs";

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
 * @param {{ useProd: boolean; convexEnv?: NodeJS.ProcessEnv }} opts — `useProd: true` → production deployment (`--prod`). Pass `convexEnv` so `CONVEX_DEPLOY_KEY` matches the same file as `env:sync:push`.
 */
export function fetchConvexEnvMapOptions(opts) {
  const extra = opts.useProd ? ["--prod"] : [];
  const execOpts = opts.convexEnv ? { env: opts.convexEnv } : {};
  const r = pnpmExec("convex", ["env", "list", ...extra], execOpts);
  if (!r.ok) {
    throw new Error(
      `convex env list failed (${r.status}):\n${r.stderr || r.stdout}`
    );
  }
  return parseConvexListOutput(r.stdout);
}

/**
 * @param {TTarget} target
 * @param {NodeJS.ProcessEnv} [convexEnv]
 */
export function fetchConvexEnvMap(target, convexEnv) {
  return fetchConvexEnvMapOptions({
    useProd: target === "prod",
    convexEnv,
  });
}

/**
 * `CONVEX_DEPLOYMENT` values from `.env*` are typically `dev:slug` or `prod:slug`.
 * Convex CLI uses `--prod` for production deployment env, else dev.
 *
 * @param {string | undefined} value
 */
export function convexUseProdFromDeploymentValue(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  return value.trimStart().startsWith("prod:");
}

/**
 * Fetch Convex env for the deployment described by `CONVEX_DEPLOYMENT` (same as push with `--from-sync`).
 *
 * @param {string | undefined} convexDeploymentValue
 * @param {NodeJS.ProcessEnv} [convexEnv]
 */
export function fetchConvexEnvMapForDeployment(convexDeploymentValue, convexEnv) {
  return fetchConvexEnvMapOptions({
    useProd: convexUseProdFromDeploymentValue(convexDeploymentValue),
    convexEnv,
  });
}

/**
 * Suffix args for `convex env set …` (`--prod` or none). With `--from-sync`, uses
 * `CONVEX_DEPLOYMENT` in the file (`prod:…` → production deployment).
 *
 * @param {TTarget} target
 * @param {Map<string, string>} localMap
 * @param {boolean} fromSync
 * @returns {string[]}
 */
export function convexEnvSetSuffixArgs(target, localMap, fromSync) {
  if (fromSync) {
    const d = localMap.get("CONVEX_DEPLOYMENT");
    if (typeof d !== "string" || !d.trim()) {
      throw new Error(
        "[env:sync] --from-sync requires CONVEX_DEPLOYMENT in the sync file."
      );
    }
    return convexUseProdFromDeploymentValue(d) ? ["--prod"] : [];
  }
  return convexArgsForTarget(target);
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
  fs.mkdirSync(SYNC_DIR, { recursive: true });
  const outFile = cachePath(`cache.vercel.${safe}.env`);
  /** Preview vars are often branch-scoped; align pull with push (default branch `staging`). */
  const pullArgs = [
    "env",
    "pull",
    outFile,
    "--environment",
    environment,
    "--yes",
  ];
  if (environment === "preview") {
    const branch = getVercelPreviewGitBranch();
    if (branch) {
      pullArgs.push("--git-branch", branch);
    }
  }
  const r = runVercel(pullArgs);
  if (!r.ok) {
    throw new Error(
      `vercel env pull failed (${r.status}):\n${r.stderr || r.stdout}`
    );
  }
  const content = fs.readFileSync(outFile, "utf8");
  try {
    fs.unlinkSync(outFile);
  } catch {
    /* ignore */
  }
  return parseDotenv(content);
}

/**
 * Pull Vercel env to a temp file and parse.
 * @param {TTarget} target
 */
export function fetchVercelEnvMap(target) {
  return fetchVercelEnvMapOptions(vercelEnvName(target));
}
