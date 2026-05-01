/**
 * Decide which keys go to Convex vs Vercel when pushing from a merged local file.
 *
 * Aligns with `lib/env.ts` / `.env.example` “Core app + Convex”: server secrets and
 * URLs Convex actions need (`APP_URL`, `INTERNAL_MAIL_SYNC_SECRET`, WorkOS secrets, …)
 * go to Convex; browser/build keys (`NEXT_PUBLIC_*`), deployment selectors (`CONVEX_DEPLOY_KEY`,
 * legacy `CONVEX_DEPLOYMENT`), and other CI-only keys do not.
 */

/** Keys / patterns never pushed to Convex runtime. */
const NEVER_CONVEX_PREFIXES = [/^NEXT_PUBLIC_/u, /^VERCEL_/u];

const NEVER_CONVEX_KEYS = new Set([
  "CI",
  "NODE_ENV",
  /** Client/CLI routing — `convex env set` already targets a deployment. */
  "CONVEX_DEPLOYMENT",
  "CONVEX_DEPLOY_KEY",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_GIT_COMMIT_SHA",
]);

/**
 * URL keys whose value Convex cloud actions fetch. A localhost value here would
 * cause `ECONNREFUSED` inside Convex (Convex cloud cannot reach your laptop).
 * We keep them eligible for Convex in principle, but drop them at push time
 * when the value is localhost-ish (see {@link isLocalhostUrlValue}).
 *
 * `NEXT_PUBLIC_APP_URL` is also listed even though `NEXT_PUBLIC_*` is already
 * excluded by {@link NEVER_CONVEX_PREFIXES} — the set exists so callers can
 * warn symmetrically for both keys when drift is reported.
 */
const CONVEX_CALLABLE_URL_KEYS = new Set(["APP_URL", "NEXT_PUBLIC_APP_URL"]);

/** `localhost`, `127.0.0.1`, or `::1` (any scheme / port / path). */
const LOCALHOST_URL_PATTERN =
  /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[?::1\]?)(?::\d+)?(?:\/|$)/iu;

/**
 * Whether a URL value points at the developer's machine (Convex cloud cannot reach it).
 *
 * @param {string | undefined} value
 * @returns {boolean}
 */
export function isLocalhostUrlValue(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return LOCALHOST_URL_PATTERN.test(trimmed);
}

/**
 * Split a push map into the Convex payload + the list of keys we intentionally
 * dropped so the caller can surface a warning (e.g. `APP_URL=http://localhost:3000`
 * being filtered out before `convex env set`).
 *
 * @param {Map<string, string>} map
 * @returns {{ out: Map<string, string>, droppedLocalhost: string[] }}
 */
export function filterForConvexWithWarnings(map) {
  const out = new Map();
  const droppedLocalhost = [];
  for (const [k, v] of map) {
    if (NEVER_CONVEX_KEYS.has(k)) continue;
    if (NEVER_CONVEX_PREFIXES.some((re) => re.test(k))) continue;
    if (CONVEX_CALLABLE_URL_KEYS.has(k) && isLocalhostUrlValue(v)) {
      droppedLocalhost.push(k);
      continue;
    }
    out.set(k, v);
  }
  return { out, droppedLocalhost };
}

/**
 * @param {Map<string, string>} map
 * @returns {Map<string, string>}
 */
export function filterForConvex(map) {
  return filterForConvexWithWarnings(map).out;
}

/**
 * Vercel hosts the Next.js app; include all keys needed at build/runtime.
 * Omit Convex-only noise if any is introduced later.
 * @param {Map<string, string>} map
 * @returns {Map<string, string>}
 */
export function filterForVercel(map) {
  const out = new Map();
  for (const [k, v] of map) {
    if (k === "CONVEX_DEPLOYMENT") continue;
    out.set(k, v);
  }
  return out;
}

/** Vercel CLI injects short-lived tokens into `vercel env pull` — not useful in app `.env*` files. */
const LOCAL_PULL_OMIT_KEYS = new Set(["VERCEL_OIDC_TOKEN"]);

/**
 * Keys that Vercel injects automatically at build/runtime — never user-managed.
 * Excluded from `env:sync:check` diffs so the table only shows actionable drift.
 */
const VERCEL_AUTO_INJECTED_KEYS = new Set([
  "CI",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_OIDC_TOKEN",
  "VERCEL_TARGET_ENV",
  "VERCEL_URL",
]);

const VERCEL_AUTO_INJECTED_PREFIXES = [/^VERCEL_GIT_/u];

/**
 * Whether a key is auto-injected by Vercel and should be skipped in diff views.
 *
 * @param {string} key
 */
export function isVercelAutoInjectedKey(key) {
  if (VERCEL_AUTO_INJECTED_KEYS.has(key)) return true;
  return VERCEL_AUTO_INJECTED_PREFIXES.some((re) => re.test(key));
}

/**
 * Strip Vercel-injected build/runtime keys from a Vercel env map.
 *
 * @param {Map<string, string>} map
 * @returns {Map<string, string>}
 */
export function filterOutVercelAutoInjected(map) {
  const out = new Map();
  for (const [k, v] of map) {
    if (isVercelAutoInjectedKey(k)) continue;
    out.set(k, v);
  }
  return out;
}

/**
 * Strip ephemeral keys before writing merged pull output to `.env.local` / `.env.production.local`.
 * @param {Map<string, string>} map
 * @returns {Map<string, string>}
 */
export function filterMergedForLocalWorkspace(map) {
  const out = new Map(map);
  for (const k of LOCAL_PULL_OMIT_KEYS) {
    out.delete(k);
  }
  const cd = out.get("CONVEX_DEPLOYMENT");
  if (typeof cd === "string" && cd.includes("|")) {
    out.set("CONVEX_DEPLOYMENT", cd.split("|")[0].trim());
  }
  return out;
}
