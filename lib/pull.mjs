/**
 * env:sync:pull — fetch Convex + Vercel env, merge, write merged file, update metadata.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { hashEnvMap } from "./hash.mjs";
import { patchTarget } from "./metadata.mjs";
import { parseDotenv, serializeDotenv } from "./parse-dotenv.mjs";
import { SYNC_DIR } from "./paths.mjs";
import { fetchConvexEnvMap, fetchVercelEnvMap } from "./remote.mjs";

/**
 * @param {import("./remote.mjs").TTarget} target
 */
export async function pullTarget(target) {
  fs.mkdirSync(SYNC_DIR, { recursive: true });

  console.log(`[env:sync] Pulling Convex + Vercel for target "${target}"…`);

  const convexMap = fetchConvexEnvMap(target);
  const vercelMap = fetchVercelEnvMap(target);

  const convexHash = hashEnvMap(convexMap);
  const vercelHash = hashEnvMap(vercelMap);

  const merged = mergeWithWarnings(vercelMap, convexMap);
  const mergedBody = serializeDotenv(merged);
  const mergedPath = path.join(SYNC_DIR, `merged.${target}.env`);

  const prevExists = fs.existsSync(mergedPath);
  const prevBody = prevExists ? fs.readFileSync(mergedPath, "utf8") : "";
  const prevMap = prevExists ? parseDotenv(prevBody) : new Map();

  fs.writeFileSync(mergedPath, mergedBody, "utf8");

  const contentHash = crypto
    .createHash("sha256")
    .update(mergedBody, "utf8")
    .digest("hex");
  const prevHash = prevExists
    ? crypto.createHash("sha256").update(prevBody, "utf8").digest("hex")
    : null;

  const now = new Date().toISOString();
  patchTarget(target, {
    convexHash,
    vercelHash,
    lastPullAt: now,
  });

  console.log(`[env:sync] Wrote merged env → ${path.relative(process.cwd(), mergedPath)}`);
  console.log(`[env:sync] Snapshot hashes — Convex: ${convexHash.slice(0, 12)}… Vercel: ${vercelHash.slice(0, 12)}…`);

  if (!prevExists) {
    console.log("[env:sync] No previous merged file — first pull for this target.");
  } else if (contentHash === prevHash) {
    console.log("[env:sync] Merged content unchanged vs previous pull.");
  } else {
    const changes = diffMaps(prevMap, merged);
    console.log(`[env:sync] Merged content changed (${changes.length} key difference(s)):`);
    for (const line of changes.slice(0, 40)) {
      console.log(`  ${line}`);
    }
    if (changes.length > 40) {
      console.log(`  … and ${changes.length - 40} more`);
    }
  }

}

/**
 * Vercel map wins on duplicate keys (Next + build metadata).
 * @param {Map<string, string>} vercelMap
 * @param {Map<string, string>} convexMap
 */
function mergeWithWarnings(vercelMap, convexMap) {
  const out = new Map(convexMap);
  for (const [k, v] of vercelMap) {
    if (out.has(k) && out.get(k) !== v) {
      console.warn(
        `[env:sync] Warning: key "${k}" differs between Vercel and Convex; using Vercel value in merge.`
      );
    }
    out.set(k, v);
  }
  return out;
}

/**
 * @param {Map<string, string>} before
 * @param {Map<string, string>} after
 */
function diffMaps(before, after) {
  /** @type {string[]} */
  const lines = [];
  const keys = new Set([...before.keys(), ...after.keys()]);
  for (const k of [...keys].sort()) {
    const b = before.get(k);
    const a = after.get(k);
    if (b === undefined && a !== undefined) {
      lines.push(`+ ${k} (added)`);
    } else if (b !== undefined && a === undefined) {
      lines.push(`- ${k} (removed)`);
    } else if (b !== a) {
      lines.push(`~ ${k} (modified)`);
    }
  }
  return lines;
}
