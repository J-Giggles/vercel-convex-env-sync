/**
 * Pick which Convex env map to merge with a Vercel pull: prefer the deployment Vercel points at
 * (`NEXT_PUBLIC_CONVEX_URL`, `CONVEX_DEPLOY_KEY`, …) plus overlay env for the Convex CLI.
 */
import { extractConvexDeploymentSlug } from "./convex-vercel-link.mjs";
import {
  buildConvexCliEnvForPushLocalMap,
  inferConvexUseProdFromLocalMap,
} from "./exec.mjs";
import { fetchConvexEnvMapOptions } from "./remote.mjs";

/** @typedef {import("./remote.mjs").TTarget} TTarget */

/**
 * Prefer `convex env list` for the deployment referenced on Vercel (overlay deploy key from snapshot).
 *
 * @param {Map<string, string>} vercelMap
 * @param {TTarget} presetTarget
 * @param {Map<string, string>} convexDevMap — from local CLI default dev deployment
 * @param {Map<string, string>} convexProdMap — from `convex env list --prod`
 * @param {boolean} [convexSideFromUser] — When the user chose dev vs prod after an ambiguous / unmatched inference
 * @returns {Map<string, string>}
 */
export function resolveConvexMapForVercelPull(
  vercelMap,
  presetTarget,
  convexDevMap,
  convexProdMap,
  convexSideFromUser
) {
  const overlayEnv = buildConvexCliEnvForPushLocalMap(
    vercelMap,
    true,
    presetTarget
  );
  const defaultUseProd = inferConvexUseProdFromLocalMap(vercelMap, presetTarget);
  const useProdForSynthetic =
    convexSideFromUser !== undefined ? convexSideFromUser : defaultUseProd;

  /** @param {boolean} useProd */
  function tryList(useProd) {
    return fetchConvexEnvMapOptions({ useProd, convexEnv: overlayEnv });
  }

  try {
    return tryList(useProdForSynthetic);
  } catch (e) {
    console.warn(
      "[env:sync] Could not `convex env list` using deploy key / URL from the Vercel snapshot; trying alternate prod/dev and slug fallbacks.",
      e instanceof Error ? e.message : e
    );
  }

  try {
    return tryList(!useProdForSynthetic);
  } catch {
    /* continue */
  }

  const slug = extractConvexDeploymentSlug(vercelMap);
  if (slug) {
    const devSlug = extractConvexDeploymentSlug(convexDevMap);
    const prodSlug = extractConvexDeploymentSlug(convexProdMap);
    /** @type {Array<{ useProd: boolean; dep: string }>} */
    const attempts = [];

    if (devSlug && slug === devSlug && slug !== prodSlug) {
      attempts.push({ useProd: false, dep: `dev:${slug}` });
    } else if (prodSlug && slug === prodSlug && slug !== devSlug) {
      attempts.push({ useProd: true, dep: `prod:${slug}` });
    } else {
      attempts.push(
        {
          useProd: useProdForSynthetic,
          dep: useProdForSynthetic ? `prod:${slug}` : `dev:${slug}`,
        },
        {
          useProd: !useProdForSynthetic,
          dep: !useProdForSynthetic ? `prod:${slug}` : `dev:${slug}`,
        }
      );
    }

    const tried = new Set();
    for (const { useProd, dep } of attempts) {
      const key = `${useProd}\0${dep}`;
      if (tried.has(key)) continue;
      tried.add(key);
      const env = { ...overlayEnv, CONVEX_DEPLOYMENT: dep };
      try {
        return fetchConvexEnvMapOptions({ useProd, convexEnv: env });
      } catch {
        /* continue */
      }
    }
    console.warn(
      `[env:sync] Could not list Convex env for Vercel-derived slug "${slug}"; using local CLI ${useProdForSynthetic ? "production" : "development"} deployment map.`
    );
  }

  return useProdForSynthetic ? convexProdMap : convexDevMap;
}
