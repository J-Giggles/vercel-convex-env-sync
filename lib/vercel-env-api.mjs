/**
 * Vercel REST API helpers when the CLI cannot complete non-interactive Preview adds (e.g.
 * `git_branch_required` for `NEXT_PUBLIC_*` — see vercel/vercel#15763).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REPO_ROOT } from "./paths.mjs";

/**
 * Global CLI login stores a bearer token here (same token the CLI uses for API calls).
 *
 * @returns {readonly string[]}
 */
function getVercelAuthJsonPaths() {
  const h = os.homedir();
  /** @type {string[]} */
  const paths = [];
  if (process.platform === "darwin") {
    paths.push(
      path.join(h, "Library", "Application Support", "com.vercel.cli", "auth.json")
    );
  } else if (process.platform === "win32") {
    const appData =
      process.env.APPDATA || path.join(h, "AppData", "Roaming");
    paths.push(path.join(appData, "com.vercel.cli", "auth.json"));
  } else {
    const xdg =
      process.env.XDG_DATA_HOME || path.join(h, ".local", "share");
    paths.push(path.join(xdg, "com.vercel.cli", "auth.json"));
  }
  paths.push(path.join(h, ".config", "vercel", "auth.json"));
  return paths;
}

/**
 * @param {unknown} j
 * @returns {string}
 */
function extractTokenFromAuthObject(j) {
  if (!j || typeof j !== "object") return "";
  const o = /** @type {Record<string, unknown>} */ (j);
  const top = o.token;
  if (typeof top === "string" && top.trim()) return top.trim();
  const creds = o.credentials;
  if (Array.isArray(creds)) {
    for (const c of creds) {
      if (c && typeof c === "object" && "token" in c) {
        const t = /** @type {{ token?: unknown }} */ (c).token;
        if (typeof t === "string" && t.trim()) return t.trim();
      }
    }
  }
  return "";
}

/**
 * Bearer token for `api.vercel.com`: **`VERCEL_TOKEN`** env, else the same file **`vercel login`** writes
 * (e.g. `~/.local/share/com.vercel.cli/auth.json` on Linux).
 *
 * @returns {string}
 */
export function readVercelTokenForApi() {
  const fromEnv = process.env.VERCEL_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  for (const p of getVercelAuthJsonPaths()) {
    if (!fs.existsSync(p)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      const tok = extractTokenFromAuthObject(j);
      if (tok) return tok;
    } catch {
      /* ignore */
    }
  }
  return "";
}

/**
 * @returns {{ projectId: string; orgId?: string } | null}
 */
export function readVercelProjectLink() {
  const p = path.join(REPO_ROOT, ".vercel", "project.json");
  if (!fs.existsSync(p)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const projectId = typeof j.projectId === "string" ? j.projectId : "";
    if (!projectId) return null;
    const orgId =
      typeof j.orgId === "string"
        ? j.orgId
        : typeof j.settings?.orgId === "string"
          ? j.settings.orgId
          : undefined;
    return { projectId, orgId };
  } catch {
    return null;
  }
}

/**
 * Maps sync heuristics to Vercel API `type` (create/update env).
 *
 * @param {string} key
 * @param {boolean} sensitive — `isSensitiveKey(key)` from push
 * @param {boolean} sensitivePolicy — `resolveVercelSensitiveForPush` result from env-sync-defaults
 * @returns {"plain" | "encrypted" | "sensitive"}
 */
export function resolveVercelEnvApiType(key, sensitive, sensitivePolicy) {
  if (key.startsWith("NEXT_PUBLIC_")) return "plain";
  if (sensitive && sensitivePolicy) return "sensitive";
  return "encrypted";
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Retries transient network failures (`fetch failed`, TLS reset, etc.) from parallel Preview upserts.
 *
 * @param {string} url
 * @param {RequestInit} init
 * @param {number} [attempt]
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, init, attempt = 0) {
  const maxAttempts = 4;
  try {
    return await fetch(url, init);
  } catch (e) {
    if (attempt >= maxAttempts - 1) throw e;
    await sleep(250 * (attempt + 1));
    return fetchWithRetry(url, init, attempt + 1);
  }
}

/**
 * Upserts one variable for **Preview**, **all preview branches** (no `gitBranch` in body).
 *
 * @param {{ key: string; value: string; type: "plain" | "encrypted" | "sensitive" }} params
 * @returns {Promise<{ ok: boolean; status: number; body: string }>}
 */
export async function upsertVercelEnvPreviewAllBranches(params) {
  const token = readVercelTokenForApi();
  if (!token) {
    return {
      ok: false,
      status: 0,
      body:
        "No Vercel token: set VERCEL_TOKEN or run `vercel login` (token is read from the CLI auth file when present)",
    };
  }
  const link = readVercelProjectLink();
  if (!link) {
    return {
      ok: false,
      status: 0,
      body: ".vercel/project.json not found or missing projectId",
    };
  }
  const teamOverride = process.env.ENV_SYNC_VERCEL_TEAM_ID?.trim();
  const teamId = teamOverride || link.orgId;
  const qp = new URLSearchParams({ upsert: "true" });
  if (teamId) qp.set("teamId", teamId);
  const url = `https://api.vercel.com/v10/projects/${encodeURIComponent(link.projectId)}/env?${qp}`;
  const body = {
    key: params.key,
    value: params.value,
    type: params.type,
    target: ["preview"],
  };
  try {
    const res = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, body: msg };
  }
}
