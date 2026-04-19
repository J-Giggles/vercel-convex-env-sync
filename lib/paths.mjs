/**
 * Path helpers for env sync.
 *
 * - **Root** `.env.sync.<suffix>` (`envSyncPath`) — intentional snapshots (merge dumps, odd pull paths).
 * - **`.env/sync/`** (`cachePath`) — ephemeral Vercel pull caches + Convex `env set` temp files (not meant for editing).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** `scripts/vercel-convex-env-sync/lib` → repo root */
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
export const SYNC_DIR = path.join(REPO_ROOT, ".env", "sync");

/**
 * Root-level env sync outputs: `.env.sync.<suffix>` (e.g. `.env.sync.development`, `.env.sync.merge.dev`).
 *
 * @param {string} suffix — no path separators
 */
export function envSyncPath(suffix) {
  if (!suffix || /[/\\]/.test(suffix)) {
    throw new Error(`envSyncPath: invalid suffix "${suffix}"`);
  }
  return path.join(REPO_ROOT, `.env.sync.${suffix}`);
}

/**
 * Files under **`.env/sync/`** only — caches and short-lived Convex push payloads.
 * @param {string} name — filename only (no path separators)
 */
export function cachePath(name) {
  if (!name || /[/\\]/.test(name)) {
    throw new Error(`cachePath: invalid name "${name}"`);
  }
  return path.join(SYNC_DIR, name);
}
