/**
 * Tooling defaults for env:sync (not app runtime).
 *
 * **Project policy (hard rule):** every Vercel environment variable in this project is stored
 * with `type: "plain"` — values are readable directly in the Vercel dashboard UI and via
 * `vercel env pull`. The `--sensitive` flag, the API `"sensitive"` type, and the default
 * `"encrypted"` type are never used, even if a key name matches classic secret patterns
 * (TOKEN, SECRET, KEY, …). Pushes therefore go through the Vercel REST API (the CLI cannot
 * create plain variables); see `push.mjs` → `pushVercelMap`.
 *
 * @see VERCEL_SYNC_PREVIEW_UNSCOPED — Preview: unscoped vs git branch `VERCEL_SYNC_PREVIEW_DEFAULT_BRANCH`.
 */

/**
 * Default git branch for Vercel Preview when branch-scoped and **`ENV_SYNC_VERCEL_PREVIEW_BRANCH`** is unset.
 */
export const VERCEL_SYNC_PREVIEW_DEFAULT_BRANCH = "staging";

/**
 * When **false** (default): Preview uses **`vercel env … preview <branch>`** with
 * **`VERCEL_SYNC_PREVIEW_DEFAULT_BRANCH`** unless **`ENV_SYNC_VERCEL_PREVIEW_BRANCH`** is set.
 * When **true**: unscoped Preview (all preview deployments). Override per-run with
 * **`ENV_SYNC_VERCEL_PREVIEW_NO_BRANCH=1`** / **`0`**.
 */
export const VERCEL_SYNC_PREVIEW_UNSCOPED = false;

/**
 * Project policy: never mark Vercel env vars as Sensitive. Kept as a function for backwards
 * compatibility with existing call-sites (interactive push CLI, `push.mjs`, API type resolver).
 *
 * @returns {false}
 */
export function shouldUseVercelSensitive() {
  return false;
}

/**
 * Backwards-compatible shim — always returns `false`. The interactive push CLI may still ask
 * "default / on / off"; the answer is ignored by this function (sensitive is disabled project-wide).
 *
 * @param {"default" | "on" | "off" | undefined} _override
 * @returns {false}
 */
export function resolveVercelSensitiveForPush(_override) {
  return false;
}
