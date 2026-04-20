/**
 * Spawn CLI commands with captured stdout/stderr.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseDotenv } from "./parse-dotenv.mjs";
import { REPO_ROOT } from "./paths.mjs";
import { extractConvexDeploymentSlug } from "./convex-vercel-link.mjs";

/** @typedef {"dev" | "preview" | "prod"} TSyncTarget */

/** Root env files that may define Convex routing before the Convex CLI reads them. */
const CONVEX_CLI_ENV_FILE_CANDIDATES = [
  ".env.local",
  ".env.production.local",
  ".env.development.local",
  ".env",
];

/**
 * Prefix of `CONVEX_DEPLOY_KEY` before `|` (e.g. `dev:slug` or `prod:slug`).
 *
 * @param {string | undefined} raw
 * @returns {string | undefined}
 */
function deployKeyHead(raw) {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  return raw.split("|")[0].trim() || undefined;
}

/**
 * Whether `convex env list` / `convex env set` should pass `--prod`.
 * `CONVEX_DEPLOY_KEY` prefix wins; otherwise the sync / Vercel preset (`prod` → production).
 *
 * @param {Map<string, string>} localMap
 * @param {TSyncTarget} presetTarget
 * @returns {boolean}
 */
export function inferConvexUseProdFromLocalMap(localMap, presetTarget) {
  const head = deployKeyHead(localMap.get("CONVEX_DEPLOY_KEY"));
  if (head) {
    if (head.startsWith("prod:")) return true;
    if (head.startsWith("dev:")) return false;
  }
  return presetTarget === "prod";
}

/**
 * Value for `CONVEX_DEPLOYMENT` in the Convex CLI subprocess (`dev:slug`, `prod:slug`, or legacy).
 *
 * @param {Map<string, string>} localMap
 * @param {TSyncTarget} presetTarget
 * @returns {string | undefined}
 */
export function convexDeploymentSelectorForCli(localMap, presetTarget) {
  const legacy = localMap.get("CONVEX_DEPLOYMENT")?.trim();
  if (legacy) {
    return legacy.includes("|") ? legacy.split("|")[0].trim() : legacy;
  }
  const head = deployKeyHead(localMap.get("CONVEX_DEPLOY_KEY"));
  if (head) return head;
  const slug = extractConvexDeploymentSlug(localMap);
  if (!slug) return undefined;
  return presetTarget === "prod" ? `prod:${slug}` : `dev:${slug}`;
}

/**
 * @param {Map<string, string>} map
 * @param {TSyncTarget} presetTargetWhenSynthetic
 * @returns {string | undefined}
 */
function convexDeploymentRawFromParsedMap(map, presetTargetWhenSynthetic) {
  const legacy = map.get("CONVEX_DEPLOYMENT")?.trim();
  if (legacy) return legacy;
  const head = deployKeyHead(map.get("CONVEX_DEPLOY_KEY"));
  if (head) return head;
  const slug = extractConvexDeploymentSlug(map);
  if (!slug) return undefined;
  return presetTargetWhenSynthetic === "prod" ? `prod:${slug}` : `dev:${slug}`;
}

/**
 * @param {NodeJS.ProcessEnv} base
 * @returns {Map<string, string>}
 */
function convexLinkMapFromProcessEnv(base) {
  const m = new Map();
  for (const k of [
    "NEXT_PUBLIC_CONVEX_URL",
    "CONVEX_URL",
    "NEXT_PUBLIC_CONVEX_SITE_URL",
    "CONVEX_DEPLOY_KEY",
  ]) {
    const v = base[k];
    if (typeof v === "string" && v.trim()) m.set(k, v);
  }
  return m;
}

/**
 * Read a deployment selector from process env or the first existing project `.env*` file.
 * Uses `CONVEX_DEPLOYMENT`, `CONVEX_DEPLOY_KEY`, or Convex URLs (same as sync snapshots).
 *
 * @param {NodeJS.ProcessEnv} base
 * @returns {string | undefined}
 */
function readConvexDeploymentRaw(base) {
  const fromEnv = base.CONVEX_DEPLOYMENT;
  if (typeof fromEnv === "string" && fromEnv.trim()) {
    return fromEnv.trim();
  }
  const fromKeyEnv = deployKeyHead(base.CONVEX_DEPLOY_KEY);
  if (fromKeyEnv) return fromKeyEnv;
  const fromUrls = convexDeploymentRawFromParsedMap(
    convexLinkMapFromProcessEnv(base),
    "dev"
  );
  if (fromUrls) return fromUrls;

  for (const rel of CONVEX_CLI_ENV_FILE_CANDIDATES) {
    const abs = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    try {
      const map = parseDotenv(fs.readFileSync(abs, "utf8"));
      const raw = convexDeploymentRawFromParsedMap(map, "dev");
      if (raw) return raw;
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * Hosted env sometimes stores deployment vars as `deploymentSlug|opaqueToken`.
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
 * @param {TSyncTarget} presetTarget — which Vercel/sync scope this file belongs to (`dev` / `preview` / `prod`)
 * @returns {NodeJS.ProcessEnv}
 */
export function buildConvexCliEnvForPushLocalMap(
  localMap,
  fromSync,
  presetTarget
) {
  const env = { ...process.env };
  const sel = convexDeploymentSelectorForCli(localMap, presetTarget);
  if (sel) env.CONVEX_DEPLOYMENT = sel;
  const dk = localMap.get("CONVEX_DEPLOY_KEY");
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
