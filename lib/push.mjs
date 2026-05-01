/**
 * env:sync:push — push local env file to Convex + Vercel with drift warnings.
 *
 * When Convex is disabled (`ENV_SYNC_DISABLE_CONVEX=1`) all Convex CLI calls and Convex
 * drift checks are skipped — push operates on Vercel only. Passing `convex` /
 * `--convex-only` while Convex is disabled is rejected up front.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { isConvexEnabled } from "./config.mjs";
import {
  buildConvexCliEnvForPushLocalMap,
  inferConvexUseProdFromLocalMap,
  pnpmExec,
} from "./exec.mjs";
import { hashEnvMap } from "./hash.mjs";
import { patchTarget, readMetadata } from "./metadata.mjs";
import { parseDotenv, serializeDotenv } from "./parse-dotenv.mjs";
import {
  resolveLocalEnvReadPathForPush,
} from "./local-env-paths.mjs";
import { REPO_ROOT, SYNC_DIR, cachePath } from "./paths.mjs";
import { confirmOrCancel } from "./prompt.mjs";
import {
  convexEnvSetSuffixArgs,
  fetchConvexEnvMap,
  fetchConvexEnvMapOptions,
  fetchVercelEnvMap,
  vercelEnvName,
} from "./remote.mjs";
import { filterForConvexWithWarnings, filterForVercel } from "./split.mjs";
import {
  getVercelPreviewGitBranch,
  isVercelPreviewNoGitBranch,
} from "./vercel-preview-branch.mjs";
import { extractConvexDeploymentSlug } from "./convex-vercel-link.mjs";
import {
  deleteProjectEnvRow,
  listProjectEnvRows,
  upsertVercelEnv,
} from "./vercel-env-api.mjs";
import { syncDim, syncInfo, syncWarn } from "./cli-style.mjs";

/** @typedef {import("./remote.mjs").TTarget} TTarget */

/**
 * @param {TTarget} target
 * @param {{ yes?: boolean; fromSync?: boolean; vercelSensitive?: "default" | "on" | "off"; convexOnly?: boolean; force?: boolean }} [opts]
 *   — `yes`: skip confirmations; `fromSync`: read `.env.sync.<env>` and match Convex CLI to `CONVEX_DEPLOY_KEY` / URLs in that file;
 *   `vercelSensitive`: whether to pass `--sensitive` for matching keys (`default` → env / project constant);
 *   `convexOnly`: run `convex env set` only — skip Vercel CLI (faster; metadata `vercelHash` is left unchanged);
 *   `force`: disable per-key diff filtering and push every key (legacy behavior).
 */
