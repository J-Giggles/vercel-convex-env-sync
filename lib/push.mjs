/**
 * env:sync:push — push local env file to Convex + Vercel with drift warnings.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pnpmExec, run } from "./exec.mjs";
import { hashEnvMap } from "./hash.mjs";
import { patchTarget, readMetadata } from "./metadata.mjs";
import { parseDotenv, serializeDotenv } from "./parse-dotenv.mjs";
import { resolveLocalEnvReadPath } from "./local-env-paths.mjs";
import { REPO_ROOT, SYNC_DIR, envSyncPath } from "./paths.mjs";
import { confirmOrCancel } from "./prompt.mjs";
import {
  convexArgsForTarget,
  fetchConvexEnvMap,
  fetchVercelEnvMap,
  vercelEnvName,
} from "./remote.mjs";
import { filterForConvex, filterForVercel } from "./split.mjs";

/** @typedef {import("./remote.mjs").TTarget} TTarget */

/**
 * @param {TTarget} target
 */
export async function pushTarget(target) {
  const localPath = resolveLocalEnvReadPath(target);
  if (!localPath) {
    throw new Error(
      `[env:sync] No local env file found for "${target}". Create one (see docs/env/ENVIRONMENTS.md).`
    );
  }

  const raw = fs.readFileSync(localPath, "utf8");
  const localMap = parseDotenv(raw);
  const localSourceHash = crypto
    .createHash("sha256")
    .update(raw, "utf8")
    .digest("hex");

  console.log(`[env:sync] Source file: ${path.relative(REPO_ROOT, localPath)}`);

  fs.mkdirSync(SYNC_DIR, { recursive: true });

  console.log(`[env:sync] Fetching current remote Convex + Vercel (for drift check)…`);
  const remoteConvex = fetchConvexEnvMap(target);
  const remoteVercel = fetchVercelEnvMap(target);

  const remoteConvexHash = hashEnvMap(remoteConvex);
  const remoteVercelHash = hashEnvMap(remoteVercel);

  const meta = readMetadata();
  const prev = meta[target];
  const driftConvex =
    prev?.convexHash && prev.convexHash !== remoteConvexHash;
  const driftVercel =
    prev?.vercelHash && prev.vercelHash !== remoteVercelHash;

  if (driftConvex || driftVercel) {
    console.warn(
      "[env:sync] ⚠ Remote environment(s) changed since the last recorded pull (or never pulled)."
    );
    if (driftConvex) {
      console.warn(
        "  • Convex: hosted env no longer matches last stored snapshot hash."
      );
    }
    if (driftVercel) {
      console.warn(
        "  • Vercel: hosted env no longer matches last stored snapshot hash."
      );
    }
    console.warn(
      "  Run `pnpm run env:sync:pull -- " +
        target +
        "` first to merge remote state, or continue to overwrite remote with your local file."
    );
    const ok = await confirmOrCancel("Continue with push?");
    if (!ok) {
      console.log("[env:sync] Push cancelled.");
      process.exitCode = 1;
      return;
    }
  }

  if (
    prev?.lastPushedLocalHash &&
    prev.lastPushedLocalHash !== localSourceHash
  ) {
    console.warn(
      "[env:sync] ⚠ Your local env file bytes changed since the last successful push."
    );
    const ok2 = await confirmOrCancel("Continue anyway?");
    if (!ok2) {
      console.log("[env:sync] Push cancelled.");
      process.exitCode = 1;
      return;
    }
  }

  if (target === "preview") {
    console.warn(
      "[env:sync] Note: Convex CLI targets dev or prod deployments only. This push applies Convex env to the **dev** deployment; ephemeral PR preview backends also use dashboard defaults."
    );
  }

  const convexFiltered = filterForConvex(localMap);
  const vercelFiltered = filterForVercel(localMap);

  const convexFile = envSyncPath(`push.convex.${target}`);
  fs.writeFileSync(convexFile, serializeDotenv(convexFiltered), "utf8");

  const cArgs = [
    "env",
    "set",
    "--from-file",
    convexFile,
    "--force",
    ...convexArgsForTarget(target),
  ];
  console.log(`[env:sync] Pushing to Convex (${target})…`);
  const cRes = pnpmExec("convex", cArgs);
  if (!cRes.ok) {
    console.error(cRes.stderr || cRes.stdout);
    throw new Error("convex env set --from-file failed");
  }
  if (cRes.stdout.trim()) console.log(cRes.stdout.trim());

  const vEnv = vercelEnvName(target);
  console.log(`[env:sync] Pushing to Vercel (${vEnv})…`);
  await pushVercelMap(vercelFiltered, vEnv);

  const now = new Date().toISOString();
  console.log("[env:sync] Re-fetching remote hashes after push…");
  const afterConvex = hashEnvMap(fetchConvexEnvMap(target));
  const afterVercel = hashEnvMap(fetchVercelEnvMap(target));
  patchTarget(target, {
    convexHash: afterConvex,
    vercelHash: afterVercel,
    lastPushedLocalHash: localSourceHash,
    lastPushAt: now,
  });

  console.log("[env:sync] Push finished.");
}

/**
 * @param {Map<string, string>} map
 * @param {string} envName
 */
async function pushVercelMap(map, envName) {
  for (const [key, value] of map) {
    if (value === "") {
      console.warn(`[env:sync] Skipping empty string for ${key}`);
      continue;
    }
    const sensitive = isSensitiveKey(key);
    const tryUpdate = () => {
      const args = ["env", "update", key, envName, "-y"];
      if (sensitive) args.push("--sensitive");
      return runVercelCli(args, { input: value });
    };
    let r = tryUpdate();
    if (!r.ok && /not found|does not exist|Unknown|No such/i.test(r.stderr + r.stdout)) {
      const addArgs = ["env", "add", key, envName, "-y"];
      if (sensitive) addArgs.push("--sensitive");
      r = runVercelCli(addArgs, { input: value });
    }
    if (!r.ok) {
      throw new Error(
        `vercel env failed for ${key}: ${r.stderr || r.stdout}`
      );
    }
  }
}

/**
 * @param {string[]} args
 * @param {{ input?: string }} [opts]
 */
function runVercelCli(args, opts = {}) {
  let r = run("vercel", args, opts);
  if (!r.ok && (r.error || /not found|ENOENT/i.test(r.stderr))) {
    r = run("pnpm", ["dlx", "vercel", ...args], opts);
  }
  return r;
}

function isSensitiveKey(key) {
  return /SECRET|PASSWORD|TOKEN|PRIVATE|KEY|API_KEY|COOKIE_PASSWORD/i.test(
    key
  );
}
