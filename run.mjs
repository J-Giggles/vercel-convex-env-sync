#!/usr/bin/env node
/**
 * env:sync — pull or push env between local files, Convex, and Vercel.
 *
 * Usage:
 *   pnpm run env:sync:pull
 *   pnpm run env:sync:pull -- --all
 *   pnpm run env:sync:pull -- <dev|preview|prod> [--snapshot-only]
 *   pnpm run env:sync:push -- <dev|preview|prod> [--yes] [--from-sync]
 *   pnpm run env:sync:push -- --all [--yes] [--from-working]
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
  pnpm run env:sync:push -- --all
                        Push dev, then preview, then prod. Default: each reads its .env.sync.* snapshot
                        (same files as env:sync:pull -- --all). Requires CONVEX_DEPLOYMENT in each file.

  --from-sync       (push only, single target) Read the matching .env.sync.* instead of working files.

  --from-working    (push only, with --all) Read per-target working files (.env.local / .env.preview /
                        .env.production.local) instead of .env.sync.* — legacy behavior.

  --yes, -y         (push only) Skip drift / local-change confirmations.

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
const pushAll = cmd === "push" && flags.has("--all");
const pushYes = cmd === "push" && (flags.has("--yes") || flags.has("-y"));
const pushFromSync = cmd === "push" && flags.has("--from-sync");
const pushFromWorking = cmd === "push" && flags.has("--from-working");

if (
  !cmd ||
  (cmd === "push" && !pushAll && (!target || !VALID.has(target)))
) {
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
    /** `push --all` defaults to snapshot files so preview/prod are not overwritten from `.env.local`. */
    const fromSyncForPush = pushAll ? !pushFromWorking : pushFromSync;
    if (pushFromWorking && !pushAll) {
      console.warn(
        "[env:sync] Ignoring --from-working without --all (single-target push already uses working files unless you pass --from-sync)."
      );
    }
    const pushOpts = { yes: pushYes, fromSync: fromSyncForPush };
    if (pushAll) {
      for (const t of /** @type {const} */ (["dev", "preview", "prod"])) {
        console.log(`\n[env:sync] ========== push ${t} ==========\n`);
        await pushTarget(t, pushOpts);
      }
    } else {
      await pushTarget(
        /** @type {"dev" | "preview" | "prod"} */ (target),
        pushOpts
      );
    }
  } else {
    usage();
    process.exit(1);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