export async function pushTarget(target, opts = {}) {
  const skipConfirm = opts.yes === true;
  const fromSync = opts.fromSync === true;
  const vercelSensitive = opts.vercelSensitive ?? "default";
  const convexOnly = opts.convexOnly === true;
  const force = opts.force === true;
  const convexEnabled = isConvexEnabled();
  const metaKey = opts.metadataNamespace
    ? `${target}@${opts.metadataNamespace}`
    : target;
  if (convexOnly && !convexEnabled) {
    throw new Error(
      "[env:sync] --convex-only / `convex` requested, but Convex is disabled (ENV_SYNC_DISABLE_CONVEX=1). Remove the flag or unset the env var."
    );
  }
  const localPath = resolveLocalEnvReadPathForPush(target, { fromSync });
  if (!localPath) {
    throw new Error(
      `[env:sync] No local env file found for "${target}". Create one (see docs/env/ENVIRONMENTS.md).`
    );
  }

  const raw = fs.readFileSync(localPath, "utf8");
  const localMap = parseDotenv(raw);
  if (fromSync && convexEnabled) {
    const hasConvexRouting =
      Boolean(localMap.get("CONVEX_DEPLOY_KEY")?.trim()) ||
      Boolean(extractConvexDeploymentSlug(localMap));
    if (!hasConvexRouting) {
      throw new Error(
        "[env:sync] --from-sync requires CONVEX_DEPLOY_KEY and/or NEXT_PUBLIC_CONVEX_URL (or CONVEX_URL) in the sync file so the Convex CLI can target the correct deployment."
      );
    }
  }
  const localSourceHash = crypto
    .createHash("sha256")
    .update(raw, "utf8")
    .digest("hex");

  syncInfo(`Source file: ${path.relative(REPO_ROOT, localPath)}`);
  if (!convexEnabled) {
    syncInfo("Convex disabled (ENV_SYNC_DISABLE_CONVEX=1) — pushing Vercel only.");
  }
  if (fromSync && convexEnabled) {
    const kind = inferConvexUseProdFromLocalMap(localMap, target)
      ? "production"
      : "development";
    syncInfo(
      `--from-sync: Convex drift/compare uses ${kind} deployment (CONVEX_DEPLOY_KEY prefix and/or sync target).`
    );
  }

  fs.mkdirSync(SYNC_DIR, { recursive: true });

  if (convexOnly) {
    syncInfo(
      "Convex-only push: skipping Vercel (no `vercel env` calls; stored `vercelHash` is not updated)."
    );
  }

  syncInfo(
    !convexEnabled
      ? "Fetching current remote Vercel (for drift check)…"
      : convexOnly
        ? "Fetching current remote Convex (for drift check)…"
        : "Fetching current remote Convex + Vercel (for drift check)…"
  );
  /**
   * Must match `pnpm exec convex` subprocess so list/set target the same deployment
   * (CLI prefers `CONVEX_DEPLOY_KEY`). Skipped entirely when Convex is disabled.
   */
  const convexCliEnv = convexEnabled
    ? buildConvexCliEnvForPushLocalMap(localMap, fromSync, target)
    : null;
  if (convexEnabled && localMap.get("CONVEX_DEPLOY_KEY")?.trim()) {
    syncInfo(
      "Convex CLI: using CONVEX_DEPLOY_KEY from this push file (CLI follows the deploy key over `--prod` alone; align the key with this snapshot)."
    );
  }
  const remoteConvex = !convexEnabled
    ? new Map()
    : fromSync
      ? fetchConvexEnvMapOptions({
          useProd: inferConvexUseProdFromLocalMap(localMap, target),
          convexEnv: convexCliEnv ?? undefined,
        })
      : fetchConvexEnvMap(target, convexCliEnv ?? undefined);
  const remoteVercel = convexOnly ? null : fetchVercelEnvMap(target);

  const remoteConvexHash = hashEnvMap(remoteConvex);
  const remoteVercelHash = remoteVercel ? hashEnvMap(remoteVercel) : "";

  const meta = readMetadata();
  const prev = meta[metaKey];
  const driftConvex =
    convexEnabled && prev?.convexHash && prev.convexHash !== remoteConvexHash;
  const driftVercel =
    !convexOnly &&
    Boolean(prev?.vercelHash && remoteVercelHash !== prev.vercelHash);

  if (driftConvex || driftVercel) {
    syncWarn(
      "⚠ Remote environment(s) changed since the last recorded pull (or never pulled)."
    );
    if (driftConvex) {
      syncWarn(
        "  • Convex: hosted env no longer matches last stored snapshot hash."
      );
    }
    if (driftVercel) {
      syncWarn(
        "  • Vercel: hosted env no longer matches last stored snapshot hash."
      );
    }
    syncWarn(
      "  Run `pnpm run env:sync:pull -- " +
        target +
        "` first to merge remote state, or continue to overwrite remote with your local file."
    );
    if (!skipConfirm) {
      const ok = await confirmOrCancel("Continue with push?");
      if (!ok) {
        syncInfo("Push cancelled.");
        process.exitCode = 1;
        return;
      }
    } else {
      syncWarn("--yes: continuing despite drift.");
    }
  }

  if (
    prev?.lastPushedLocalHash &&
    prev.lastPushedLocalHash !== localSourceHash
  ) {
    syncWarn(
      "⚠ Your local env file bytes changed since the last successful push."
    );
    if (!skipConfirm) {
      const ok2 = await confirmOrCancel("Continue anyway?");
      if (!ok2) {
        syncInfo("Push cancelled.");
        process.exitCode = 1;
        return;
      }
    } else {
      syncWarn("--yes: continuing despite local file change.");
    }
  }

  if (convexEnabled && target === "preview" && !fromSync) {
    syncWarn(
      "Note: Convex CLI targets dev or prod deployments only. This push applies Convex env to the **dev** deployment; ephemeral PR preview backends also use dashboard defaults."
    );
  }

  const vercelFiltered = filterForVercel(localMap);

  if (convexEnabled) {
    const { out: convexFiltered, droppedLocalhost: convexDroppedLocalhost } =
      filterForConvexWithWarnings(localMap);

    if (convexDroppedLocalhost.length > 0) {
      for (const key of convexDroppedLocalhost) {
        syncWarn(
          `Skipping ${key}=${JSON.stringify(localMap.get(key))} for Convex push — Convex cloud cannot reach localhost. ` +
            `Set ${key} on this Convex deployment manually (dashboard → Settings → Environment Variables) to a public URL ` +
            `(Vercel preview/production or a tunnel). This key is left untouched on Convex.`
        );
      }
    }

    logConvexPushPlan(target, localMap, fromSync, convexFiltered);

    /**
     * Per-key diff: only keys that are **new** or have a **different value** on Convex go in the push payload.
     * Equal keys are skipped entirely — `convex env set --from-file` only writes the keys in the file, so
     * untouched remote keys stay intact. Pass `--force` flag (at script level) to disable this optimization.
     */
    const convexToPush = force
      ? convexFiltered
      : diffMapAgainstRemote(convexFiltered, remoteConvex);
    const convexSkipped = convexFiltered.size - convexToPush.size;
    if (!force && convexSkipped > 0) {
      syncInfo(
        `Convex diff: ${convexToPush.size} key(s) to push, ${convexSkipped} unchanged → skipped.`
      );
    }
    if (convexToPush.size > 0) {
      const convexFile = cachePath(`push.convex.${target}.env`);
      fs.writeFileSync(convexFile, serializeDotenv(convexToPush), "utf8");

      const cArgs = [
        "env",
        "set",
        "--from-file",
        convexFile,
        "--force",
        ...convexEnvSetSuffixArgs(target, localMap, fromSync),
      ];
      syncInfo(
        `Running convex env set --from-file (${target} sync target, ${convexToPush.size} key(s))…`
      );
      const cRes = pnpmExec("convex", cArgs, { env: convexCliEnv ?? undefined });
      try {
        fs.unlinkSync(convexFile);
      } catch {
        /* ignore */
      }
      if (!cRes.ok) {
        console.error(cRes.stderr || cRes.stdout);
        throw new Error("convex env set --from-file failed");
      }
      if (cRes.stdout.trim()) console.log(cRes.stdout.trim());
    } else {
      syncInfo(
        "Convex: no changes vs remote — skipping `convex env set` entirely."
      );
    }
  }

  if (!convexOnly) {
    const vEnv = vercelEnvName(target);
    const vercelToPush = force
      ? vercelFiltered
      : diffMapAgainstRemote(vercelFiltered, remoteVercel ?? new Map());
    const vercelSkipped = vercelFiltered.size - vercelToPush.size;
    syncInfo(
      force
        ? `Pushing to Vercel (${vEnv}) — ${vercelFiltered.size} key(s) (--force)…`
        : `Pushing to Vercel (${vEnv}) — ${vercelToPush.size} changed/new, ${vercelSkipped} unchanged skipped.`
    );
    const appUrl = vercelToPush.get("APP_URL");
    const nextPublicApp = vercelToPush.get("NEXT_PUBLIC_APP_URL");
    if (appUrl !== undefined || nextPublicApp !== undefined) {
      syncInfo(
        `From this push file → Vercel \`${vEnv}\`: APP_URL=${JSON.stringify(appUrl ?? "(unchanged)")} · NEXT_PUBLIC_APP_URL=${JSON.stringify(nextPublicApp ?? "(unchanged)")}`
      );
    }
    if (vercelToPush.size > 0) {
      await pushVercelMap(vercelToPush, vEnv, { vercelSensitive });
    } else {
      syncInfo(
        `Vercel (${vEnv}): no changes vs remote — skipping all \`vercel env\` calls.`
      );
    }
  }

  const now = new Date().toISOString();
  syncInfo(
    !convexEnabled
      ? "Re-fetching Vercel hash after push…"
      : convexOnly
        ? "Re-fetching Convex hash after push…"
        : "Re-fetching remote hashes after push…"
  );
  const afterConvex = convexEnabled
    ? hashEnvMap(
        fromSync
          ? fetchConvexEnvMapOptions({
              useProd: inferConvexUseProdFromLocalMap(localMap, target),
              convexEnv: convexCliEnv ?? undefined,
            })
          : fetchConvexEnvMap(target, convexCliEnv ?? undefined)
      )
    : "";
  if (convexOnly) {
    patchTarget(metaKey, {
      convexHash: afterConvex,
      lastPushedLocalHash: localSourceHash,
      lastPushAt: now,
    });
  } else {
    const afterVercel = hashEnvMap(fetchVercelEnvMap(target));
    /** Convex disabled: leave `convexHash` unset so future drift checks don't compare against a stale value. */
    patchTarget(metaKey, {
      ...(convexEnabled ? { convexHash: afterConvex } : {}),
      vercelHash: afterVercel,
      lastPushedLocalHash: localSourceHash,
      lastPushAt: now,
    });
  }

  syncInfo("Push finished.");
}

