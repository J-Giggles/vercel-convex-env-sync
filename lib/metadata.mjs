/**
 * Persisted snapshot hashes for drift warnings (per target environment).
 */
import fs from "node:fs";
import path from "node:path";
import { SYNC_DIR } from "./paths.mjs";

const FILE = path.join(SYNC_DIR, "metadata.json");

/**
 * @typedef {{
 *   convexHash: string;
 *   vercelHash: string;
 *   lastPullAt: string;
 *   lastPushedLocalHash?: string;
 *   lastPushAt?: string;
 * }} TTargetMeta
 */

/**
 * @returns {Record<string, TTargetMeta>}
 */
export function readMetadata() {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * @param {Record<string, TTargetMeta>} data
 */
export function writeMetadata(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/**
 * @param {string} target
 * @param {Partial<TTargetMeta>} patch
 */
export function patchTarget(target, patch) {
  const all = readMetadata();
  all[target] = { ...all[target], ...patch };
  writeMetadata(all);
}
