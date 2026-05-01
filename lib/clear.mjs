/**
 * Interactive env:sync:clear — remove hosted env vars from selected Vercel scopes and/or Convex deployments.
 */
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { isConvexEnabled } from "./config.mjs";
import { runVercel } from "./remote.mjs";
import { parseVercelJsonStdout } from "./vercel-project-env-list.mjs";
import { pnpmExec } from "./exec.mjs";
import {
  getVercelPreviewGitBranch,
  isVercelPreviewNoGitBranch,
} from "./vercel-preview-branch.mjs";
import { syncInfo, syncWarn, syncError, syncSuccess, syncDim } from "./cli-style.mjs";

/**
 * @typedef {{
 *   id: string;
 *   label: string;
 *   kind: "vercel" | "convex";
 *   vercelEnv?: "development" | "preview" | "production";
 *   previewBranch?: string;
 *   convexProd?: boolean;
 * }} TClearDestination
 */

/** @type {TClearDestination[]} */
const DESTINATIONS = [
  {
    id: "vercel-dev",
    label: "Vercel → Development (all variables in this environment)",
    kind: "vercel",
    vercelEnv: "development",
  },
  {
    id: "vercel-preview",
    label:
      "Vercel → Preview (default git branch `staging`; set ENV_SYNC_VERCEL_PREVIEW_BRANCH or ENV_SYNC_VERCEL_PREVIEW_NO_BRANCH=1 for unscoped)",
    kind: "vercel",
    vercelEnv: "preview",
  },
  {
    id: "vercel-prod",
    label: "Vercel → Production",
    kind: "vercel",
    vercelEnv: "production",
  },
  {
    id: "convex-dev",
    label: "Convex → dev deployment (`convex env list`, no --prod)",
    kind: "convex",
    convexProd: false,
  },
  {
    id: "convex-prod",
    label: "Convex → production deployment (`convex env list --prod`)",
    kind: "convex",
    convexProd: true,
  },
];

/**
 * @param {{ dryRun?: boolean }} opts
 * @returns {Promise<void>}
 */
export async function interactiveClear(opts = {}) {
  const dryRun = opts.dryRun === true;
  const convexEnabled = isConvexEnabled();
  /** Hide Convex destinations when ENV_SYNC_DISABLE_CONVEX=1 — Vercel-only menu. */
  const visible = convexEnabled
    ? DESTINATIONS
    : DESTINATIONS.filter((d) => d.kind !== "convex");
  const rl = readline.createInterface({ input, output });
  try {
    syncInfo("Clear hosted environment variables — choose one or more destinations.");
    syncDim(
      convexEnabled
        ? "Local `.env*` files are not modified. This only affects Vercel / Convex hosting."
        : "Local `.env*` files are not modified. This only affects Vercel hosting (Convex disabled)."
    );
    if (dryRun) {
      syncWarn("DRY RUN — no variables will be removed.");
    }

    const max = visible.length;
    const menu = visible.map((d, i) => `  ${i + 1}) ${d.label}`).join("\n");
    console.log(`\nEnter numbers 1–${max} separated by commas or spaces (e.g. 1,3  or  2 4):\n${menu}\n`);
    const raw = (await rl.question("Selection (empty = cancel): ")).trim();
    if (!raw) {
      syncInfo("Nothing selected. Exiting.");
      return;
    }

    const nums = raw
      .split(/[\s,]+/)
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= max);
    const uniq = [...new Set(nums)];
    if (uniq.length === 0) {
      syncWarn("No valid numbers. Exiting.");
      return;
    }

    /** @type {TClearDestination[]} */
    const selected = uniq.map((n) => visible[n - 1]);

    let total = 0;
    const lines = [];
    for (const d of selected) {
      if (d.kind === "vercel" && d.vercelEnv === "preview") {
        d.previewBranch = getVercelPreviewGitBranch();
      }
      const n = await countRemovals(d);
      total += n;
      lines.push(`  • ${d.label}: ${n} variable(s)`);
    }

    console.log("");
    syncInfo("Planned removals:");
    lines.forEach((l) => console.log(l));
    syncInfo(`Total: ${total} removal(s).`);

    if (total === 0) {
      syncInfo("Nothing to remove.");
      return;
    }

    if (!dryRun) {
      const ok = await askConfirmDestructive(rl, total);
      if (!ok) {
        syncInfo("Cancelled.");
        return;
      }
    }

    for (const d of selected) {
      await executeClearDestination(d, dryRun);
    }

    if (dryRun) {
      syncSuccess("Dry run finished — no changes made.");
    } else {
      syncSuccess("Clear finished.");
    }
  } finally {
    rl.close();
  }
}

