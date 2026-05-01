/**
 * env:sync:pull --all — merged Convex + Vercel per Vercel target, formatted like preset pull.
 */
import fs from "node:fs";
import path from "node:path";
import { isConvexEnabled } from "./config.mjs";
import {
  fetchConvexEnvMapOptions,
  fetchVercelEnvMapOptions,
  vercelEnvironmentToPresetTarget,
} from "./remote.mjs";
import {
  fetchVercelProjectEnvList,
  distinctVercelDeploymentTargets,
} from "./vercel-project-env-list.mjs";
import {
  formatEnvFromExampleTemplate,
  resolveExampleTemplatePath,
} from "./format-env-from-example.mjs";
import { serializeDotenv } from "./parse-dotenv.mjs";
import { REPO_ROOT, envSyncPath } from "./paths.mjs";
import { mergeWithWarnings } from "./pull.mjs";
import { resolveConvexMapForVercelPull } from "./resolve-convex-map-for-vercel-pull.mjs";
import { filterMergedForLocalWorkspace } from "./split.mjs";
import { syncInfo, syncWarn } from "./cli-style.mjs";

/**
 * For each Vercel environment used by the linked project, merge hosted Convex + Vercel the same way
 * as preset `dev` / `preview` / `prod` pulls, then write **`.env.<environment>.pull`** using the matching
 * `.env.example` template (see `resolveExampleTemplatePath`).
 */
export async function pullAllVercelDeployments() {
  syncInfo("pull --all: loading Vercel project env inventory…");
  const { envs } = fetchVercelProjectEnvList();
  const targets = distinctVercelDeploymentTargets(envs);
  if (targets.length === 0) {
    throw new Error(
      "No Vercel deployment targets (development / preview / production) found in project env list."
    );
  }

  const convexEnabled = isConvexEnabled();
  /** @type {Map<string, string>} */
  let convexDevMap = new Map();
  /** @type {Map<string, string>} */
  let convexProdMap = new Map();
  if (convexEnabled) {
    syncInfo("Loading Convex (development + production deployments)…");
    convexDevMap = fetchConvexEnvMapOptions({ useProd: false });
    convexProdMap = fetchConvexEnvMapOptions({ useProd: true });
  } else {
    syncInfo("Convex disabled (ENV_SYNC_DISABLE_CONVEX=1) — pulling Vercel only.");
  }

  syncInfo(
    `Writing ${targets.length} merged file(s): .env.sync.<environment> (${convexEnabled ? "Convex + Vercel" : "Vercel only"}, example layout)`
  );

  for (const envName of targets) {
    const presetTarget = vercelEnvironmentToPresetTarget(
      /** @type {"development" | "preview" | "production"} */ (envName)
    );

    syncInfo(
      convexEnabled
        ? `Pulling Vercel ${envName} + Convex (from Vercel-linked deployment when possible)…`
        : `Pulling Vercel ${envName}…`
    );
    const vercelMap = fetchVercelEnvMapOptions(envName);
    const convexMap = convexEnabled
      ? resolveConvexMapForVercelPull(
          vercelMap,
          presetTarget,
          convexDevMap,
          convexProdMap
        )
      : new Map();
    const merged = mergeWithWarnings(vercelMap, convexMap);
    const forLocal = filterMergedForLocalWorkspace(merged);

    const templateAbs = resolveExampleTemplatePath(REPO_ROOT, presetTarget);
    /** @type {string} */
    let body;
    if (templateAbs) {
      try {
        const templateContent = fs.readFileSync(templateAbs, "utf8");
        body = formatEnvFromExampleTemplate(templateContent, forLocal);
        syncInfo(
          `  Layout from template → ${path.relative(REPO_ROOT, templateAbs)}`
        );
      } catch (e) {
        syncWarn(
          `  Could not read template (${templateAbs}); using sorted keys. ${e instanceof Error ? e.message : e}`
        );
        body = serializeDotenv(forLocal);
      }
    } else {
      syncWarn(
        `  No .env example template for preset "${presetTarget}"; using sorted keys.`
      );
      body = serializeDotenv(forLocal);
    }

    const abs = envSyncPath(envName);
    const rel = path.relative(REPO_ROOT, abs);
    fs.writeFileSync(abs, body, "utf8");
    syncInfo(`Wrote ${rel}`);
  }

  syncInfo("pull --all complete.");
}
