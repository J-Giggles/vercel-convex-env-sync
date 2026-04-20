/**
 * Vercel **Preview** can be **unscoped** (all Preview deployments) or **git-branch-scoped**
 * (`vercel env add … preview <branch>`).
 *
 * **Default (repo):** branch-scoped to **`staging`** (`lib/env-sync-defaults.mjs`). Set
 * **`ENV_SYNC_VERCEL_PREVIEW_BRANCH`** to override. **`ENV_SYNC_VERCEL_PREVIEW_NO_BRANCH=1`** for unscoped
 * Preview.
 */
import { execSync } from "node:child_process";
import {
  VERCEL_SYNC_PREVIEW_DEFAULT_BRANCH,
  VERCEL_SYNC_PREVIEW_UNSCOPED,
} from "./env-sync-defaults.mjs";
import { REPO_ROOT } from "./paths.mjs";

/**
 * When true, Preview uses Vercel’s Preview target **without** a git branch (applies to all Preview
 * deployments). **Default** comes from **`VERCEL_SYNC_PREVIEW_UNSCOPED`** in `env-sync-defaults.mjs`
 * (typically **false** = use **`staging`**). **`ENV_SYNC_VERCEL_PREVIEW_NO_BRANCH=1`** forces unscoped;
 * **`=0`** forces branch mode when the branch env is empty.
 *
 * @returns {boolean}
 */
export function isVercelPreviewNoGitBranch() {
  const toggle = process.env.ENV_SYNC_VERCEL_PREVIEW_NO_BRANCH?.trim().toLowerCase();
  if (toggle === "1" || toggle === "true" || toggle === "yes") return true;
  if (toggle === "0" || toggle === "false" || toggle === "no") return false;

  const branch = process.env.ENV_SYNC_VERCEL_PREVIEW_BRANCH?.trim();
  if (branch !== undefined && branch !== "") return false;

  return VERCEL_SYNC_PREVIEW_UNSCOPED;
}

/**
 * Branch name passed to the Vercel CLI for Preview (`--git-branch`, 4th arg to `env add` / scoped `rm`).
 *
 * @returns {string} Empty string when {@link isVercelPreviewNoGitBranch} is true (no branch). Otherwise a
 *   non-empty name (`ENV_SYNC_VERCEL_PREVIEW_BRANCH`, or **`VERCEL_SYNC_PREVIEW_DEFAULT_BRANCH`** when branch mode is on and the env is unset).
 */
export function getVercelPreviewGitBranch() {
  if (isVercelPreviewNoGitBranch()) {
    return "";
  }
  const fromEnv = process.env.ENV_SYNC_VERCEL_PREVIEW_BRANCH?.trim();
  if (fromEnv !== undefined && fromEnv !== "") {
    return fromEnv;
  }
  return VERCEL_SYNC_PREVIEW_DEFAULT_BRANCH;
}

/**
 * Ordered branch names for `vercel env pull --environment preview --git-branch …`.
 * Tries **`staging`** first, then the current git branch (e.g. legacy Preview-scoped vars), deduped.
 *
 * @returns {readonly string[]}
 */
export function getVercelPreviewPullBranchCandidates() {
  /** @type {string[]} */
  const out = [];
  const primary = getVercelPreviewGitBranch();
  if (isVercelPreviewNoGitBranch()) {
    return out;
  }
  if (primary) out.push(primary);
  try {
    const head = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
      cwd: REPO_ROOT,
    }).trim();
    if (head && !out.includes(head)) out.push(head);
  } catch {
    /* not a git checkout */
  }
  return out;
}
