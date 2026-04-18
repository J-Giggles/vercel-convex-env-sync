#!/usr/bin/env node
/**
 * env:sync — pull or push env between local files, Convex, and Vercel.
 *
 * Usage:
 *   pnpm run env:sync:pull -- <dev|preview|prod>
 *   pnpm run env:sync:push -- <dev|preview|prod>
 */
import { pullTarget } from "./lib/pull.mjs";
import { pushTarget } from "./lib/push.mjs";

const VALID = new Set(["dev", "preview", "prod"]);

function usage() {
  console.log(`
Usage:
  pnpm run env:sync:pull -- <dev|preview|prod>
  pnpm run env:sync:push -- <dev|preview|prod>

Requires: Convex CLI (pnpm), Vercel CLI (\`vercel\` on PATH or pnpm dlx), linked project, and auth.
Snapshots: .env/sync/metadata.json (gitignored)
`);
}

const [, , cmd, target] = process.argv;

if (!cmd || !target || !VALID.has(target)) {
  usage();
  process.exitCode = 1;
  process.exit();
}

try {
  if (cmd === "pull") {
    await pullTarget(/** @type {"dev" | "preview" | "prod"} */ (target));
  } else if (cmd === "push") {
    await pushTarget(/** @type {"dev" | "preview" | "prod"} */ (target));
  } else {
    usage();
    process.exit(1);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