/**
 * @param {import("node:readline/promises").Interface} rl
 * @param {number} total
 */
async function askConfirmDestructive(rl, total) {
  syncWarn(
    `This will permanently remove ${total} hosted variable binding(s). Type YES to confirm:`
  );
  const a = (await rl.question("> ")).trim();
  return a === "YES";
}

/**
 * @param {TClearDestination} d
 * @returns {Promise<number>}
 */
async function countRemovals(d) {
  if (d.kind === "vercel") {
    const keys = await listVercelKeys(d);
    return keys.length;
  }
  const keys = await listConvexKeys(d.convexProd === true);
  return keys.length;
}

/**
 * @param {TClearDestination} d
 * @returns {Promise<string[]>}
 */
async function listVercelKeys(d) {
  const env = /** @type {"development" | "preview" | "production"} */ (
    d.vercelEnv ?? "development"
  );
  /** @type {string[]} */
  let args;
  if (env === "preview") {
    if (isVercelPreviewNoGitBranch()) {
      args = ["env", "list", env, "--format", "json"];
    } else {
      const branch = d.previewBranch ?? getVercelPreviewGitBranch();
      if (!branch) {
        syncWarn(
          "Preview branch unknown — set ENV_SYNC_VERCEL_PREVIEW_BRANCH, or ENV_SYNC_VERCEL_PREVIEW_NO_BRANCH=0 for default `staging`."
        );
        return [];
      }
      args = ["env", "list", env, branch, "--format", "json"];
    }
  } else {
    args = ["env", "list", env, "--format", "json"];
  }
  const r = runVercel(args);
  if (!r.ok) {
    throw new Error(
      `vercel env list failed (${r.status}):\n${r.stderr || r.stdout}`
    );
  }
  const data = parseVercelJsonStdout(r.stdout);
  const envs = data.envs ?? [];
  return envs.map((/** @type {{ key: string }} */ e) => e.key).filter(Boolean);
}

/**
 * @param {boolean} useProd
 * @returns {Promise<string[]>}
 */
async function listConvexKeys(useProd) {
  const extra = useProd ? ["--prod"] : [];
  const r = pnpmExec("convex", ["env", "list", ...extra]);
  if (!r.ok) {
    throw new Error(
      `convex env list failed (${r.status}):\n${r.stderr || r.stdout}`
    );
  }
  /** @type {string[]} */
  const keys = [];
  for (const line of r.stdout.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    keys.push(t.slice(0, eq).trim());
  }
  return keys;
}

/**
 * @param {TClearDestination} d
 * @param {boolean} dryRun
 * @returns {Promise<void>}
 */
async function executeClearDestination(d, dryRun) {
  if (d.kind === "vercel") {
    const env = /** @type {"development" | "preview" | "production"} */ (
      d.vercelEnv ?? "development"
    );
    const keys = await listVercelKeys(d);
    const branch =
      env === "preview" ? d.previewBranch ?? getVercelPreviewGitBranch() : "";
    for (const key of keys) {
      if (dryRun) {
        syncDim(
          `[dry-run] vercel env rm ${key} ${env}${branch ? ` ${branch}` : ""} -y`
        );
        continue;
      }
      /** @type {string[]} */
      const args = ["env", "rm", key, env];
      if (env === "preview" && branch) args.push(branch);
      args.push("-y");
      const r = runVercel(args);
      if (!r.ok) {
        syncError(
          `vercel env rm ${key} (${env}): ${(r.stderr || r.stdout).trim()}`
        );
      } else {
        syncInfo(`Removed Vercel ${env}: ${key}`);
      }
    }
    return;
  }

  const useProd = d.convexProd === true;
  const keys = await listConvexKeys(useProd);
  const label = useProd ? "prod" : "dev";
  for (const key of keys) {
    if (dryRun) {
      syncDim(
        `[dry-run] convex env remove ${key}${useProd ? " --prod" : ""}`
      );
      continue;
    }
    const extra = useProd ? ["--prod"] : [];
    const r = pnpmExec("convex", ["env", "remove", key, ...extra]);
    if (!r.ok) {
      syncError(
        `convex env remove ${key}: ${(r.stderr || r.stdout).trim()}`
      );
    } else {
      syncInfo(`Removed Convex (${label}): ${key}`);
    }
  }
}
