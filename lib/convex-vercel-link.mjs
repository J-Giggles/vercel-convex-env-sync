/**
 * Infer which Convex deployment (`convex env list` vs `--prod`) matches a Vercel env pull
 * by comparing deployment slugs (URL host or CONVEX_DEPLOYMENT).
 */

/** Keys that indicate a Vercel env is wired to Convex. */
export const CONVEX_LINK_ENV_KEYS = [
  "NEXT_PUBLIC_CONVEX_URL",
  "CONVEX_URL",
  "NEXT_PUBLIC_CONVEX_SITE_URL",
  "CONVEX_DEPLOYMENT",
];

/**
 * @param {Map<string, string>} map
 * @returns {boolean}
 */
export function vercelMapHasConvexLinkKeys(map) {
  for (const k of CONVEX_LINK_ENV_KEYS) {
    const v = map.get(k);
    if (typeof v === "string" && v.trim()) return true;
  }
  return false;
}

/**
 * Hostname first label for `*.convex.cloud` / `*.convex.site` URLs.
 *
 * @param {string | undefined} urlStr
 * @returns {string | null}
 */
function slugFromConvexHttpUrl(urlStr) {
  if (!urlStr || typeof urlStr !== "string") return null;
  try {
    const u = new URL(urlStr.trim());
    const host = u.hostname;
    if (!host) return null;
    const first = host.split(".")[0];
    return first || null;
  } catch {
    return null;
  }
}

/**
 * @param {string | undefined} raw
 * @returns {string | null}
 */
function slugFromConvexDeploymentVar(raw) {
  if (!raw || typeof raw !== "string") return null;
  const rawStr = raw.trim();
  if (!rawStr) return null;
  const pipe = rawStr.includes("|") ? rawStr.split("|")[0].trim() : rawStr;
  const colon = pipe.lastIndexOf(":");
  if (colon >= 0) return pipe.slice(colon + 1).trim() || null;
  return pipe || null;
}

/**
 * Best-effort deployment slug for comparing Vercel vs Convex env maps.
 *
 * @param {Map<string, string>} map
 * @returns {string | null}
 */
export function extractConvexDeploymentSlug(map) {
  const dep = map.get("CONVEX_DEPLOYMENT");
  const fromDep = slugFromConvexDeploymentVar(dep);
  if (fromDep) return fromDep;

  const cloud = slugFromConvexHttpUrl(map.get("NEXT_PUBLIC_CONVEX_URL") ?? map.get("CONVEX_URL"));
  if (cloud) return cloud;

  return slugFromConvexHttpUrl(map.get("NEXT_PUBLIC_CONVEX_SITE_URL"));
}

/**
 * Stable fingerprint of Convex-related vars on a Vercel pull (order-independent).
 *
 * @param {Map<string, string>} map
 * @returns {string}
 */
export function convexLinkFingerprint(map) {
  /** @type {string[]} */
  const parts = [];
  for (const k of CONVEX_LINK_ENV_KEYS) {
    const v = map.get(k);
    parts.push(`${k}=${typeof v === "string" ? v.trim() : ""}`);
  }
  return parts.join("\n");
}

/**
 * If every row resolves to the same non-null deployment slug, return it.
 *
 * @param {Array<{ vercelMap: Map<string, string> }>} rows
 * @returns {string | null}
 */
export function getUniformVercelConvexSlug(rows) {
  if (rows.length === 0) return null;
  const slugs = rows.map((r) => extractConvexDeploymentSlug(r.vercelMap));
  const first = slugs[0];
  if (first === null) return null;
  for (let i = 1; i < slugs.length; i++) {
    if (slugs[i] !== first) return null;
  }
  return first;
}

/**
 * Same Convex linkage values on every Vercel target (manual copy-paste across environments).
 *
 * @param {Array<{ vercelMap: Map<string, string> }>} rows
 * @returns {boolean}
 */
export function allVercelTargetsShareConvexFingerprint(rows) {
  if (rows.length < 2) return false;
  const fp0 = convexLinkFingerprint(rows[0].vercelMap);
  if (!vercelMapHasConvexLinkKeys(rows[0].vercelMap)) return false;
  return rows.every((r) => convexLinkFingerprint(r.vercelMap) === fp0);
}

/**
 * @typedef {{
 *   status: "linked-dev" | "linked-prod" | "ambiguous" | "no-slug" | "no-convex-on-vercel" | "unmatched-slug" | "uniform-assumed-prod";
 *   useProd: boolean | null;
 *   vercelSlug: string | null;
 *   devSlug: string | null;
 *   prodSlug: string | null;
 * }} TConvexLinkInference
 */

/**
 * Compare Vercel pulled env to Convex dev and prod maps.
 *
 * @param {Map<string, string>} vercelMap
 * @param {Map<string, string>} convexDevMap
 * @param {Map<string, string>} convexProdMap
 * @returns {TConvexLinkInference}
 */
export function inferConvexLink(
  vercelMap,
  convexDevMap,
  convexProdMap
) {
  if (!vercelMapHasConvexLinkKeys(vercelMap)) {
    return {
      status: "no-convex-on-vercel",
      useProd: null,
      vercelSlug: null,
      devSlug: null,
      prodSlug: null,
    };
  }

  const v = extractConvexDeploymentSlug(vercelMap);
  const d = extractConvexDeploymentSlug(convexDevMap);
  const p = extractConvexDeploymentSlug(convexProdMap);

  if (!v) {
    return {
      status: "no-slug",
      useProd: null,
      vercelSlug: null,
      devSlug: d,
      prodSlug: p,
    };
  }

  const matchD = d !== null && v === d;
  const matchP = p !== null && v === p;

  if (matchD && !matchP) {
    return {
      status: "linked-dev",
      useProd: false,
      vercelSlug: v,
      devSlug: d,
      prodSlug: p,
    };
  }
  if (matchP && !matchD) {
    return {
      status: "linked-prod",
      useProd: true,
      vercelSlug: v,
      devSlug: d,
      prodSlug: p,
    };
  }
  if (matchD && matchP) {
    return {
      status: "ambiguous",
      useProd: null,
      vercelSlug: v,
      devSlug: d,
      prodSlug: p,
    };
  }

  return {
    status: "unmatched-slug",
    useProd: null,
    vercelSlug: v,
    devSlug: d,
    prodSlug: p,
  };
}

/**
 * When every Vercel environment uses the same Convex deployment (manual vars on all targets)
 * but `convex env list` / `--prod` slugs don't match (e.g. local CLI linked to another project),
 * assume **production** for the merge — common when only hosted prod Convex is wired on Vercel.
 *
 * Only applied when {@link ctx.multipleVercelTargets} is true (same slug on one env is not enough).
 *
 * @param {TConvexLinkInference} inference
 * @param {{ uniformSlug: string | null; sharedFingerprint: boolean; multipleVercelTargets: boolean }} ctx
 * @returns {TConvexLinkInference}
 */
export function refineInferenceWhenUniformVercelConvex(inference, ctx) {
  const { uniformSlug, sharedFingerprint, multipleVercelTargets } = ctx;
  if (!multipleVercelTargets) return inference;

  if (
    inference.status === "unmatched-slug" &&
    uniformSlug !== null &&
    inference.vercelSlug === uniformSlug
  ) {
    return {
      ...inference,
      status: "uniform-assumed-prod",
      useProd: true,
    };
  }

  if (inference.status === "no-slug" && sharedFingerprint) {
    return {
      ...inference,
      status: "uniform-assumed-prod",
      useProd: true,
      vercelSlug: inference.vercelSlug ?? uniformSlug,
    };
  }

  return inference;
}
