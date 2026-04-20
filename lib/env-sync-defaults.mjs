/**
 * Tooling defaults for env:sync (not app runtime).
 *
 * @see ENV_SYNC_VERCEL_USE_SENSITIVE — override: `1`/`true` = use `--sensitive` on Vercel for matching keys; `0`/`false` = never.
 * @see VERCEL_SYNC_PREVIEW_UNSCOPED — Preview: unscoped vs git branch `VERCEL_SYNC_PREVIEW_DEFAULT_BRANCH`.
 */

/** Default: do not mark Vercel env vars as Sensitive (values remain readable on `vercel env pull`). */
export const VERCEL_SYNC_USE_SENSITIVE = false;

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
 * Whether `vercel env add` should receive `--sensitive` for keys matching {@link isSensitiveKeyPattern} in push.
 * `ENV_SYNC_VERCEL_USE_SENSITIVE` wins when set to `0`/`1`/`true`/`false`.
 *
 * @returns {boolean}
 */
export function shouldUseVercelSensitive() {
  const e = process.env.ENV_SYNC_VERCEL_USE_SENSITIVE?.trim().toLowerCase();
  if (e === "1" || e === "true" || e === "yes") return true;
  if (e === "0" || e === "false" || e === "no") return false;
  return VERCEL_SYNC_USE_SENSITIVE;
}

/**
 * @param {"default" | "on" | "off" | undefined} override — from interactive push CLI
 * @returns {boolean}
 */
export function resolveVercelSensitiveForPush(override) {
  if (override === "on") return true;
  if (override === "off") return false;
  return shouldUseVercelSensitive();
}
