/**
 * Spawn CLI commands with captured stdout/stderr.
 */
import { spawnSync } from "node:child_process";
import { REPO_ROOT } from "./paths.mjs";

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string; input?: string }} [opts]
 */
export function run(command, args, opts = {}) {
  const r = spawnSync(command, args, {
    cwd: opts.cwd ?? REPO_ROOT,
    encoding: "utf8",
    input: opts.input,
    maxBuffer: 20 * 1024 * 1024,
    stdio: opts.input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
  });
  const err = r.error;
  return {
    ok: r.status === 0 && !err,
    status: r.status ?? (err ? 127 : 0),
    stdout: r.stdout ?? "",
    stderr: (err ? `${err.message}\n` : "") + (r.stderr ?? ""),
    error: err,
  };
}

/** Run `pnpm exec <binary> ...` from repo root. */
export function pnpmExec(binary, args) {
  return run("pnpm", ["exec", binary, ...args]);
}
