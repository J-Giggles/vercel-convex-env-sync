/**
 * Resolved paths for env sync artifacts (under `.env/sync/`, gitignored).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** `scripts/vercel-convex-env-sync/lib` → repo root */
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
export const SYNC_DIR = path.join(REPO_ROOT, ".env", "sync");

export function cachePath(name) {
  return path.join(SYNC_DIR, name);
}
