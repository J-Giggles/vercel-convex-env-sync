#!/usr/bin/env node
/**
 * env:sync — pull or push env between local files, Convex, and Vercel.
 *
 * Usage:
 *   pnpm run env:sync:pull
 *   pnpm run env:sync:pull -- --all
 *   pnpm run env:sync:pull -- <dev|preview|prod> [--snapshot-only]
 *   pnpm run env:sync:push -- <dev|preview|prod> [--yes] [--from-working] [convex]
 *   pnpm run env:sync:push -- --all [--yes] [--from-working] [convex]
 *   pnpm run env:sync:push -- … [--convex-only]   (same as trailing `convex`)
 *   pnpm run env:sync:push:cli
 *   pnpm run env:sync:clear [-- --dry-run]
 *   pnpm run deploy -- <staging|production> [--git-push] [--yes]
 */
import { checkTarget } from "./lib/check.mjs";
import { interactivePull } from "./lib/interactive-pull.mjs";
import { pullAllVercelDeployments } from "./lib/pull-all.mjs";
import { pullTarget } from "./lib/pull.mjs";
import { pushTarget } from "./lib/push.mjs";
import { interactivePushCli } from "./lib/interactive-push-cli.mjs";
import { interactiveClear } from "./lib/clear.mjs";
import { deployTarget, parseDeployArgs } from "./lib/deploy.mjs";
import { syncMergeTarget } from "./lib/sync-merge.mjs";
import { syncInfo, syncWarn } from "./lib/cli-style.mjs";

const VALID = new Set(["dev", "preview", "prod"]);

function usage() {
  console.log(`
Usage:
  pnpm run env:sync:pull
                        Interactive: merge one scope or option 0 = pull all (same as pull -- --all);
                        writes .env.sync.* snapshot files.

  pnpm run env:sync:pull -- --all
                        For each Vercel target: merge Convex + Vercel (same pairing as dev/preview/prod
                        presets), format with .env.example, write .env.sync.<environment>.

  pnpm run env:sync:pull -- <dev|preview|prod> [--snapshot-only]
                        Non-interactive preset (same pairing as before).

  pnpm run env:sync:push -- <dev|preview|prod>
  pnpm run env:sync:push -- <dev|preview|prod> convex
  pnpm run env:sync:push -- --all
  pnpm run env:sync:push -- --all convex
                        Default: each target reads its .env.sync.* snapshot (same files as
                        env:sync:pull -- --all). Each snapshot needs Convex routing
                        (CONVEX_DEPLOY_KEY and/or NEXT_PUBLIC_CONVEX_URL). Pass --from-working
                        to read working files (.env.local / .env.preview / .env.production.local) instead.

  Trailing \`convex\` or flag \`--convex-only\`: run \`convex env set\` only — no Vercel CLI (faster).

  pnpm run env:sync:push:cli
                        Interactive push: choose targets, from-sync vs working, Vercel sensitive, --yes.

  pnpm run env:sync:check -- <dev|preview|prod> [--from-working] [--convex-only|--vercel-only] [-q]
                        Read-only diff: compare local file vs hosted Convex + Vercel for the target.
                        Exits 0 if in sync, 1 otherwise. Default source is .env.sync.<env>; pass
                        --from-working for working .env files. Use -q / --quiet to print only
                        \`true\` / \`false\`. Also flags keys present locally/remotely but not
                        validated by env.ts (deprecated / unmanaged).

  pnpm run env:sync -- <dev|preview|prod> [--yes] [--skip-push]
                        Three-way merge .env.sync.<env> ↔ Convex ↔ Vercel: any key that's empty
                        or missing on one side and filled on another is propagated everywhere.
                        Distinct non-empty values are flagged as conflicts and skipped.
                        Writes the merged map back to .env.sync.<env>, then pushes to both
                        remotes (skip with --skip-push).

  pnpm run env:sync:clear [-- --dry-run]
                        Interactive: choose Vercel (dev/preview/prod) and/or Convex (dev/prod) to remove
                        hosted variables. --dry-run lists removals only.

  pnpm run deploy -- <staging|production>
                        Run gates, sync env, deploy Convex, then deploy Vercel directly.
                        Staging maps to Vercel Preview + branch staging; production maps to
                        Vercel Production + branch production.

  pnpm run deploy -- <staging|production> --git-push
                        Run the same gates/env/Convex deploy, then push the mapped branch instead
                        of calling Vercel CLI directly.

  --from-sync       (push only) No-op alias kept for backwards compatibility — push always reads
                        .env.sync.* by default now.

  --from-working    (push only) Read per-target working files (.env.local / .env.preview /
                        .env.production.local) instead of .env.sync.* — legacy behavior.

  --interactive     (push only) Same as env:sync:push:cli — guided push.

  --yes, -y         (push only) Skip drift / local-change confirmations.

  --convex-only     (push only) Same as trailing \`convex\`: Convex only, skip Vercel.

  --force           (push only) Disable per-key diff; push every key even if the remote value matches.
                        Default behavior fetches remote Convex + Vercel maps and only pushes keys whose
                        value differs or that are new.

  Deploy flags:
  --git-push        Push staging/production branch for Vercel Git integration instead of \`vercel deploy\`.
  --from-working    Read working .env files instead of .env.sync.* snapshots for deploy env sync.
  --skip-gates      Skip lint, typecheck, and build.
  --skip-env-sync   Skip hosted env push.
  --skip-convex-deploy
  --skip-vercel-deploy

  --snapshot-only   (pull only) Write .env.sync.merge.<target> only; do not update .env.local / .env.production.local.

Requires: Convex CLI (pnpm), Vercel CLI (\`vercel\` on PATH or pnpm dlx), linked project, and auth.
Snapshots: .env/sync/metadata.json (gitignored)
`);
}

