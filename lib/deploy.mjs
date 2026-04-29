/**
 * deploy — sync hosted env, deploy Convex, then deploy Vercel.
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import readline from "node:readline/promises";
import { pushTarget } from "./push.mjs";
import { parseDotenv } from "./parse-dotenv.mjs";
import { resolveLocalEnvReadPathForPush } from "./local-env-paths.mjs";
import { buildConvexCliEnvForPushLocalMap } from "./exec.mjs";
import { REPO_ROOT } from "./paths.mjs";
import { syncInfo, syncWarn } from "./cli-style.mjs";

const VALID_TARGETS = new Set(["staging", "preview", "production", "prod"]);

/**
 * @typedef {{
 *   label: "staging" | "production";
 *   syncTarget: "preview" | "prod";
 *   branch: "staging" | "production";
 *   production: boolean;
 * }} TDeployTarget
 */

/**
 * @typedef {{
 *   target: TDeployTarget;
 *   yes: boolean;
 *   gitPush: boolean;
 *   fromSync: boolean;
 *   skipGates: boolean;
 *   skipLint: boolean;
 *   skipTypecheck: boolean;
 *   skipBuild: boolean;
 *   skipEnvSync: boolean;
 *   skipConvexDeploy: boolean;
 *   skipVercelDeploy: boolean;
 * }} TDeployArgs
 */

/**
 * Convert CLI aliases into the repo's two hosted deployment lanes.
 *
 * @param {string} rawTarget
 * @returns {TDeployTarget}
 */
export function normalizeDeployTarget(rawTarget) {
  if (rawTarget === "staging" || rawTarget === "preview") {
    return {
      label: "staging",
      syncTarget: "preview",
      branch: "staging",
      production: false,
    };
  }
  if (rawTarget === "production" || rawTarget === "prod") {
    return {
      label: "production",
      syncTarget: "prod",
      branch: "production",
      production: true,
    };
  }
  throw new Error(
    `deploy target must be staging|production (aliases: preview|prod). Got: ${rawTarget || "<missing>"}`
  );
}

/**
 * Arguments for `vercel ...` direct deployment.
 *
 * @param {TDeployTarget} target
 * @returns {string[]}
 */
export function buildVercelDeployArgs(target) {
  return target.production ? ["deploy", "--prod"] : ["deploy"];
}

/**
 * Arguments for the Git-integration deployment path.
 *
 * @param {TDeployTarget} target
 * @returns {string[]}
 */
export function buildGitPushArgs(target) {
  if (target.production) {
    return ["push", "origin", target.branch];
  }
  return ["push", "origin", `HEAD:${target.branch}`, "--force-with-lease"];
}

/**
 * Parse deploy command flags. Deploys default to reading `.env.sync.*` snapshots
 * so production/staging cannot accidentally inherit local development secrets.
 *
 * @param {readonly string[]} argv
 * @returns {TDeployArgs}
 */
export function parseDeployArgs(argv) {
  const positional = [];
  /** @type {Omit<TDeployArgs, "target">} */
  const opts = {
    yes: false,
    gitPush: false,
    fromSync: true,
    skipGates: false,
    skipLint: false,
    skipTypecheck: false,
    skipBuild: false,
    skipEnvSync: false,
    skipConvexDeploy: false,
    skipVercelDeploy: false,
  };

  for (const arg of argv.filter((item) => item !== "--")) {
    if (!arg.startsWith("-")) {
      positional.push(arg);
      continue;
    }
    if (arg === "--yes" || arg === "-y") opts.yes = true;
    else if (arg === "--git-push") opts.gitPush = true;
    else if (arg === "--from-working") opts.fromSync = false;
    else if (arg === "--from-sync") opts.fromSync = true;
    else if (arg === "--skip-gates") opts.skipGates = true;
    else if (arg === "--skip-lint") opts.skipLint = true;
    else if (arg === "--skip-typecheck") opts.skipTypecheck = true;
    else if (arg === "--skip-build") opts.skipBuild = true;
    else if (arg === "--skip-env-sync") opts.skipEnvSync = true;
    else if (arg === "--skip-convex-deploy") opts.skipConvexDeploy = true;
    else if (arg === "--skip-vercel-deploy") opts.skipVercelDeploy = true;
    else throw new Error(`Unknown deploy argument: ${arg}`);
  }

  const [rawTarget, extra] = positional;
  if (!rawTarget || !VALID_TARGETS.has(rawTarget) || extra) {
    throw new Error("Usage: deploy <staging|production> [--git-push] [--yes]");
  }

  return {
    target: normalizeDeployTarget(rawTarget),
    ...opts,
  };
}

