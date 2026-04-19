/**
 * Which root-level `.env*` files correspond to each sync target (same rules as push source).
 */
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, envSyncPath } from "./paths.mjs";

/**
 * @param {import("./remote.mjs").TTarget} target
 * @returns {string[]} Relative paths, in priority order.
 */
export function localEnvCandidates(target) {
  if (target === "dev") {
    return [".env.local", ".env.development.local"];
  }
  if (target === "preview") {
    return [".env.preview", ".env.local"];
  }
  return [".env.production.local", ".env.local"];
}

/**
 * First existing env file for this target (what `env:sync:push` reads).
 * @param {import("./remote.mjs").TTarget} target
 * @returns {string | null} Absolute path
 */
export function resolveLocalEnvReadPath(target) {
  for (const rel of localEnvCandidates(target)) {
    const p = path.join(REPO_ROOT, rel);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Pull snapshot files written by `env:sync:pull --all` (merged + formatted). */
const SYNC_SNAPSHOT_REL = {
  dev: ".env.sync.development",
  preview: ".env.sync.preview",
  prod: ".env.sync.production",
};

/**
 * Absolute path to `.env.sync.<environment>` for this target, or `null` if missing.
 *
 * @param {import("./remote.mjs").TTarget} target
 * @returns {string | null}
 */
export function resolveSyncSnapshotReadPath(target) {
  const rel = SYNC_SNAPSHOT_REL[target];
  if (!rel) return null;
  const p = path.join(REPO_ROOT, rel);
  return fs.existsSync(p) ? p : null;
}

/**
 * Resolve which file `env:sync:push` reads: working env vs pull snapshot.
 *
 * @param {import("./remote.mjs").TTarget} target
 * @param {{ fromSync?: boolean }} [opts]
 * @returns {string | null}
 */
export function resolveLocalEnvReadPathForPush(target, opts = {}) {
  if (opts.fromSync) {
    const p = resolveSyncSnapshotReadPath(target);
    if (p) return p;
    const rel = SYNC_SNAPSHOT_REL[target];
    throw new Error(
      `[env:sync] --from-sync: file not found: ${rel}. Run \`pnpm run env:sync:pull -- ${target}\` or \`pnpm run env:sync:pull -- --all\` first.`
    );
  }
  return resolveLocalEnvReadPath(target);
}

/**
 * Map interactive Convex + Vercel choices to the same local file rules as preset targets.
 * Returns `null` for uncommon pairings (write under `.env/sync/` only — see `resolveOddPairPullPath`).
 *
 * @param {boolean} convexUseProd
 * @param {"development" | "preview" | "production"} vercelEnv
 * @returns {"dev" | "preview" | "prod" | null}
 */
export function inferTargetFromPair(convexUseProd, vercelEnv) {
  if (!convexUseProd && vercelEnv === "development") return "dev";
  if (!convexUseProd && vercelEnv === "preview") return "preview";
  if (convexUseProd && vercelEnv === "production") return "prod";
  return null;
}

/**
 * Uncommon Convex/Vercel pairings write **`.env.sync.<storageKey>`** so root `.env*.local`
 * files are not overwritten unexpectedly.
 *
 * @param {string} storageKey — filesystem-safe slug (e.g. `vx-development-cprod`)
 * @returns {{ abs: string, rel: string, created: boolean }}
 */
export function resolveOddPairPullPath(storageKey) {
  const abs = envSyncPath(storageKey);
  const rel = path.relative(REPO_ROOT, abs);
  return { abs, rel, created: !fs.existsSync(abs) };
}

/**
 * Where `env:sync:pull` writes the merged remote state.
 *
 * **prod** and **preview** never fall back to `.env.local` — that would mix hosted
 * prod/preview config into a dev file. Those targets update-or-create only their
 * dedicated file (`.env.production.local` / `.env.preview`).
 *
 * **dev** uses the first existing of `.env.local` / `.env.development.local`, or creates `.env.local`.
 *
 * @param {import("./remote.mjs").TTarget} target
 * @returns {{ abs: string, rel: string, created: boolean }}
 */
export function resolveLocalEnvWritePath(target) {
  if (target === "prod") {
    const rel = ".env.production.local";
    const abs = path.join(REPO_ROOT, rel);
    return {
      abs,
      rel,
      created: !fs.existsSync(abs),
    };
  }
  if (target === "preview") {
    const rel = ".env.preview";
    const abs = path.join(REPO_ROOT, rel);
    return {
      abs,
      rel,
      created: !fs.existsSync(abs),
    };
  }

  const rels = localEnvCandidates(target);
  for (const rel of rels) {
    const abs = path.join(REPO_ROOT, rel);
    if (fs.existsSync(abs)) {
      return { abs, rel, created: false };
    }
  }
  const rel = rels[0];
  return { abs: path.join(REPO_ROOT, rel), rel, created: true };
}
