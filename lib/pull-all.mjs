/**
 * env:sync:pull --all — merged Convex + Vercel per Vercel target, formatted like preset pull.
 */
import fs from "node:fs";
import path from "node:path";
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
import { filterMergedForLocalWorkspace } from "./split.mjs";

/**
 * For each Vercel environment used by the linked project, merge hosted Convex + Vercel the same way
 * as preset `dev` / `preview` / `prod` pulls, then write **`.env.<environment>.pull`** using the matching
 * `.env.example` template (see `resolveExampleTemplatePath`).
 */
export async function pullAllVercelDeployments() {
  console.log("[env:sync] pull --all: loading Vercel project env inventory…");
  const { envs } = fetchVercelProjectEnvList();
  const targets = distinctVercelDeploymentTargets(envs);
  if (targets.length === 0) {
    throw new Error(
      "No Vercel deployment targets (development / preview / production) found in project env list."
    );
  }

  console.log("[env:sync] Loading Convex (development + production deployments)…");
  const convexDevMap = fetchConvexEnvMapOptions({ useProd: false });
  const convexProdMap = fetchConvexEnvMapOptions({ useProd: true });

  console.log(
    `[env:sync] Writing ${targets.length} merged file(s): .env.sync.<environment> (Convex + Vercel, example layout)`
  );

  for (const envName of targets) {
    const presetTarget = vercelEnvironmentToPresetTarget(
      /** @type {"development" | "preview" | "production"} */ (envName)
    );
    const convexMap = presetTarget === "prod" ? convexProdMap : convexDevMap;

    console.log(
      `[env:sync] Pulling Vercel ${envName} + Convex ${presetTarget === "prod" ? "production (`--prod`)" : "development"}…`
    );
    const vercelMap = fetchVercelEnvMapOptions(envName);
    const merged = mergeWithWarnings(vercelMap, convexMap);
    const forLocal = filterMergedForLocalWorkspace(merged);

    const templateAbs = resolveExampleTemplatePath(REPO_ROOT, presetTarget);
    /** @type {string} */
    let body;
    if (templateAbs) {
      try {
        const templateContent = fs.readFileSync(templateAbs, "utf8");
        body = formatEnvFromExampleTemplate(templateContent, forLocal);
        console.log(
          `[env:sync]   Layout from template → ${path.relative(REPO_ROOT, templateAbs)}`
        );
      } catch (e) {
        console.warn(
          `[env:sync]   Could not read template (${templateAbs}); using sorted keys.`,
          e instanceof Error ? e.message : e
        );
        body = serializeDotenv(forLocal);
      }
    } else {
      console.warn(
        `[env:sync]   No .env example template for preset "${presetTarget}"; using sorted keys.`
      );
      body = serializeDotenv(forLocal);
    }

    const abs = envSyncPath(envName);
    const rel = path.relative(REPO_ROOT, abs);
    fs.writeFileSync(abs, body, "utf8");
    console.log(`[env:sync] Wrote ${rel}`);
  }

  console.log("[env:sync] pull --all complete.");
}
