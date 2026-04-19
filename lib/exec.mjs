/**
 * Spawn CLI commands with captured stdout/stderr.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseDotenv } from "./parse-dotenv.mjs";
import { REPO_ROOT } from "./paths.mjs";

/** Root env files that may define CONVEX_DEPLOYMENT before the Convex CLI reads them. */
const CONVEX_DEPLOYMENT_FILE_CANDIDATES = [
  ".env.local",
  ".env.production.local",
  ".env.development.local",
  ".env",
];

/**
 * Read CONVEX_DEPLOYMENT from process env or the first existing project `.env*` file.
 * @param {NodeJS.ProcessEnv} base
 * @returns {string | undefined}
 */
function readConvexDeploymentRaw(base) {
  const fromEnv = base.CONVEX_DEPLOYMENT;
  if (typeof fromEnv === "string" && fromEnv.trim()) {
    return fromEnv;
  }
  for (const rel of CONVEX_DEPLOYMENT_FILE_CANDIDATES) {
    const abs = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    try {
      const map = parseDotenv(fs.readFileSync(abs, "utf8"));
      const v = map.get("CONVEX_DEPLOYMENT");
      if (typeof v === "string" && v.trim()) return v;
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * Hosted env sometimes stores `CONVEX_DEPLOYMENT` as `deploymentSlug|opaqueToken`.
 * The Convex CLI would otherwise build invalid API paths (instance name longer than 64 chars).
 * We **inject** the slug-only value into `env` so it is set before the CLI loads dotenv
 * (dotenv typically does not override existing variables).
 *
 * @param {NodeJS.ProcessEnv} base
 * @returns {NodeJS.ProcessEnv}
 */
export function envForConvexCli(base = process.env) {
  const env = { ...base };
  const raw = readConvexDeploymentRaw(base);
  if (typeof raw !== "string") return env;
  const slug = raw.includes("|") ? raw.split("|")[0].trim() : raw.trim();
  if (slug) env.CONVEX_DEPLOYMENT = slug;
  return env;
}

/**
 * Env for `pnpm exec convex …` when pushing from a merged local file.
 * The Convex CLI **prefers `CONVEX_DEPLOY_KEY`** over `--prod` / `CONVEX_DEPLOYMENT` alone — if the parent
 * shell has a deploy key for deployment A but the file documents deployment B, pushes would hit A unless
 * we overlay the key from the same file (or clear it for `--from-sync` when absent).
 *
 * @param {Map<string, string>} localMap — parsed push source (e.g. `.env.sync.preview`)
 * @param {boolean} fromSync
 * @returns {NodeJS.ProcessEnv}
 */
export function buildConvexCliEnvForPushLocalMap(localMap, fromSync) {
  const env = { ...process.env };
  const dep = localMap.get("CONVEX_DEPLOYMENT");
  const dk = localMap.get("CONVEX_DEPLOY_KEY");
  if (typeof dep === "string" && dep.trim()) {
    env.CONVEX_DEPLOYMENT = dep.trim();
  }
  if (typeof dk === "string" && dk.trim()) {
    env.CONVEX_DEPLOY_KEY = dk.trim();
  } else if (fromSync) {
    delete env.CONVEX_DEPLOY_KEY;
  }
  return env;
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string; input?: string; env?: NodeJS.ProcessEnv }} [opts]
 */
export function run(command, args, opts = {}) {
  const isPnpmExecConvex =
    command === "pnpm" &&
    args[0] === "exec" &&
    args[1] === "convex";
  const env = isPnpmExecConvex
    ? envForConvexCli(opts.env ?? process.env)
    : opts.env ?? process.env;

  const r = spawnSync(command, args, {
    cwd: opts.cwd ?? REPO_ROOT,
    encoding: "utf8",
    env,
    input: opts.input,
    maxBuffer: 20 * 1024 * 1024,
    stdio: opts.input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
  });
  const err = r.error;
  return {
    ok: r.status === 0 && !err,
    status: r.status ?? (err ? 127 : 0),
    stdout: r.stdout ?? "",
    stderr: (err ? `${err.message}\n` : "") + (r.stderr ?? ""),
    error: err,
  };
}

/**
 * Run `pnpm exec <binary> ...` from repo root.
 * @param {{ cwd?: string; input?: string; env?: NodeJS.ProcessEnv }} [opts]
 */
export function pnpmExec(binary, args, opts) {
  return run("pnpm", ["exec", binary, ...args], opts ?? {});
}
