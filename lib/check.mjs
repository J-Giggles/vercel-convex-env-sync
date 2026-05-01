/**
 * env:sync:check — compare a local env file with hosted Convex + Vercel env.
 *
 * Reads the matching `.env.sync.<env>` snapshot by default (same source as `env:sync:push`),
 * applies the Convex/Vercel split rules, fetches both remotes, and prints a diff table per
 * platform. Exits 0 when both platforms match the local view, 1 otherwise. Quiet mode
 * (`-q` / `--quiet`) prints only `true` / `false`.
 *
 * No `convex env set` / `vercel env` writes are performed — read-only by design.
 */
import fs from "node:fs";
import path from "node:path";
import {
  buildConvexCliEnvForPushLocalMap,
  inferConvexUseProdFromLocalMap,
} from "./exec.mjs";
import { resolveLocalEnvReadPathForPush } from "./local-env-paths.mjs";
import { parseDotenv } from "./parse-dotenv.mjs";
import { REPO_ROOT } from "./paths.mjs";
import {
  fetchConvexEnvMap,
  fetchConvexEnvMapOptions,
  fetchVercelEnvMap,
  vercelEnvName,
} from "./remote.mjs";
import {
  filterForConvex,
  filterForVercel,
  filterOutVercelAutoInjected,
} from "./split.mjs";
import {
  syncDim,
  syncInfo,
  syncSuccess,
  syncWarn,
} from "./cli-style.mjs";

/** @typedef {import("./remote.mjs").TTarget} TTarget */

/**
 * @param {Map<string, string>} local
 * @param {Map<string, string>} remote
 * @returns {{ localOnly: string[]; remoteOnly: string[]; differs: string[] }}
 */
function diffMaps(local, remote) {
  const localOnly = [];
  const remoteOnly = [];
  const differs = [];
  for (const [k, v] of local) {
    if (!remote.has(k)) localOnly.push(k);
    else if (remote.get(k) !== v) differs.push(k);
  }
  for (const k of remote.keys()) {
    if (!local.has(k)) remoteOnly.push(k);
  }
  localOnly.sort();
  remoteOnly.sort();
  differs.sort();
  return { localOnly, remoteOnly, differs };
}

/**
 * @param {{ localOnly: string[]; remoteOnly: string[]; differs: string[] }} diff
 */
function diffEmpty(diff) {
  return (
    diff.localOnly.length === 0 &&
    diff.remoteOnly.length === 0 &&
    diff.differs.length === 0
  );
}

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

const VALUE_TRUNCATE = 32;

/**
 * Truncate a value for display (keeps both ends so version-like differences stay visible).
 *
 * @param {string | undefined} value
 */
