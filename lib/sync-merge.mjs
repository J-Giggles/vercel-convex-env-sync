/**
 * env:sync — three-way merge of local sync file ↔ hosted Convex ↔ hosted Vercel.
 *
 * Rules per key:
 *   - All sources empty/missing      → skip
 *   - One filled, others empty       → fill the empty sides with the filled value
 *   - Multiple filled, all equal     → no-op
 *   - Multiple filled, distinct      → conflict; print and skip (no auto-resolve)
 *
 * Empty values on local are ignored when the remote is also empty/missing
 * (so `KEY=` placeholders in .env.example don't propagate).
 *
 * The merged local map is written to `.env.sync.<env>` (preserving `.env.example`
 * layout when available); then `pushTarget` is invoked with `--from-sync` to
 * propagate the new values to Convex + Vercel using existing diff/push logic.
 */
import fs from "node:fs";
import path from "node:path";
import { isConvexEnabled } from "./config.mjs";
import {
  buildConvexCliEnvForPushLocalMap,
  inferConvexUseProdFromLocalMap,
} from "./exec.mjs";
import {
  formatEnvFromExampleTemplate,
  resolveExampleTemplatePath,
} from "./format-env-from-example.mjs";
import { resolveLocalEnvReadPathForPush } from "./local-env-paths.mjs";
import { parseDotenv, serializeDotenv } from "./parse-dotenv.mjs";
import { REPO_ROOT } from "./paths.mjs";
import { confirmOrCancel } from "./prompt.mjs";
import { pushTarget } from "./push.mjs";
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
  isVercelAutoInjectedKey,
} from "./split.mjs";
import {
  syncDim,
  syncInfo,
  syncSuccess,
  syncWarn,
} from "./cli-style.mjs";

/** @typedef {import("./remote.mjs").TTarget} TTarget */

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
};

/**
 * @param {string | undefined} v
 */
function isEmpty(v) {
  return v === undefined || v === "";
}

/**
 * @param {TTarget} target
 * @param {{ yes?: boolean; skipPush?: boolean }} [opts]
 */
