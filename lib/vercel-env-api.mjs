/**
 * Vercel REST API helpers when the CLI cannot complete non-interactive Preview adds (e.g.
 * `git_branch_required` for `NEXT_PUBLIC_*` — see vercel/vercel#15763).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getVercelProjectCwd } from "./config.mjs";

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
 * Read the active Vercel project link (`.vercel/project.json`). In monorepo mode the
 * active project is set by `ENV_SYNC_VERCEL_PROJECT_CWD`; otherwise this resolves to
 * the repo root.
 *
 * @returns {{ projectId: string; orgId?: string } | null}
 */
export function readVercelProjectLink() {
  const p = path.join(getVercelProjectCwd(), ".vercel", "project.json");
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
 * **Project policy:** every variable is stored as `plain` so the value is readable directly
 * in the Vercel dashboard and via `vercel env pull`. Nothing is Sensitive or Encrypted in
 * this project. The `sensitive` / `sensitivePolicy` parameters are kept for backwards
 * compatibility with older call-sites and are ignored.
 *
 * @param {string} _key
 * @param {boolean} [_sensitive]
 * @param {boolean} [_sensitivePolicy]
 * @returns {"plain"}
 */
export function resolveVercelEnvApiType(_key, _sensitive, _sensitivePolicy) {
  return "plain";
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Retries transient network failures (`fetch failed`, TLS reset) and 429 rate limits.
 * `Retry-After` is honored when present; otherwise we back off 60s on 429 (Vercel's env
 * mutation endpoints cap at 60/min) and exponentially on other transient errors.
 *
 * @param {string} url
 * @param {RequestInit} init
 * @param {number} [attempt]
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, init, attempt = 0) {
  const maxAttempts = 6;
  try {
    const res = await fetch(url, init);
    if (res.status === 429 && attempt < maxAttempts - 1) {
      const raw = res.headers.get("retry-after");
      const parsed = raw ? Number.parseInt(raw, 10) : NaN;
      const waitMs =
        Number.isFinite(parsed) && parsed > 0
          ? parsed * 1000
          : 60_000 + attempt * 5_000;
      await sleep(waitMs);
      return fetchWithRetry(url, init, attempt + 1);
    }
    return res;
  } catch (e) {
    if (attempt >= maxAttempts - 1) throw e;
    await sleep(250 * (attempt + 1));
    return fetchWithRetry(url, init, attempt + 1);
  }
}

/**
 * Build the authenticated base URL + headers for `api.vercel.com` project-env endpoints.
 *
 * @returns {{ ok: true; base: string; headers: Record<string, string>; teamQp: string }
 *   | { ok: false; status: number; body: string }}
 */
function buildProjectEnvApiContext() {
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
  const teamQp = teamId ? `&teamId=${encodeURIComponent(teamId)}` : "";
  return {
    ok: true,
    base: `https://api.vercel.com/v10/projects/${encodeURIComponent(link.projectId)}/env`,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    teamQp,
  };
}

/**
 * Upsert one variable for **Preview**, **all preview branches** (no `gitBranch` in body).
 * Thin wrapper over {@link upsertVercelEnv} kept for the CLI-fallback path in `push.mjs`.
 *
 * @param {{ key: string; value: string; type: "plain" | "encrypted" | "sensitive" }} params
 * @returns {Promise<{ ok: boolean; status: number; body: string }>}
 */
export function upsertVercelEnvPreviewAllBranches(params) {
  return upsertVercelEnv({
    key: params.key,
    value: params.value,
    type: params.type,
    target: "preview",
  });
}

/**
 * Upsert a single Vercel project environment variable via REST API.
 *
 * **Why API (not CLI):** the Vercel CLI has no flag to create/update `type: "plain"` vars
 * (it defaults to `encrypted`). This project policy is "every var is plain so it's visible
 * in the dashboard", so every push must go through the API.
 *
 * Uses `POST /v10/projects/{id}/env?upsert=true` which replaces an existing entry's value
 * and `type` atomically, splitting shared-target rows when needed.
 *
 * @param {{
 *   key: string;
 *   value: string;
 *   type: "plain" | "encrypted" | "sensitive";
 *   target: "development" | "preview" | "production";
 *   gitBranch?: string;
 * }} params
 * @returns {Promise<{ ok: boolean; status: number; body: string }>}
 */
export async function upsertVercelEnv(params) {
  const ctx = buildProjectEnvApiContext();
  if (!ctx.ok) return ctx;
  const url = `${ctx.base}?upsert=true${ctx.teamQp}`;
  /** @type {Record<string, unknown>} */
  const body = {
    key: params.key,
    value: params.value,
    type: params.type,
    target: [params.target],
  };
  if (params.target === "preview" && params.gitBranch) {
    body.gitBranch = params.gitBranch;
  }
  try {
    const res = await fetchWithRetry(url, {
      method: "POST",
      headers: ctx.headers,
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, body: msg };
  }
}

/**
 * @typedef {{
 *   id: string;
 *   key: string;
 *   value?: string;
 *   type: "plain" | "encrypted" | "sensitive" | "system" | "secret";
 *   target: readonly ("development" | "preview" | "production")[];
 *   gitBranch?: string;
 * }} TVercelEnvRow
 */

/**
 * List all env vars on the linked Vercel project (includes type so we can find non-plain rows).
 *
 * @returns {Promise<{ ok: boolean; status: number; body: string; envs: TVercelEnvRow[] }>}
 */
export async function listProjectEnvRows() {
  const ctx = buildProjectEnvApiContext();
  if (!ctx.ok) return { ...ctx, envs: [] };
  const url = `${ctx.base}?decrypt=false${ctx.teamQp}`;
  try {
    const res = await fetchWithRetry(url, {
      method: "GET",
      headers: ctx.headers,
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, body: text, envs: [] };
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, status: res.status, body: text, envs: [] };
    }
    const obj = /** @type {Record<string, unknown>} */ (
      parsed && typeof parsed === "object" ? parsed : {}
    );
    const arr = Array.isArray(obj.envs) ? obj.envs : [];
    /** @type {TVercelEnvRow[]} */
    const envs = [];
    for (const row of arr) {
      if (!row || typeof row !== "object") continue;
      const r = /** @type {Record<string, unknown>} */ (row);
      const id = typeof r.id === "string" ? r.id : "";
      const key = typeof r.key === "string" ? r.key : "";
      const type = typeof r.type === "string" ? r.type : "";
      const target = Array.isArray(r.target) ? r.target : [];
      if (!id || !key || !type) continue;
      envs.push(
        /** @type {TVercelEnvRow} */ ({
          id,
          key,
          value: typeof r.value === "string" ? r.value : undefined,
          type,
          target,
          gitBranch:
            typeof r.gitBranch === "string" ? r.gitBranch : undefined,
        })
      );
    }
    return { ok: true, status: res.status, body: text, envs };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, body: msg, envs: [] };
  }
}

/**
 * Delete a single env var by its Vercel-internal id.
 *
 * @param {string} envId
 * @returns {Promise<{ ok: boolean; status: number; body: string }>}
 */
export async function deleteProjectEnvRow(envId) {
  const ctx = buildProjectEnvApiContext();
  if (!ctx.ok) return ctx;
  const url = `${ctx.base}/${encodeURIComponent(envId)}?${ctx.teamQp.slice(1)}`;
  try {
    const res = await fetchWithRetry(url, {
      method: "DELETE",
      headers: ctx.headers,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, body: msg };
  }
}