function fmtValue(value) {
  if (value === undefined) return `${ANSI.dim}—${ANSI.reset}`;
  if (value === "") return `${ANSI.dim}""${ANSI.reset}`;
  if (value.length <= VALUE_TRUNCATE) return value;
  const head = Math.floor((VALUE_TRUNCATE - 1) / 2);
  const tail = VALUE_TRUNCATE - 1 - head;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Width of a string ignoring ANSI escapes (so column padding stays aligned). */
function visibleWidth(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

/**
 * @param {string} cell
 * @param {number} width
 */
function pad(cell, width) {
  const diff = width - visibleWidth(cell);
  if (diff <= 0) return cell;
  return cell + " ".repeat(diff);
}

const STATUS_LABELS = {
  differs: `${ANSI.yellow}differs${ANSI.reset}`,
  "local-only": `${ANSI.green}local-only${ANSI.reset}`,
  "remote-only": `${ANSI.red}remote-only${ANSI.reset}`,
};

const STATUS_RAW_WIDTH = "remote-only".length;

/**
 * @param {string} title
 * @param {Map<string, string>} local
 * @param {Map<string, string>} remote
 * @param {{ localOnly: string[]; remoteOnly: string[]; differs: string[] }} diff
 */
function printDiffTable(title, local, remote, diff) {
  const inSync = diffEmpty(diff);
  const header = `${ANSI.bold}${title}${ANSI.reset} ${ANSI.dim}· ${local.size} local · ${remote.size} remote${ANSI.reset}`;
  console.log("");
  console.log(header);
  if (inSync) {
    console.log(`  ${ANSI.green}✓ in sync${ANSI.reset}`);
    return;
  }
  console.log(
    `  ${ANSI.yellow}${diff.differs.length}${ANSI.reset} differs · ` +
      `${ANSI.green}${diff.localOnly.length}${ANSI.reset} local-only · ` +
      `${ANSI.red}${diff.remoteOnly.length}${ANSI.reset} remote-only`
  );

  /** @type {Array<{ status: keyof typeof STATUS_LABELS; key: string; localValue: string | undefined; remoteValue: string | undefined }>} */
  const rows = [];
  for (const k of diff.differs) {
    rows.push({
      status: "differs",
      key: k,
      localValue: local.get(k),
      remoteValue: remote.get(k),
    });
  }
  for (const k of diff.localOnly) {
    rows.push({
      status: "local-only",
      key: k,
      localValue: local.get(k),
      remoteValue: undefined,
    });
  }
  for (const k of diff.remoteOnly) {
    rows.push({
      status: "remote-only",
      key: k,
      localValue: undefined,
      remoteValue: remote.get(k),
    });
  }

  const keyWidth = Math.max(
    "Key".length,
    ...rows.map((r) => r.key.length)
  );
  const localWidth = Math.max(
    "Local".length,
    ...rows.map((r) => visibleWidth(fmtValue(r.localValue)))
  );
  const remoteWidth = Math.max(
    "Remote".length,
    ...rows.map((r) => visibleWidth(fmtValue(r.remoteValue)))
  );

  const headerRow =
    "  " +
    pad(`${ANSI.dim}Status${ANSI.reset}`, STATUS_RAW_WIDTH) +
    "  " +
    pad(`${ANSI.dim}Key${ANSI.reset}`, keyWidth) +
    "  " +
    pad(`${ANSI.dim}Local${ANSI.reset}`, localWidth) +
    "  " +
    pad(`${ANSI.dim}Remote${ANSI.reset}`, remoteWidth);
  console.log(headerRow);

  for (const r of rows) {
    const status = STATUS_LABELS[r.status];
    const line =
      "  " +
      pad(status, STATUS_RAW_WIDTH) +
      "  " +
      pad(r.key, keyWidth) +
      "  " +
      pad(fmtValue(r.localValue), localWidth) +
      "  " +
      pad(fmtValue(r.remoteValue), remoteWidth);
    console.log(line);
  }
}

/**
 * @param {TTarget} target
 * @param {{
 *   fromSync?: boolean;
 *   quiet?: boolean;
 *   convexOnly?: boolean;
 *   vercelOnly?: boolean;
 * }} [opts]
 */
export async function checkTarget(target, opts = {}) {
  const fromSync = opts.fromSync !== false;
  const quiet = opts.quiet === true;
  const convexOnly = opts.convexOnly === true;
  const vercelOnly = opts.vercelOnly === true;
  if (convexOnly && vercelOnly) {
    throw new Error(
      "[env:sync] check: --convex-only and --vercel-only are mutually exclusive."
    );
  }

  const localPath = resolveLocalEnvReadPathForPush(target, { fromSync });
  if (!localPath) {
    throw new Error(
      `[env:sync] check ${target}: no local env file found.${
        fromSync
          ? " Run `pnpm run env:sync:pull -- " + target + "` first."
          : ""
      }`
    );
  }
  const raw = fs.readFileSync(localPath, "utf8");
  const localMap = parseDotenv(raw);

  if (!quiet) {
    syncInfo(
      `Check ${target} — reading ${path.relative(REPO_ROOT, localPath)}`
    );
    if (fromSync) {
      const kind = inferConvexUseProdFromLocalMap(localMap, target)
        ? "production"
        : "development";
      syncDim(
        `  Convex compare uses ${kind} deployment (CONVEX_DEPLOY_KEY prefix and/or sync target).`
      );
    }
    syncInfo(
      vercelOnly
        ? "Fetching Vercel env…"
        : convexOnly
          ? "Fetching Convex env…"
          : "Fetching Convex + Vercel env…"
    );
  }

  const convexCliEnv = buildConvexCliEnvForPushLocalMap(
    localMap,
    fromSync,
    target
  );
  const remoteConvex = vercelOnly
    ? null
    : fromSync
      ? fetchConvexEnvMapOptions({
          useProd: inferConvexUseProdFromLocalMap(localMap, target),
          convexEnv: convexCliEnv,
        })
      : fetchConvexEnvMap(target, convexCliEnv);
  const remoteVercel = convexOnly ? null : fetchVercelEnvMap(target);

  const localConvex = filterForConvex(localMap);
  /** Both sides are filtered for Vercel-injected system keys so the diff stays actionable. */
  const localVercel = filterOutVercelAutoInjected(filterForVercel(localMap));
  const remoteVercelUserManaged = remoteVercel
    ? filterOutVercelAutoInjected(remoteVercel)
    : null;

  const convexDiff = remoteConvex
    ? diffMaps(localConvex, remoteConvex)
    : null;
  const vercelDiff = remoteVercelUserManaged
    ? diffMaps(localVercel, remoteVercelUserManaged)
    : null;

  const convexOk = convexDiff === null || diffEmpty(convexDiff);
  const vercelOk = vercelDiff === null || diffEmpty(vercelDiff);
  const inSync = convexOk && vercelOk;

  if (quiet) {
    console.log(inSync ? "true" : "false");
    process.exitCode = inSync ? 0 : 1;
    return;
  }

  if (convexDiff && remoteConvex) {
    printDiffTable(
      `Convex (${inferConvexUseProdFromLocalMap(localMap, target) ? "production" : "development"} deployment)`,
      localConvex,
      remoteConvex,
      convexDiff
    );
  }
  if (vercelDiff && remoteVercelUserManaged) {
    printDiffTable(
      `Vercel ${vercelEnvName(target)}`,
      localVercel,
      remoteVercelUserManaged,
      vercelDiff
    );
  }

  console.log("");
  if (inSync) {
    syncSuccess(`✓ In sync — ${target}`);
  } else {
    /** @type {string[]} */
    const reasons = [];
    if (convexDiff && !diffEmpty(convexDiff)) {
      reasons.push(
        `Convex (${convexDiff.differs.length} differ, ${convexDiff.localOnly.length} local-only, ${convexDiff.remoteOnly.length} remote-only)`
      );
    }
    if (vercelDiff && !diffEmpty(vercelDiff)) {
      reasons.push(
        `Vercel (${vercelDiff.differs.length} differ, ${vercelDiff.localOnly.length} local-only, ${vercelDiff.remoteOnly.length} remote-only)`
      );
    }
    syncWarn(`✗ Out of sync — ${reasons.join("; ")}`);
  }

  process.exitCode = inSync ? 0 : 1;
}