export async function syncMergeTarget(target, opts = {}) {
  const skipConfirm = opts.yes === true;
  const skipPush = opts.skipPush === true;

  const localPath = resolveLocalEnvReadPathForPush(target, { fromSync: true });
  if (!localPath) {
    throw new Error(
      `[env:sync] No .env.sync.${target === "dev" ? "development" : target === "prod" ? "production" : "preview"} file found. Run \`pnpm run env:sync:pull -- ${target}\` first.`
    );
  }
  const raw = fs.readFileSync(localPath, "utf8");
  const localMap = parseDotenv(raw);

  const convexEnabled = isConvexEnabled();
  syncInfo(
    `Merge ${target} — reading ${path.relative(REPO_ROOT, localPath)}`
  );
  syncInfo(
    convexEnabled
      ? "Fetching Convex + Vercel env…"
      : "Fetching Vercel env… (Convex disabled)"
  );

  /** When Convex is disabled, treat its remote map as empty so the merge runs Vercel-only. */
  const remoteConvex = convexEnabled
    ? fetchConvexEnvMapOptions({
        useProd: inferConvexUseProdFromLocalMap(localMap, target),
        convexEnv: buildConvexCliEnvForPushLocalMap(localMap, true, target),
      })
    : new Map();
  const remoteVercelRaw = fetchVercelEnvMap(target);
  const remoteVercel = filterOutVercelAutoInjected(remoteVercelRaw);

  /** Eligible scopes per key (split rules decide what may go to Convex). */
  const localConvexEligible = convexEnabled
    ? filterForConvex(localMap)
    : new Map();
  const localVercelEligible = filterForVercel(localMap);

  const allKeys = new Set([
    ...localMap.keys(),
    ...remoteConvex.keys(),
    ...remoteVercel.keys(),
  ]);

  const updatedLocal = new Map(localMap);
  /** @type {Array<{ key: string; canonical: string; sources: string[]; localFill: boolean }>} */
  const fills = [];
  /** @type {Array<{ key: string; values: { source: string; value: string }[] }>} */
  const conflicts = [];

  for (const k of allKeys) {
    if (isVercelAutoInjectedKey(k)) continue;
    const lv = localMap.get(k);
    const cv = remoteConvex.get(k);
    const vv = remoteVercel.get(k);
    /** @type {{ source: string; value: string }[]} */
    const candidates = [];
    if (!isEmpty(lv)) candidates.push({ source: "local", value: lv });
    if (!isEmpty(cv)) candidates.push({ source: "convex", value: cv });
    if (!isEmpty(vv)) candidates.push({ source: "vercel", value: vv });
    if (candidates.length === 0) continue;

    const distinct = [...new Set(candidates.map((c) => c.value))];
    if (distinct.length > 1) {
      conflicts.push({ key: k, values: candidates });
      continue;
    }
    const canonical = distinct[0];
    const sources = candidates.map((c) => c.source);
    const localFill = isEmpty(lv);
    if (localFill) {
      updatedLocal.set(k, canonical);
      fills.push({ key: k, canonical, sources, localFill: true });
    } else {
      const remoteEmpty =
        (localConvexEligible.has(k) && isEmpty(cv)) ||
        (localVercelEligible.has(k) && isEmpty(vv));
      if (remoteEmpty) {
        fills.push({ key: k, canonical, sources, localFill: false });
      }
    }
  }

  if (fills.length === 0 && conflicts.length === 0) {
    syncSuccess(`Already in sync — ${target}`);
    return;
  }

  if (fills.length > 0) {
    console.log("");
    console.log(
      `${ANSI.bold}Fills${ANSI.reset} ${ANSI.dim}· ${fills.length} key(s) will be propagated${ANSI.reset}`
    );
    const keyWidth = Math.max(
      "Key".length,
      ...fills.map((f) => f.key.length)
    );
    const sourceWidth = Math.max(
      "From".length,
      ...fills.map((f) => f.sources.join(",").length)
    );
    console.log(
      `  ${ANSI.dim}${pad("Key", keyWidth)}  ${pad("From", sourceWidth)}  Value${ANSI.reset}`
    );
    for (const f of fills) {
      const flag = f.localFill ? `${ANSI.green}+local${ANSI.reset}` : "";
      console.log(
        `  ${pad(f.key, keyWidth)}  ${pad(f.sources.join(","), sourceWidth)}  ${trimValue(f.canonical)}  ${flag}`
      );
    }
  }

  if (conflicts.length > 0) {
    console.log("");
    console.log(
      `${ANSI.bold}${ANSI.red}Conflicts${ANSI.reset} ${ANSI.dim}· ${conflicts.length} key(s) have distinct non-empty values; not auto-resolved${ANSI.reset}`
    );
    for (const c of conflicts) {
      console.log(`  ${c.key}`);
      for (const v of c.values) {
        console.log(
          `    ${ANSI.dim}${pad(v.source, 6)}${ANSI.reset} = ${trimValue(v.value)}`
        );
      }
    }
  }

  console.log("");

  if (fills.length === 0) {
    syncWarn(
      `No fills — only conflicts remain. Resolve manually in ${path.relative(REPO_ROOT, localPath)} or in the dashboard.`
    );
    process.exitCode = 1;
    return;
  }

  if (!skipConfirm) {
    const ok = await confirmOrCancel(
      `Apply ${fills.length} fill(s) to local + ${
        skipPush ? "skip remote push" : "push to Convex + Vercel"
      }?`
    );
    if (!ok) {
      syncInfo("Cancelled.");
      return;
    }
  }

  const templatePath = resolveExampleTemplatePath(REPO_ROOT, target);
  const formatted = templatePath
    ? formatEnvFromExampleTemplate(
        fs.readFileSync(templatePath, "utf8"),
        updatedLocal
      )
    : serializeDotenv(updatedLocal);
  fs.writeFileSync(localPath, formatted, "utf8");
  syncInfo(
    `Wrote merged values to ${path.relative(REPO_ROOT, localPath)}.`
  );

  if (skipPush) {
    syncDim(
      "  --skip-push: skipping remote push. Run `pnpm run env:sync:push -- " +
        target +
        "` to apply."
    );
    syncSuccess(`Merge complete — ${target} (local only)`);
    return;
  }

  console.log("");
  syncInfo(
    `Pushing merged values to Convex + Vercel (${vercelEnvName(target)})…`
  );
  await pushTarget(target, { fromSync: true, yes: true });

  if (conflicts.length > 0) {
    console.log("");
    syncWarn(
      `Merge complete with ${conflicts.length} unresolved conflict(s); resolve manually.`
    );
    process.exitCode = 1;
    return;
  }
  syncSuccess(`Merge complete — ${target}`);
}

const VALUE_TRUNCATE = 32;

/**
 * @param {string} v
 */
function trimValue(v) {
  if (v.length <= VALUE_TRUNCATE) return v;
  const head = Math.floor((VALUE_TRUNCATE - 1) / 2);
  const tail = VALUE_TRUNCATE - 1 - head;
  return `${v.slice(0, head)}…${v.slice(-tail)}`;
}

/**
 * @param {string} cell
 * @param {number} width
 */
function pad(cell, width) {
  const visible = cell.replace(/\x1b\[[0-9;]*m/g, "").length;
  if (visible >= width) return cell;
  return cell + " ".repeat(width - visible);
}

/* Re-export so run.mjs can import the same fetcher for symmetry; not used here. */
export { fetchConvexEnvMap, fetchVercelEnvMap };
