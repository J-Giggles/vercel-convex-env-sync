/**
 * env:sync:pull — fetch Convex + Vercel env, merge, write merged file, update metadata.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { hashEnvMap } from "./hash.mjs";
import { patchTarget } from "./metadata.mjs";
import {
  formatEnvFromExampleTemplate,
  resolveExampleTemplatePath,
} from "./format-env-from-example.mjs";
import { parseDotenv, serializeDotenv } from "./parse-dotenv.mjs";
import { REPO_ROOT, SYNC_DIR, envSyncPath } from "./paths.mjs";
import { resolveLocalEnvWritePath } from "./local-env-paths.mjs";
import { fetchConvexEnvMap, fetchVercelEnvMap } from "./remote.mjs";
import { resolveConvexMapForVercelPull } from "./resolve-convex-map-for-vercel-pull.mjs";
import { filterMergedForLocalWorkspace } from "./split.mjs";
import { syncInfo, syncWarn } from "./cli-style.mjs";

/**
 * @typedef {{
 *   convexMap: Map<string, string>;
 *   vercelMap: Map<string, string>;
 *   storageKey: string;
 *   templateTarget: import("./remote.mjs").TTarget;
 *   snapshotOnly?: boolean;
 *   localWrite: { abs: string; rel: string; created: boolean } | null;
 *   label?: string;
 * }} TExecutePullOpts
 */

/**
 * Merge remote env maps, write snapshot + optional working file, update metadata.
 *
 * @param {TExecutePullOpts} opts
 */
export async function executePull(opts) {
  const snapshotOnly = Boolean(opts.snapshotOnly);
  const storageKey = opts.storageKey;
  const label = opts.label ?? storageKey;
  const templateTarget = opts.templateTarget;
  const localWrite = opts.localWrite;

  const convexMap = opts.convexMap;
  const vercelMap = opts.vercelMap;

  const convexHash = hashEnvMap(convexMap);
  const vercelHash = hashEnvMap(vercelMap);

  const merged = mergeWithWarnings(vercelMap, convexMap);
  const mergedBody = serializeDotenv(merged);
  const mergedPath = envSyncPath(`merge.${storageKey}`);

  const prevExists = fs.existsSync(mergedPath);
  const prevBody = prevExists ? fs.readFileSync(mergedPath, "utf8") : "";
  const prevMap = prevExists ? parseDotenv(prevBody) : new Map();

  fs.writeFileSync(mergedPath, mergedBody, "utf8");

  if (!snapshotOnly && localWrite) {
    const { abs: localAbs, rel: localRel, created } = localWrite;
    const forLocal = filterMergedForLocalWorkspace(merged);
    const templateAbs = resolveExampleTemplatePath(REPO_ROOT, templateTarget);
    /** @type {string} */
    let localBody;
    if (templateAbs) {
      try {
        const templateContent = fs.readFileSync(templateAbs, "utf8");
        localBody = formatEnvFromExampleTemplate(templateContent, forLocal);
        syncInfo(
          `Working file layout from template → ${path.relative(REPO_ROOT, templateAbs)}`
        );
      } catch (e) {
        syncWarn(
          `Could not read template (${templateAbs}); using sorted keys. ${e instanceof Error ? e.message : e}`
        );
        localBody = serializeDotenv(forLocal);
      }
    } else {
      localBody = serializeDotenv(forLocal);
    }
    if (fs.existsSync(localAbs)) {
      const backupDir = path.join(SYNC_DIR, "pull-backups");
      fs.mkdirSync(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = path.join(backupDir, `${storageKey}.${stamp}.env`);
      fs.copyFileSync(localAbs, backupPath);
      syncInfo(
        `Previous ${localRel} saved → ${path.relative(REPO_ROOT, backupPath)}`
      );
    }
    fs.writeFileSync(localAbs, localBody, "utf8");
    syncInfo(
      `Wrote working env → ${localRel}${created ? " (created)" : ""}`
    );
  }

  const contentHash = crypto
    .createHash("sha256")
    .update(mergedBody, "utf8")
    .digest("hex");
  const prevHash = prevExists
    ? crypto.createHash("sha256").update(prevBody, "utf8").digest("hex")
    : null;

  const now = new Date().toISOString();
  patchTarget(storageKey, {
    convexHash,
    vercelHash,
    lastPullAt: now,
  });

  syncInfo(
    `Wrote merged snapshot → ${path.relative(REPO_ROOT, mergedPath)}`
  );
  syncInfo(
    `Snapshot hashes — Convex: ${convexHash.slice(0, 12)}… Vercel: ${vercelHash.slice(0, 12)}…`
  );

  if (!prevExists) {
    syncInfo(
      `No previous merged file — first pull for this key (${label}).`
    );
  } else if (contentHash === prevHash) {
    syncInfo("Merged content unchanged vs previous pull.");
  } else {
    const changes = diffMaps(prevMap, merged);
    syncInfo(
      `Merged content changed (${changes.length} key difference(s)):`
    );
    for (const line of changes.slice(0, 40)) {
      console.log(`  ${line}`);
    }
    if (changes.length > 40) {
      console.log(`  … and ${changes.length - 40} more`);
    }
  }
}

/**
 * @param {import("./remote.mjs").TTarget} target
 * @param {{ snapshotOnly?: boolean }} [opts]
 */
export async function pullTarget(target, opts = {}) {
  const snapshotOnly = Boolean(opts.snapshotOnly);
  fs.mkdirSync(SYNC_DIR, { recursive: true });

  syncInfo(`Pulling Convex + Vercel for target "${target}"…`);

  const vercelMap = fetchVercelEnvMap(target);
  const convexDevMap = fetchConvexEnvMap("dev");
  const convexProdMap = fetchConvexEnvMap("prod");
  const convexMap = resolveConvexMapForVercelPull(
    vercelMap,
    target,
    convexDevMap,
    convexProdMap
  );

  const localWrite = snapshotOnly
    ? null
    : resolveLocalEnvWritePath(target);

  await executePull({
    convexMap,
    vercelMap,
    storageKey: target,
    templateTarget: target,
    snapshotOnly,
    localWrite,
    label: target,
  });
}

/**
 * Vercel map wins on duplicate keys (Next + build metadata).
 * @param {Map<string, string>} vercelMap
 * @param {Map<string, string>} convexMap
 */
export function mergeWithWarnings(vercelMap, convexMap) {
  const out = new Map(convexMap);
  for (const [k, v] of vercelMap) {
    if (out.has(k) && out.get(k) !== v) {
      syncWarn(
        `Warning: key "${k}" differs between Vercel and Convex; using Vercel value in merge.`
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
