# vercel-convex-env-sync

**Public repo:** [github.com/J-Giggles/vercel-convex-env-sync](https://github.com/J-Giggles/vercel-convex-env-sync)

Small **Node.js** (ESM) helpers to **pull** and **push** environment variables between your machine, [**Convex**](https://convex.dev) (`convex env`), and [**Vercel**](https://vercel.com) (`vercel env`). Includes **drift warnings** before overwriting hosted env.

- **Requirements:** Node.js 18+, [`pnpm`](https://pnpm.io) (or adapt commands to `npm`/`yarn`), the [Convex CLI](https://docs.convex.dev/cli) (`convex` via your project), and the [Vercel CLI](https://vercel.com/docs/cli) (`vercel` on your `PATH`, or it will try `pnpm dlx vercel`).
- **No extra npm dependencies** — uses only Node built-ins.

**Publishing this folder to a public repo:** see **[SECURITY.md](./SECURITY.md)** (verify no `.env*` / `.env.sync.*` in commits; subtree push notes).

---

## Which hosted env each target uses

| Target | Vercel (`vercel env pull`) | Convex (`convex env …`) |
|--------|---------------------------|---------------------------|
| `dev` | **development** | **Dev** deployment (no `--prod` on `env list` / `env set`) |
| `preview` | **preview** | **Dev** deployment via CLI\* |
| `prod` | **production** | **Production** (`--prod`) |

\*Preview PR backends may also use Convex dashboard defaults; see [Convex preview deployments](https://docs.convex.dev/production/hosting/preview-deployments).

Your **`.env.local`** should still point **`NEXT_PUBLIC_CONVEX_URL`** (and optionally **`CONVEX_DEPLOY_KEY`**) at the **dev** deployment for local coding; **`pull -- prod`** writes **`.env.production.local`** for prod-shaped local runs, not `.env.local`. If **`pull dev`** mirrors prod, check that **Vercel → Development** env vars are what you expect (they may be copies of Production).

---

## What gets synced

| Target | Vercel environment | Convex deployment (`convex env …`) | Default push source (snapshot) | Working file fallback (`--from-working`) |
|--------|----------------------|-------------------------------------|-------------------------------|------------------------------------------|
| `dev` | `development` | Dev (default) | `.env.sync.development` | `.env.local`, then `.env.development.local` |
| `preview` | `preview` | Dev CLI deployment* | `.env.sync.preview` | `.env.preview`, then `.env.local` |
| `prod` | `production` | `--prod` | `.env.sync.production` | `.env.production.local`, then `.env.local` |

\*The Convex CLI only targets **dev** or **prod** deployments. The `preview` target still updates the **dev** deployment’s env via the CLI; [preview deployments](https://docs.convex.dev/production/hosting/preview-deployments) may also use [project env defaults](https://docs.convex.dev/production/environment-variables#project-environment-variable-defaults) in the Convex dashboard.

**Key routing** (edit `lib/split.mjs` in your copy if needed): Convex does not receive `NEXT_PUBLIC_*` / `VERCEL_*` / certain CI keys (`CONVEX_DEPLOY_KEY`, legacy `CONVEX_DEPLOYMENT`, …).

---

## Install in your project

Put this package **under your app’s repo** at **`scripts/vercel-convex-env-sync/`** (three segments: `scripts` → `vercel-convex-env-sync` → files). The tool resolves the **app root** as three levels above `lib/paths.mjs`; installing elsewhere breaks sync paths.

```text
your-app/
  scripts/
    vercel-convex-env-sync/
      run.mjs
      lib/
      README.md
```

### Option A — Clone and copy (simplest)

```bash
cd /path/to/your-app
git clone https://github.com/J-Giggles/vercel-convex-env-sync.git /tmp/vercel-convex-env-sync
mkdir -p scripts
rm -rf scripts/vercel-convex-env-sync
mkdir -p scripts/vercel-convex-env-sync
cp -R /tmp/vercel-convex-env-sync/{run.mjs,lib,README.md} scripts/vercel-convex-env-sync/
rm -rf /tmp/vercel-convex-env-sync
```

### Option B — Git subtree (track upstream updates)

From your app repo root:

```bash
git remote add vercel-convex-env-sync https://github.com/J-Giggles/vercel-convex-env-sync.git
git fetch vercel-convex-env-sync
git subtree add --prefix=scripts/vercel-convex-env-sync vercel-convex-env-sync master --squash
```

This upstream repo uses the **`master`** branch. To pull updates later:

```bash
git subtree pull --prefix=scripts/vercel-convex-env-sync vercel-convex-env-sync master --squash
```

### Option C — Submodule

The repository root is `run.mjs` + `lib/` — add it as **`scripts/vercel-convex-env-sync/`** so paths match:

```bash
git submodule add https://github.com/J-Giggles/vercel-convex-env-sync.git scripts/vercel-convex-env-sync
```

---

## Add scripts to `package.json`

In the **root** `package.json` of your app:

```json
{
  "scripts": {
    "env:sync": "node scripts/vercel-convex-env-sync/run.mjs sync",
    "env:sync:pull": "node scripts/vercel-convex-env-sync/run.mjs pull",
    "env:sync:push": "node scripts/vercel-convex-env-sync/run.mjs push",
    "env:sync:push:cli": "node scripts/vercel-convex-env-sync/run.mjs push --interactive",
    "env:sync:check": "node scripts/vercel-convex-env-sync/run.mjs check",
    "env:sync:clear": "node scripts/vercel-convex-env-sync/run.mjs clear",
    "deploy": "node scripts/vercel-convex-env-sync/run.mjs deploy",
    "deploy:staging": "pnpm deploy -- staging",
    "deploy:production": "pnpm deploy -- production",
    "deploy:staging:git": "pnpm deploy -- staging --git-push",
    "deploy:production:git": "pnpm deploy -- production --git-push"
  }
}
```

Usage:

```bash
# Interactive: lists Vercel deployment targets from `vercel env list`, pulls each scope,
# infers Convex dev vs prod from slugs; if every target shares the same Convex slug but your
# local `convex env list` / `--prod` slugs differ (e.g. another project), defaults to Convex production.
pnpm run env:sync:pull
# Interactive menu: **0** = same as `pull -- --all` (writes `.env.sync.*`); **1–3** = one Vercel scope.

# Merged Convex + Vercel per target, example layout → `.env.sync.development`, `.env.sync.preview`, …
pnpm run env:sync:pull -- --all

pnpm run env:sync:pull -- dev
pnpm run env:sync:pull -- preview
pnpm run env:sync:pull -- prod

pnpm run env:sync:push -- dev
pnpm run env:sync:push -- preview
pnpm run env:sync:push -- prod

# Guided interactive push (targets, snapshot vs working files, --yes, Vercel sensitive on/off):
pnpm run env:sync:push:cli
# Same as: pnpm run env:sync:push -- --interactive

Preview **defaults to git branch `staging`** (`lib/env-sync-defaults.mjs`: **`VERCEL_SYNC_PREVIEW_DEFAULT_BRANCH`**, **`VERCEL_SYNC_PREVIEW_UNSCOPED=false`**). Set **`ENV_SYNC_VERCEL_PREVIEW_BRANCH=<name>`** to use another branch (e.g. `armands-staging`). Set **`ENV_SYNC_VERCEL_PREVIEW_NO_BRANCH=1`** for unscoped Preview (all preview deployments; no `--git-branch` on pull). If unscoped Preview push hits **`git_branch_required`**, the tool uses the **REST API** fallback (see Troubleshooting).

# Push all three Vercel scopes + Convex using the merged snapshot files (recommended after pull --all):
pnpm run env:sync:push -- --all --yes

# Read working .env*.local / .env.preview files instead of .env.sync.* (legacy behavior):
pnpm run env:sync:push -- preview --from-working
pnpm run env:sync:push -- --all --from-working --yes

# Read-only diff: compare local file vs hosted Convex + Vercel for one target.
# Exits 0 when both platforms match, 1 otherwise. Also flags keys observed
# anywhere (local / Convex / Vercel) that are not validated by env.ts.
pnpm run env:sync:check -- preview
pnpm run env:sync:check -- prod --convex-only
pnpm run env:sync:check -- preview --vercel-only
pnpm run env:sync:check -- preview -q     # prints `true` or `false` only

# Three-way merge: fill empty/missing values from whichever side has a value,
# write the merged map back to .env.sync.<env>, then push to both remotes.
# Distinct non-empty values are flagged as conflicts (skipped, not auto-resolved).
pnpm run env:sync -- preview
pnpm run env:sync -- preview --yes        # skip confirmation
pnpm run env:sync -- preview --skip-push  # write local only; do not push

# Remove hosted variables from chosen Vercel scopes and/or Convex dev or prod (interactive; local files untouched):
pnpm run env:sync:clear
pnpm run env:sync:clear -- --dry-run
```

### Deploy command

This repo also exposes a deploy orchestrator through the same entrypoint:

```bash
pnpm deploy:staging
pnpm deploy:production
pnpm deploy:staging:git
pnpm deploy:production:git
```

The direct commands run gates (`lint`, `typecheck`, `build`), push the matching `.env.sync.*` snapshot to Convex and Vercel, run `convex deploy`, then call Vercel CLI directly. The `:git` commands use the same gates/env/Convex deploy, then push the mapped branch so Vercel Git integration performs the frontend deploy:

| Deploy target | Env sync target | Vercel environment | Branch |
|---------------|-----------------|--------------------|--------|
| `staging` | `preview` | Preview | `staging` |
| `production` | `prod` | Production | `production` |

By default deploy reads `.env.sync.preview` / `.env.sync.production`; run `pnpm env:sync:pull -- --all` before first use or after hosted env changes. Pass `--from-working` only when you intentionally want to deploy from working `.env*` files.

**Defaults:** `lib/env-sync-defaults.mjs` sets **`VERCEL_SYNC_USE_SENSITIVE = false`** so `vercel env add` does not receive `--sensitive` unless you set **`ENV_SYNC_VERCEL_USE_SENSITIVE=1`** or use **`env:sync:push:cli`** to force ON; **Preview** defaults to branch **`VERCEL_SYNC_PREVIEW_DEFAULT_BRANCH`** (`staging`) with **`VERCEL_SYNC_PREVIEW_UNSCOPED = false`** (override in that file or with env vars — see Preview paragraph above). Vercel [Sensitive](https://vercel.com/docs/environment-variables/sensitive-environment-variables) variables cannot be read back on `vercel env pull`.

CLI output uses ANSI colors for the `[env:sync]` prefix (no extra npm dependencies).

**Where pull writes:** (1) full merged snapshot → **`.env.sync.merge.<target>`** (sorted keys, for diffing); (2) the same merge (minus ephemeral `VERCEL_OIDC_TOKEN`) → **working file** with optional **example layout**: if **`.env.example`** or a target-specific `*.example` exists (see below), comments and key order follow that file; any extra keys from Convex/Vercel are appended at the **bottom** after a short header. Otherwise keys are written sorted. **`--all`** also writes **`.env.sync.development`**, **`.env.sync.preview`**, **`.env.sync.production`** (merged + formatted). **Ephemeral** (not for editing): **`vercel env pull`** writes **`.env/sync/cache.vercel.<env>.env`** and deletes it after parsing; **`env:sync:push`** writes **`.env/sync/push.convex.<target>.env`** for `convex env set --from-file` and removes it after the command. Older tool versions left **`.env.sync.cache.*`** / **`.env.sync.push.*`** at the repo root — safe to delete those files.

| Target | Example template (first file that exists) |
|--------|---------------------------------------------|
| `dev` | `.env.development.example`, then `.env.example` |
| `preview` | `.env.preview.example`, then `.env.example` |
| `prod` | `.env.production.example`, then `.env.example` |

**Working file paths:** **dev** → `.env.local` / `.env.development.local`; **preview** → `.env.preview` only; **prod** → `.env.production.local` only. Backups under **`.env/sync/pull-backups/`**. **`--snapshot-only`** skips working files. **`env:sync:push`** uses **What gets synced** paths.

### Troubleshooting

| Symptom | What to do |
|--------|------------|
| `git_branch_required` / `action_required` on **Preview** push (`NEXT_PUBLIC_*`, `NODE_ENV`, etc.) | Most common when Preview is **unscoped** (`ENV_SYNC_VERCEL_PREVIEW_NO_BRANCH=1`). Default repo config uses branch **`staging`**, which usually avoids this. If you still see it, the tool retries via **REST API** ( **`VERCEL_TOKEN`** or **`vercel login`** token file). Or set **`ENV_SYNC_VERCEL_PREVIEW_BRANCH`**. Optional: **`ENV_SYNC_VERCEL_TEAM_ID`**. |
| `vercel env pull` / `not_linked` | From the **app repo root**, run **`vercel link`** once (or `vercel link --yes --scope <team> --project <name>` for non-interactive). Pull/push need a linked Vercel project. |
| Convex CLI cannot target a deployment | Ensure **`.env.local`** has **`NEXT_PUBLIC_CONVEX_URL`** and/or **`CONVEX_DEPLOY_KEY`** (or run **`pnpm exec convex dev`** once). |
| `InvalidDeploymentName` / long instance name | **`CONVEX_DEPLOY_KEY`** / legacy vars are sometimes `deploymentSlug|opaqueToken` (too long for the API). The tool passes only the **prefix before `|`** to the Convex CLI and normalizes pulls into `.env.local` / `.env.production.local`. |

---

## `.gitignore`

Ignore the sync cache (metadata, pull backups) and root sync artifacts (secrets):

```gitignore
# vercel-convex-env-sync
.env/sync/
.env.sync.*
```

If you already ignore `.env*`, the `.env/sync/` directory is usually already ignored; the line above documents intent.

---

## `CONVEX_DEPLOY_KEY` before first Vercel / Convex hosting

`CONVEX_DEPLOY_KEY` is **not** for your Convex **runtime** functions — it lets **CI / Vercel** run `convex deploy` non-interactively. You create deploy keys in the [Convex Dashboard](https://dashboard.convex.dev/) → your project → **Settings** (see [Convex + Vercel](https://docs.convex.dev/production/hosting/vercel)).

| Vercel “Environment” in project settings | Which Convex deploy key to use |
|-------------------------------------------|----------------------------------|
| **Production** | **Production** deploy key |
| **Preview** | **Preview** deploy key |
| **Development** | Optional; often the **Preview** or **Development** workflow key, depending on how you use `vercel dev` |

**Critical:** Use the **Preview** key only for **Preview**, and the **Production** key only for **Production**. Putting the production key on Preview can deploy backend code to the wrong deployment.

### Set in Vercel (dashboard or CLI)

**Dashboard:** Project → **Settings** → **Environment Variables** → add `CONVEX_DEPLOY_KEY` separately for Production, Preview, and Development as needed.

**CLI (you paste the secret when prompted — do not commit it):**

```bash
vercel env add CONVEX_DEPLOY_KEY production
vercel env add CONVEX_DEPLOY_KEY preview
vercel env add CONVEX_DEPLOY_KEY development
```

This repo’s **`vercel.json`** build command adds `--check-build-environment disable` so **Preview** Vercel builds can run `convex deploy` with a **production** deploy key (e.g. `staging` branch). If you use **Preview** Convex deploy keys for PR previews, you can omit that flag. Base pattern from [Convex + Vercel](https://docs.convex.dev/production/hosting/vercel):

```bash
npx convex deploy --cmd 'npm run build'
```

Add `--cmd-url-env-var-name …` only if the CLI cannot infer your framework’s public Convex URL.

---

## First-time checklist (new project)

1. Create/link Convex project (`pnpm exec convex dev` or dashboard).
2. Link Vercel: `vercel link` from the app root.
3. Add **`CONVEX_DEPLOY_KEY`** per Vercel environment (table above).
4. Add other secrets (WorkOS, Stripe, etc.) in **Vercel** and **Convex** as your app requires.
5. Run **`pnpm run env:sync:pull -- <target>`** once to populate `.env.sync.merge.<target>` and metadata (optional but recommended before first push).
6. Deploy.

---

## Adding to an **existing** project

1. **Install files** using Option A, B, or C above; keep paths as `scripts/vercel-convex-env-sync/…` so the `package.json` snippets match.
2. **Merge `package.json` scripts** — avoid duplicate keys; if you already have `env:sync:*`, rename or merge.
3. **`.gitignore`** — add `.env/sync/` if not already covered.
4. **Convex / Vercel already configured:** run **`env:sync:pull`** for each target you use (`dev`, `preview`, `prod`) **before** the first **`env:sync:push`**, so local metadata matches hosted env and you get fewer drift warnings.
5. **Customize** `lib/split.mjs` if your app puts different keys on Convex vs Vercel (e.g. more `NEXT_PUBLIC_*` rules).
6. **CI:** do not print env values in logs; keep `CONVEX_DEPLOY_KEY` only in the CI secret store / Vercel.

---

## Drift warnings (`env:sync:push`)

Before pushing, the tool compares **current** hosted Convex + Vercel env to the hashes stored at the last successful **pull** (or last post-push refresh). If they differ, you get a **warning** and can continue or cancel. You should run **`env:sync:pull`** when teammates change hosted env, then merge edits locally before pushing.

---

## Publishing your own fork (optional)

The canonical repo is **[github.com/J-Giggles/vercel-convex-env-sync](https://github.com/J-Giggles/vercel-convex-env-sync)** (contents at **repo root**: `run.mjs`, `lib/`, `README.md`). To publish a **fork** or mirror under another account with [`gh`](https://cli.github.com/):

```bash
mkdir my-env-sync && cd my-env-sync
# Copy run.mjs, lib/, README.md from upstream or your monorepo
git init && git add . && git commit -m "feat: vercel-convex-env-sync"
gh repo create YOUR_NAME/vercel-convex-env-sync --public --source=. --remote=origin --push
```

---

## References

- [Convex: environment variables](https://docs.convex.dev/production/environment-variables)
- [Convex: Vercel hosting & preview](https://docs.convex.dev/production/hosting/vercel)
- [Vercel: environment variables](https://vercel.com/docs/projects/environment-variables)
- [Vercel CLI: `vercel env`](https://vercel.com/docs/cli/env)

---

## License

Add a `LICENSE` file (e.g. MIT) when you vendor or fork; upstream may ship one separately.
