/**
 * Decide which keys go to Convex vs Vercel when pushing from a merged local file.
 *
 * Aligns with `lib/env.ts` / `.env.example` “Core app + Convex”: server secrets and
 * URLs Convex actions need (`APP_URL`, `INTERNAL_MAIL_SYNC_SECRET`, WorkOS secrets, …)
 * go to Convex; browser/build keys (`NEXT_PUBLIC_*`), deployment selectors (`CONVEX_DEPLOYMENT`),
 * and CI-only keys (`CONVEX_DEPLOY_KEY`) do not.
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
 * @param {Map<string, string>} map
 * @returns {Map<string, string>}
 */
export function filterForConvex(map) {
  const out = new Map();
  for (const [k, v] of map) {
    if (NEVER_CONVEX_KEYS.has(k)) continue;
    if (NEVER_CONVEX_PREFIXES.some((re) => re.test(k))) continue;
    out.set(k, v);
  }
  return out;
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