/**
 * Return a subset of `local` containing only keys where the value differs from `remote`
 * (or the key is missing remotely). Used for per-key diff pushes so equal values are skipped.
 *
 * @param {Map<string, string>} local
 * @param {Map<string, string>} remote
 * @returns {Map<string, string>}
 */
function diffMapAgainstRemote(local, remote) {
  const out = new Map();
  for (const [k, v] of local) {
    const current = remote.get(k);
    if (current === undefined || current !== v) out.set(k, v);
  }
  return out;
}

/**
 * Whether `convex env set` will use `--prod` (same rules as {@link convexEnvSetSuffixArgs}).
 *
 * @param {import("./remote.mjs").TTarget} target
 * @param {Map<string, string>} localMap
 * @param {boolean} fromSync
 * @returns {boolean}
 */
function convexPushUsesProd(target, localMap, fromSync) {
  if (fromSync) {
    return inferConvexUseProdFromLocalMap(localMap, target);
  }
  return target === "prod";
}

/**
 * Log Convex deployment identity and safe fingerprint vars before `convex env set`.
 *
 * @param {import("./remote.mjs").TTarget} target
 * @param {Map<string, string>} localMap
 * @param {boolean} fromSync
 * @param {Map<string, string>} convexFiltered
 */
function logConvexPushPlan(target, localMap, fromSync, convexFiltered) {
  const usesProd = convexPushUsesProd(target, localMap, fromSync);
  const slug = extractConvexDeploymentSlug(localMap);
  const kind = usesProd ? "production" : "development";
  syncInfo(
    `Convex push target: ${kind} deployment${slug ? ` — slug \`${slug}\`` : ""}`
  );
  syncDim(
    `  CLI: convex env set --from-file … --force${usesProd ? " --prod" : ""}`
  );
  const dk = localMap.get("CONVEX_DEPLOY_KEY");
  if (typeof dk === "string" && dk.trim()) {
    const raw = dk.trim();
    const line = raw.length > 96 ? `${raw.slice(0, 93)}…` : raw;
    syncDim(`  CONVEX_DEPLOY_KEY in file: ${line}`);
  }
  const ncu = localMap.get("NEXT_PUBLIC_CONVEX_URL") ?? localMap.get("CONVEX_URL");
  if (typeof ncu === "string" && ncu.trim()) {
    syncDim(
      `  Convex HTTP URL in file (Next.js only; not stored in Convex env): ${ncu.trim()}`
    );
  }
  const app = convexFiltered.get("APP_URL");
  if (app !== undefined) {
    syncDim(`  APP_URL in this push (→ Convex): ${JSON.stringify(app)}`);
  }
  if (localMap.has("NODE_ENV") && !convexFiltered.has("NODE_ENV")) {
    syncDim(
      `  NODE_ENV in file: ${JSON.stringify(localMap.get("NODE_ENV"))} — not sent to Convex (split rules).`
    );
  }
  syncDim(
    `  ${convexFiltered.size} key(s) in Convex env payload after split rules.`
  );
}

/**
 * @param {readonly string[][]} items — [key, value][]
 * @param {number} limit
 * @param {(entry: string[]) => Promise<void>} fn
 */
async function mapWithConcurrency(items, limit, fn) {
  if (items.length === 0) return;
  const cap = Math.min(Math.max(1, limit), items.length);
  let index = 0;
  /** @type {Error | undefined} */
  let failure;
  async function worker() {
    for (;;) {
      if (failure) return;
      const cur = index++;
      if (cur >= items.length) return;
      try {
        await fn(items[cur]);
      } catch (err) {
        failure = err instanceof Error ? err : new Error(String(err));
        return;
      }
    }
  }
  await Promise.all(Array.from({ length: cap }, () => worker()));
  if (failure) throw failure;
}

/**
 * Push a map of env vars to Vercel for a single target using the REST API with `type: "plain"`.
 *
 * **Why API, not CLI:** the Vercel CLI has no flag to create/update `plain` variables — it
 * always stores them as `encrypted` (masked in the dashboard). Project policy is "everything
 * is plain so values are readable in the Vercel UI", so every push must go through the API.
 *
 * Uses `POST /v10/projects/{id}/env?upsert=true` to create or replace. Before upserting we
 * list current rows and delete any existing row for a key-to-push whose type is NOT already
 * `plain` (or whose scope spans this target + others). That guarantees the final row is a
 * clean single-target `plain` row regardless of Vercel's in-place upsert semantics around
 * type changes and shared-target rows.
 *
 * @param {Map<string, string>} map
 * @param {"development" | "preview" | "production"} envName
 * @param {{ vercelSensitive?: "default" | "on" | "off" }} [_opts]
 */
async function pushVercelMap(map, envName, _opts = {}) {
  const previewBranch =
    envName === "preview" ? getVercelPreviewGitBranch() : "";
  if (envName === "preview") {
    if (isVercelPreviewNoGitBranch()) {
      syncInfo(
        "Vercel Preview: applying to all preview branches (no git branch scoping)."
      );
    } else if (previewBranch) {
      syncInfo(`Vercel Preview variables scoped to git branch: ${previewBranch}`);
    }
  }
  const entries = [...map].filter(([, value]) => value !== "");
  if (entries.length === 0) return;

  const rawConc = process.env.ENV_SYNC_VERCEL_CONCURRENCY?.trim();
  const parsed =
    rawConc === undefined || rawConc === ""
      ? 8
      : Number.parseInt(rawConc, 10);
  const concurrency =
    Number.isFinite(parsed) && parsed >= 1 ? Math.min(16, parsed) : 1;
  if (concurrency > 1) {
    syncInfo(
      `Vercel API concurrency ${concurrency} (set ENV_SYNC_VERCEL_CONCURRENCY=1 to serialize)`
    );
  }

  const keySet = new Set(entries.map(([k]) => k));
  const listRes = await listProjectEnvRows();
  if (!listRes.ok) {
    const hint =
      listRes.status === 0
        ? " — set VERCEL_TOKEN or run `vercel login` so the API can authenticate."
        : "";
    throw new Error(
      `Vercel API list failed (${listRes.status})${hint}: ${listRes.body.slice(0, 500)}`
    );
  }

  /**
   * Rows to delete before upsert:
   * - any row for a key we're about to push that's NOT already single-target plain matching our scope
   * - any row spanning this target + another target (we need clean single-target rows)
   *
   * @type {Array<{ id: string; key: string; reason: string }>}
   */
  const deletions = [];
  for (const row of listRes.envs) {
    if (!keySet.has(row.key)) continue;
    const coversOurTarget = row.target.includes(envName);
    if (!coversOurTarget) continue;
    if (envName === "preview" && previewBranch) {
      if (row.gitBranch && row.gitBranch !== previewBranch) continue;
    }
    const isSingleTarget = row.target.length === 1 && row.target[0] === envName;
    const isPlain = row.type === "plain";
    const branchMismatch =
      envName === "preview" && previewBranch && row.gitBranch !== previewBranch;
    if (!isSingleTarget || !isPlain || branchMismatch) {
      deletions.push({
        id: row.id,
        key: row.key,
        reason: !isPlain
          ? `type=${row.type}`
          : !isSingleTarget
            ? `multi-target [${row.target.join(",")}]`
            : "branch mismatch",
      });
    }
  }

  if (deletions.length > 0) {
    syncInfo(
      `Vercel API: pruning ${deletions.length} non-plain/multi-target row(s) before upsert…`
    );
    /** @type {Array<{ key: string; id: string; status: number; body: string }>} */
    const delFailures = [];
    await mapWithConcurrency(
      deletions.map((d) => [d.id, d.key]),
      concurrency,
      async ([id, key]) => {
        const res = await deleteProjectEnvRow(id);
        if (!res.ok && res.status !== 404) {
          delFailures.push({ key, id, status: res.status, body: res.body });
        }
      }
    );
    if (delFailures.length > 0) {
      syncWarn(
        `Vercel API: ${delFailures.length} delete(s) failed — upsert may still overwrite, continuing.`
      );
      for (const f of delFailures.slice(0, 5)) {
        syncWarn(`  • ${f.key} (${f.status}): ${f.body.slice(0, 160)}`);
      }
    }
  }

  /** @type {Array<{ key: string; status: number; body: string }>} */
  const failures = [];

  await mapWithConcurrency(entries, concurrency, async ([key, value]) => {
    const res = await upsertVercelEnv({
      key,
      value,
      type: "plain",
      target: envName,
      gitBranch:
        envName === "preview" && previewBranch ? previewBranch : undefined,
    });
    if (!res.ok) {
      failures.push({ key, status: res.status, body: res.body });
    }
  });

  if (failures.length > 0) {
    const first = failures[0];
    const preview = failures
      .slice(0, 5)
      .map((f) => `  • ${f.key} (${f.status}): ${f.body.slice(0, 200)}`)
      .join("\n");
    const hint =
      first.status === 0
        ? " — set VERCEL_TOKEN or run `vercel login` so the API can authenticate."
        : "";
    throw new Error(
      `Vercel API upsert failed for ${failures.length} key(s)${hint}\n${preview}`
    );
  }
}

/**
 * Kept for backwards compatibility — project policy is "nothing is Sensitive", so this always
 * returns `false`. Call-sites should prefer treating every key as non-sensitive.
 *
 * @param {string} _key
 * @returns {false}
 */
export function isSensitiveKey(_key) {
  return false;
}