/**
 * Run a command and stream output to the terminal.
 *
 * @param {string} command
 * @param {readonly string[]} args
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 */
function runInherited(command, args, opts = {}) {
  syncInfo(`$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, [...args], {
    cwd: REPO_ROOT,
    env: opts.env ?? process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

/**
 * Run Vercel CLI, falling back to `pnpm dlx vercel` when the binary is missing.
 *
 * @param {readonly string[]} args
 */
function runVercelInherited(args) {
  try {
    runInherited("vercel", args);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/ENOENT|not found/i.test(message)) throw err;
    syncWarn("Vercel CLI not found on PATH; falling back to `pnpm dlx vercel`.");
    runInherited("pnpm", ["dlx", "vercel", ...args]);
  }
}

/**
 * Return the current Git branch.
 *
 * @returns {string}
 */
function currentBranch() {
  const result = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git rev-parse failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

/**
 * Fail when tracked changes are dirty. Untracked files are allowed because this
 * repo often has generated local artifacts during feature work.
 */
function assertTrackedTreeClean() {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git status failed: ${result.stderr || result.stdout}`);
  }
  const dirtyTracked = result.stdout
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("?? "));
  if (dirtyTracked.length > 0) {
    throw new Error(
      `Working tree has uncommitted tracked changes:\n  ${dirtyTracked.join(
        "\n  "
      )}\nCommit or stash tracked changes before deploying.`
    );
  }
}

/**
 * Ensure a branch exists remotely and the local branch is not behind it.
 *
 * @param {string} branch
 */
function assertBranchReady(branch) {
  const current = currentBranch();
  if (current !== branch) {
    throw new Error(
      `Deploying this target requires branch \`${branch}\` (currently \`${current}\`).`
    );
  }

  const fetchResult = spawnSync("git", ["fetch", "origin", branch], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (fetchResult.status !== 0) {
    throw new Error(
      `git fetch origin ${branch} failed:\n${fetchResult.stderr || fetchResult.stdout}`
    );
  }

  const behindResult = spawnSync(
    "git",
    ["rev-list", "--count", `${branch}..origin/${branch}`],
    { cwd: REPO_ROOT, encoding: "utf8" }
  );
  if (behindResult.status !== 0) {
    throw new Error(
      `git rev-list failed: ${behindResult.stderr || behindResult.stdout}`
    );
  }
  const behind = Number.parseInt(behindResult.stdout.trim(), 10);
  if (Number.isFinite(behind) && behind > 0) {
    throw new Error(
      `Local \`${branch}\` is ${behind} commit(s) behind \`origin/${branch}\`. Run \`git pull --ff-only origin ${branch}\` first.`
    );
  }
}

/**
 * Prompt before production deploys unless `--yes` is supplied.
 *
 * @param {boolean} assumeYes
 * @returns {Promise<void>}
 */
async function confirmProduction(assumeYes) {
  if (assumeYes) {
    syncWarn("--yes supplied; skipping production confirmation.");
    return;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      "[deploy] Type `DEPLOY PRODUCTION` to deploy production: "
    );
    if (answer.trim() !== "DEPLOY PRODUCTION") {
      throw new Error("Production deploy cancelled.");
    }
  } finally {
    rl.close();
  }
}

/**
 * Build the Convex CLI environment from the same file used for env sync.
 *
 * @param {TDeployArgs} args
 * @returns {NodeJS.ProcessEnv}
 */
function convexDeployEnv(args) {
  const localPath = resolveLocalEnvReadPathForPush(args.target.syncTarget, {
    fromSync: args.fromSync,
  });
  if (!localPath) {
    throw new Error(
      `[deploy] No env file found for ${args.target.label}. Run env sync pull first.`
    );
  }
  const localMap = parseDotenv(fs.readFileSync(localPath, "utf8"));
  return buildConvexCliEnvForPushLocalMap(
    localMap,
    args.fromSync,
    args.target.syncTarget
  );
}

/**
 * Deploy the selected staging/production lane.
 *
 * @param {TDeployArgs} args
 */
export async function deployTarget(args) {
  syncInfo(
    `Deploy target: ${args.target.label} (env sync: ${args.target.syncTarget}, branch: ${args.target.branch})`
  );

  assertTrackedTreeClean();
  if (args.target.production || args.gitPush) {
    assertBranchReady(args.target.branch);
  }

  if (args.target.production) {
    await confirmProduction(args.yes);
  }

  if (!args.skipGates && !args.skipLint) runInherited("pnpm", ["lint"]);
  if (!args.skipGates && !args.skipTypecheck) runInherited("pnpm", ["typecheck"]);
  if (!args.skipGates && !args.skipBuild) runInherited("pnpm", ["build"]);

  if (!args.skipEnvSync) {
    await pushTarget(args.target.syncTarget, {
      yes: args.yes,
      fromSync: args.fromSync,
    });
  }

  const convexEnv = convexDeployEnv(args);
  if (!args.skipConvexDeploy) {
    runInherited("pnpm", ["exec", "convex", "deploy"], { env: convexEnv });
  }

  if (!args.skipVercelDeploy) {
    if (args.gitPush) {
      runInherited("git", buildGitPushArgs(args.target));
    } else {
      runVercelInherited(buildVercelDeployArgs(args.target));
    }
  }

  syncInfo(`Deploy command finished for ${args.target.label}.`);
}
