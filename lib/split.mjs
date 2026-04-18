/**
 * Decide which keys go to Convex vs Vercel when pushing from a merged local file.
 */

/** Keys / patterns never pushed to Convex runtime. */
const NEVER_CONVEX_PREFIXES = [/^NEXT_PUBLIC_/u, /^VERCEL_/u];

const NEVER_CONVEX_KEYS = new Set([
  "CI",
  "NODE_ENV",
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