/** Args after `node run.mjs` — drop `--` so `pnpm run … -- dev` works. */
const raw = process.argv.slice(2).filter((a) => a !== "--");
const flags = new Set(raw.filter((a) => a.startsWith("-")));
const positional = raw.filter((a) => !a.startsWith("-"));
const convexOnly =
  flags.has("--convex-only") || positional.includes("convex");
const positionalNoConvex = positional.filter((a) => a !== "convex");
const [cmd, target] = positionalNoConvex;
const snapshotOnly = flags.has("--snapshot-only");
const pullAll = flags.has("--all");
const pushAll = cmd === "push" && flags.has("--all");
const pushYes = cmd === "push" && (flags.has("--yes") || flags.has("-y"));
const pushFromSync = cmd === "push" && flags.has("--from-sync");
const pushFromWorking = cmd === "push" && flags.has("--from-working");
const pushForce = cmd === "push" && flags.has("--force");
const pushInteractive =
  cmd === "push" && (flags.has("--interactive") || flags.has("-i"));

if (
  !cmd ||
  (cmd === "push" && !pushAll && !pushInteractive && (!target || !VALID.has(target)))
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

if (cmd === "check" && (!target || !VALID.has(target))) {
  usage();
  process.exitCode = 1;
  process.exit();
}

if (cmd === "sync" && (!target || !VALID.has(target))) {
  usage();
  process.exitCode = 1;
  process.exit();
}

try {
  if (cmd === "clear") {
    await interactiveClear({ dryRun: flags.has("--dry-run") });
  } else if (cmd === "pull") {
    if (pullAll) {
      if (target && VALID.has(target)) {
        syncWarn(
          "Ignoring preset target with --all; use one or the other."
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
    if (pushInteractive) {
      await interactivePushCli();
    } else {
      /** Push always reads `.env.sync.*` by default — pass `--from-working` to read working files. */
      const fromSyncForPush = !pushFromWorking;
      if (pushFromSync && pushFromWorking) {
        syncWarn(
          "Both --from-sync and --from-working passed; --from-working wins."
        );
      }
      const pushOpts = {
        yes: pushYes,
        fromSync: fromSyncForPush,
        convexOnly,
        force: pushForce,
      };
      if (pushAll) {
        for (const t of /** @type {const} */ (["dev", "preview", "prod"])) {
          console.log("");
          syncInfo(`========== push ${t} ==========`);
          console.log("");
          await pushTarget(t, pushOpts);
        }
      } else {
        await pushTarget(
          /** @type {"dev" | "preview" | "prod"} */ (target),
          pushOpts
        );
      }
    }
  } else if (cmd === "check") {
    await checkTarget(/** @type {"dev" | "preview" | "prod"} */ (target), {
      fromSync: !flags.has("--from-working"),
      quiet: flags.has("--quiet") || flags.has("-q"),
      convexOnly: flags.has("--convex-only") || positional.includes("convex"),
      vercelOnly: flags.has("--vercel-only"),
    });
  } else if (cmd === "sync") {
    await syncMergeTarget(/** @type {"dev" | "preview" | "prod"} */ (target), {
      yes: flags.has("--yes") || flags.has("-y"),
      skipPush: flags.has("--skip-push"),
    });
  } else if (cmd === "deploy") {
    await deployTarget(parseDeployArgs(raw.slice(1)));
  } else {
    usage();
    process.exit(1);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
