/**
 * Runtime configuration for env sync — read from environment variables.
 *
 * Two opt-in toggles extend the original single-repo / Convex+Vercel behavior:
 *
 * - **`ENV_SYNC_DISABLE_CONVEX=1`** — skip every Convex CLI call. Snapshots, drift checks,
 *   and pushes operate on the Vercel side only. Use in projects that don't have a Convex
 *   backend (e.g. Postgres / Drizzle / Neon stacks).
 *
 * - **`ENV_SYNC_VERCEL_PROJECT_CWD=<rel-path>`** — relative path (from REPO_ROOT) to the
 *   directory that owns `.vercel/project.json`. Default: `""` (REPO_ROOT itself). Use this
 *   when your Vercel-linked project lives in a subdirectory (e.g. `apps/admin`).
 *
 * - **`ENV_SYNC_VERCEL_PROJECTS=<rel,rel,...>`** — comma-separated relative paths used by
 *   `run.mjs` to loop pull/push/check across multiple Vercel-linked projects in a monorepo.
 *   Each iteration sets `ENV_SYNC_VERCEL_PROJECT_CWD` to the next entry. When unset or
 *   single-entry, behavior matches the original single-repo flow.
 *
 * All three are backwards-compatible: unset values reproduce the original behavior.
 */
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./paths.mjs";

/**
 * @returns {boolean} `true` when Convex CLI calls should run; `false` when disabled.
 */
export function isConvexEnabled() {
  const raw = process.env.ENV_SYNC_DISABLE_CONVEX?.trim().toLowerCase();
  if (!raw) return true;
  return !(raw === "1" || raw === "true" || raw === "yes");
}

/**
 * Validate and resolve a project-relative path to an absolute path inside `REPO_ROOT`.
 * Throws on absolute paths or paths that escape the repo root.
 *
 * @param {string} rel
 * @returns {string} absolute path
 */
function resolveProjectRel(rel) {
  if (path.isAbsolute(rel)) {
    throw new Error(
      `[env:sync] project path must be relative to repo root (got absolute: ${rel}).`
    );
  }
  const abs = path.resolve(REPO_ROOT, rel);
  const repoWithSep = REPO_ROOT.endsWith(path.sep) ? REPO_ROOT : REPO_ROOT + path.sep;
  if (abs !== REPO_ROOT && !abs.startsWith(repoWithSep)) {
    throw new Error(
      `[env:sync] project path escapes repo root: ${rel} → ${abs}`
    );
  }
  return abs;
}

/**
 * Absolute path to the Vercel-linked project directory used for `vercel env …` calls and
 * `.vercel/project.json` lookups. Defaults to `REPO_ROOT` (single-repo mode).
 *
 * @returns {string}
 */
export function getVercelProjectCwd() {
  const rel = process.env.ENV_SYNC_VERCEL_PROJECT_CWD?.trim() ?? "";
  if (!rel) return REPO_ROOT;
  return resolveProjectRel(rel);
}

/**
 * Short label for the active Vercel project — used in log lines so monorepo loops show
 * which project is being pushed/pulled.
 *
 * @returns {string} basename of the active project cwd, or `"."` for repo root.
 */
export function getVercelProjectLabel() {
  const rel = process.env.ENV_SYNC_VERCEL_PROJECT_CWD?.trim() ?? "";
  return rel || ".";
}

/**
 * @typedef {{ cwd: string; relPath: string; label: string }} TVercelProjectEntry
 */

/**
 * Parse `ENV_SYNC_VERCEL_PROJECTS` into a list of project entries. When the env var is
 * unset or empty, returns a single entry pointing at `REPO_ROOT` (matches original
 * single-repo behavior). When set, callers (e.g. `run.mjs`) loop the list and re-export
 * `ENV_SYNC_VERCEL_PROJECT_CWD` for each iteration.
 *
 * Empty entries (e.g. trailing commas) are dropped. Duplicates are preserved in declared
 * order so consumers can intentionally repeat a project.
 *
 * @returns {TVercelProjectEntry[]} Always at least one entry.
 */
export function getVercelProjects() {
  const raw = process.env.ENV_SYNC_VERCEL_PROJECTS?.trim();
  if (!raw) {
    return [{ cwd: REPO_ROOT, relPath: "", label: "." }];
  }
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (items.length === 0) {
    return [{ cwd: REPO_ROOT, relPath: "", label: "." }];
  }
  return items.map((rel) => ({
    cwd: resolveProjectRel(rel),
    relPath: rel,
    label: rel,
  }));
}

/**
 * Confirm the active project directory exists and contains `.vercel/project.json`.
 * Returns a structured diagnostic so callers can log a clear remediation hint instead
 * of a raw stack trace.
 *
 * @param {string} [cwd] — defaults to `getVercelProjectCwd()`
 * @returns {{ ok: true } | { ok: false; reason: string; cwd: string }}
 */
export function checkVercelProjectLinked(cwd) {
  const target = cwd ?? getVercelProjectCwd();
  if (!fs.existsSync(target)) {
    return {
      ok: false,
      cwd: target,
      reason: `directory does not exist: ${target}`,
    };
  }
  const link = path.join(target, ".vercel", "project.json");
  if (!fs.existsSync(link)) {
    return {
      ok: false,
      cwd: target,
      reason: `not linked — run \`cd ${path.relative(REPO_ROOT, target) || "."} && vercel link\` first`,
    };
  }
  return { ok: true };
}
