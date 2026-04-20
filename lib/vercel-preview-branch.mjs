/**
 * Stable Git branch name for Vercel **Preview** scoped variables (`vercel env add … preview <branch>`).
 *
 * Preview env is treated as **staging** across projects: branch `staging` unless overridden.
 */

const DEFAULT_PREVIEW_GIT_BRANCH = "staging";

/**
 * Branch name passed to the Vercel CLI for Preview (`--git-branch`, 4th arg to `env add` / scoped `rm`).
 *
 * @returns {string} Always a non-empty branch name (default **`staging`**).
 */
export function getVercelPreviewGitBranch() {
  const fromEnv = process.env.ENV_SYNC_VERCEL_PREVIEW_BRANCH?.trim();
  if (fromEnv !== undefined && fromEnv !== "") {
    return fromEnv;
  }
  return DEFAULT_PREVIEW_GIT_BRANCH;
}
