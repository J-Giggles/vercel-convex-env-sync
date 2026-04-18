#!/usr/bin/env node
/**
 * env:sync — pull or push env between local files, Convex, and Vercel.
 *
 * Usage:
 *   pnpm run env:sync:pull
 *   pnpm run env:sync:pull -- --all
 *   pnpm run env:sync:pull -- <dev|preview|prod> [--snapshot-only]
 *   pnpm run env:sync:push -- <dev|preview|prod>
 */
import { interactivePull } from "./lib/interactive-pull.mjs";
import { pullAllVercelDeployments } from "./lib/pull-all.mjs";
import { pullTarget } from "./lib/pull.mjs";
import { pushTarget } from "./lib/push.mjs";

const VALID = new Set(["dev", "preview", "prod"]);

function usage() {
  console.log(`
Usage:
  pnpm run env:sync:pull
                        Interactive: list Vercel env targets, infer Convex link, then merge.

  pnpm run env:sync:pull -- --all
                        For each Vercel target: merge Convex + Vercel (same pairing as dev/preview/prod
                        presets), format with .env.example, write .env.sync.<environment>.

  pnpm run env:sync:pull -- <dev|preview|prod> [--snapshot-only]
                        Non-interactive preset (same pairing as before).

  pnpm run env:sync:push -- <dev|preview|prod>

  --snapshot-only   (pull only) Write .env.sync.merge.<target> only; do not update .env.local / .env.production.local.

Requires: Convex CLI (pnpm), Vercel CLI (\`vercel\` on PATH or pnpm dlx), linked project, and auth.
Snapshots: .env/sync/metadata.json (gitignored)
`);
}

/** Args after `node run.mjs` — drop `--` so `pnpm run … -- dev` works. */
const raw = process.argv.slice(2).filter((a) => a !== "--");
const flags = new Set(raw.filter((a) => a.startsWith("-")));
const positional = raw.filter((a) => !a.startsWith("-"));
const [cmd, target] = positional;
const snapshotOnly = flags.has("--snapshot-only");
const pullAll = flags.has("--all");

if (!cmd || (cmd === "push" && (!target || !VALID.has(target)))) {
  usage();
  process.exitCode = 1;
  process.exit();
}

if (cmd === "pull" && target && !VALID.has(target)) {
  usage();
  process.exitCode = 1;
  process.exit();
}

try {
  if (cmd === "pull") {
    if (pullAll) {
      if (target && VALID.has(target)) {
        console.warn(
          "[env:sync] Ignoring preset target with --all; use one or the other."
        );
      }
      await pullAllVercelDeployments();
    } else if (!target) {
      await interactivePull({ snapshotOnly });
    } else {
      await pullTarget(/** @type {"dev" | "preview" | "prod"} */ (target), {
        snapshotOnly,
      });
    }
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
