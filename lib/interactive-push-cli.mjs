/**
 * Guided interactive `env:sync:push` — targets, sources, confirmations, Vercel sensitive override.
 */
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { pushTarget } from "./push.mjs";
import { syncInfo, syncWarn } from "./cli-style.mjs";

/** @typedef {"dev" | "preview" | "prod"} TTarget */

/**
 * @returns {Promise<void>}
 */
export async function interactivePushCli() {
  const rl = readline.createInterface({ input, output });
  try {
    syncInfo("Interactive push — choose targets and options.");
    syncInfo(
      "All targets read `.env.sync.*` snapshots by default (same as `pnpm run env:sync:push`). You can opt into working files."
    );

    const targets = await askTargets(rl);
    if (targets.length === 0) {
      syncWarn("No targets selected. Exiting.");
      return;
    }

    /** Default: read `.env.sync.<env>` for every selected target. Opt out per session below. */
    const useWorking = await askYesNo(
      rl,
      "Read working files instead of `.env.sync.*` (`--from-working`)?"
    );
    const fromSync = !useWorking;
    if (!fromSync) {
      syncInfo(
        "Reading working files (.env.local / .env.preview / .env.production.local) for each target."
      );
    }

    const vercelSensitive = await askSensitiveMode(rl);

    const yes = await askYesNo(
      rl,
      "Skip drift / local-change confirmations (`--yes`)?"
    );

    syncInfo(
      `Summary: targets=${targets.join(",")} · fromSync=${fromSync} · vercelSensitive=${vercelSensitive} · skipConfirm=${yes}`
    );
    const go = await askYesNo(rl, "Proceed with push?");
    if (!go) {
      syncInfo("Cancelled.");
      return;
    }

    /** @type {{ yes: boolean; fromSync: boolean; vercelSensitive: "default" | "on" | "off" }} */
    const pushOpts = {
      yes,
      fromSync,
      vercelSensitive,
    };

    for (const t of targets) {
      console.log("");
      syncInfo(`========== push ${t} ==========`);
      await pushTarget(/** @type {TTarget} */ (t), pushOpts);
    }
  } finally {
    rl.close();
  }
}

/**
 * @param {import("node:readline/promises").Interface} rl
 * @returns {Promise<TTarget[]>}
 */
async function askTargets(rl) {
  console.log(`
  1) All three (dev → preview → prod)
  2) dev only
  3) preview only
  4) prod only
  5) Multiple (you will enter dev / preview / prod)
`);
  for (;;) {
    const raw = (await rl.question("Choose 1–5: ")).trim();
    if (raw === "1") return ["dev", "preview", "prod"];
    if (raw === "2") return ["dev"];
    if (raw === "3") return ["preview"];
    if (raw === "4") return ["prod"];
    if (raw === "5") {
      const sub = (
        await rl.question("Enter targets (comma-separated: dev, preview, prod): ")
      )
        .trim()
        .toLowerCase();
      const parts = sub.split(/[\s,]+/).filter(Boolean);
      /** @type {TTarget[]} */
      const acc = [];
      for (const p of parts) {
        if (p === "dev" || p === "development") acc.push("dev");
        else if (p === "preview" || p === "staging") acc.push("preview");
        else if (p === "prod" || p === "production") acc.push("prod");
      }
      const uniq = /** @type {TTarget[]} */ ([...new Set(acc)]);
      if (uniq.length === 0) {
        console.log("No valid targets. Use dev, preview, prod.");
        continue;
      }
      return uniq;
    }
    console.log("Invalid choice.");
  }
}

/**
 * @param {import("node:readline/promises").Interface} rl
 * @param {string} q
 */
async function askYesNo(rl, q) {
  for (;;) {
    const a = (await rl.question(`${q} [y/N] `)).trim().toLowerCase();
    if (a === "y" || a === "yes") return true;
    if (a === "" || a === "n" || a === "no") return false;
    console.log('Type "y" or "n".');
  }
}

/**
 * @param {import("node:readline/promises").Interface} rl
 * @returns {Promise<"default" | "on" | "off">}
 */
async function askSensitiveMode(rl) {
  console.log(`
Vercel \`--sensitive\` for matching key names (SECRET, TOKEN, KEY, …):
  1) Project/env default (ENV_SYNC_VERCEL_USE_SENSITIVE or built-in default)
  2) Force ON (non-readable on Vercel after push)
  3) Force OFF (never pass --sensitive)
`);
  for (;;) {
    const raw = (await rl.question("Choose 1–3: ")).trim();
    if (raw === "1") return "default";
    if (raw === "2") return "on";
    if (raw === "3") return "off";
    console.log("Invalid choice.");
  }
}
