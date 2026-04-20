/**
 * Fetch env maps from Convex and Vercel CLIs.
 */
import fs from "node:fs";
import { vercelMapHasConvexLinkKeys } from "./convex-vercel-link.mjs";
import { syncInfo, syncWarn } from "./cli-style.mjs";
import { inferConvexUseProdFromLocalMap, pnpmExec, run } from "./exec.mjs";
import { parseDotenv } from "./parse-dotenv.mjs";
import { SYNC_DIR, cachePath } from "./paths.mjs";
import {
  getVercelPreviewGitBranch,
  getVercelPreviewPullBranchCandidates,
  isVercelPreviewNoGitBranch,
} from "./vercel-preview-branch.mjs";

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
 * Suffix args for `convex env set …` (`--prod` or none). With `--from-sync`, uses
 * `CONVEX_DEPLOY_KEY` prefix (`prod:…` / `dev:…`) and/or the sync target.
 *
 * @param {TTarget} target
 * @param {Map<string, string>} localMap
 * @param {boolean} fromSync
 * @returns {string[]}
 */
export function convexEnvSetSuffixArgs(target, localMap, fromSync) {
  if (fromSync) {
    return inferConvexUseProdFromLocalMap(localMap, target) ? ["--prod"] : [];
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

  if (environment !== "preview") {
    const pullArgs = [
      "env",
      "pull",
      outFile,
      "--environment",
      environment,
      "--yes",
    ];
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

  /** Preview without git branch: all Preview deployments (Vercel CLI omits `--git-branch`). */
  if (isVercelPreviewNoGitBranch()) {
    const pullArgs = [
      "env",
      "pull",
      outFile,
      "--environment",
      environment,
      "--yes",
    ];
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
    syncInfo(
      "Preview env pull: unscoped Preview (no `--git-branch`). Applies to all Preview deployments."
    );
    return parseDotenv(content);
  }

  /** Preview: try `staging` first, then current git branch, until a pull includes Convex link keys. */
  const branches = getVercelPreviewPullBranchCandidates();
  const primary = getVercelPreviewGitBranch();
  /** @type {Error | null} */
  let lastErr = null;
  /** @type {Map<string, string> | null} */
  let lastMap = null;

  for (let i = 0; i < branches.length; i++) {
    const branch = branches[i];
    const pullArgs = [
      "env",
      "pull",
      outFile,
      "--environment",
      environment,
      "--yes",
      "--git-branch",
      branch,
    ];
    const r = runVercel(pullArgs);
    if (!r.ok) {
      lastErr = new Error(
        `vercel env pull failed (${r.status}) for preview branch "${branch}":\n${r.stderr || r.stdout}`
      );
      try {
        fs.unlinkSync(outFile);
      } catch {
        /* ignore */
      }
      continue;
    }
    const content = fs.readFileSync(outFile, "utf8");
    try {
      fs.unlinkSync(outFile);
    } catch {
      /* ignore */
    }
    const map = parseDotenv(content);
    lastMap = map;
    if (vercelMapHasConvexLinkKeys(map)) {
      if (branch !== primary) {
        syncInfo(
          `Preview env pull: using git branch "${branch}" (Convex link keys not found on "${primary}" pull; your Preview vars may be branch-scoped in Vercel). Fix: set \`ENV_SYNC_VERCEL_PREVIEW_BRANCH=${branch}\`, or use default unscoped Preview (clear branch env / \`ENV_SYNC_VERCEL_PREVIEW_NO_BRANCH=1\`).`
        );
      }
      return map;
    }
  }

  if (lastMap) {
    syncWarn(
      `Preview env pull: no branch in [${branches.join(", ")}] returned \`NEXT_PUBLIC_CONVEX_URL\` / \`CONVEX_DEPLOY_KEY\` / related keys — merge may miss Convex linkage.`
    );
    return lastMap;
  }
  throw lastErr ?? new Error("vercel env pull preview failed for all branch candidates.");
}

/**
 * Pull Vercel env to a temp file and parse.
 * @param {TTarget} target
 */
export function fetchVercelEnvMap(target) {
  return fetchVercelEnvMapOptions(vercelEnvName(target));
}
