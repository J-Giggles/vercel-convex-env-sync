# vercel-convex-env-sync

**Public repo:** [github.com/J-Giggles/vercel-convex-env-sync](https://github.com/J-Giggles/vercel-convex-env-sync)

Small **Node.js** (ESM) helpers to **pull** and **push** environment variables between your machine, [**Convex**](https://convex.dev) (`convex env`), and [**Vercel**](https://vercel.com) (`vercel env`). Includes **drift warnings** before overwriting hosted env.

- **Requirements:** Node.js 18+, [`pnpm`](https://pnpm.io) (or adapt commands to `npm`/`yarn`), the [Convex CLI](https://docs.convex.dev/cli) (`convex` via your project), and the [Vercel CLI](https://vercel.com/docs/cli) (`vercel` on your `PATH`, or it will try `pnpm dlx vercel`).
- **No extra npm dependencies** — uses only Node built-ins.

---

## What gets synced

| Target | Vercel environment | Convex deployment (`convex env …`) | Typical local file used on **push** |
|--------|----------------------|-------------------------------------|-------------------------------------|
| `dev` | `development` | Dev (default) | `.env.local`, then `.env.development.local` |
| `preview` | `preview` | Dev CLI deployment* | `.env.preview`, then `.env.local` |
| `prod` | `production` | `--prod` | `.env.production.local`, then `.env.local` |

\*The Convex CLI only targets **dev** or **prod** deployments. The `preview` target still updates the **dev** deployment’s env via the CLI; [preview deployments](https://docs.convex.dev/production/hosting/preview-deployments) may also use [project env defaults](https://docs.convex.dev/production/environment-variables#project-environment-variable-defaults) in the Convex dashboard.

**Key routing** (edit `lib/split.mjs` in your copy if needed): Convex does not receive `NEXT_PUBLIC_*` / `VERCEL_*` / certain CI keys; `CONVEX_DEPLOYMENT` is omitted from the Vercel push.

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
    "env:sync:pull": "node scripts/vercel-convex-env-sync/run.mjs pull",
    "env:sync:push": "node scripts/vercel-convex-env-sync/run.mjs push"
  }
}
```

Usage:

```bash
pnpm run env:sync:pull -- dev
pnpm run env:sync:pull -- preview
pnpm run env:sync:pull -- prod

pnpm run env:sync:push -- dev
pnpm run env:sync:push -- preview
pnpm run env:sync:push -- prod
```

---

## `.gitignore`

Ignore the sync cache (contains merged env and metadata):

```gitignore
# vercel-convex-env-sync
.env/sync/
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

Your **build command** should match Convex’s recommended pattern, e.g.:

```bash
pnpm exec convex deploy --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --cmd 'pnpm run build'
```

(Adjust package manager and app build script names.)

---

## First-time checklist (new project)

1. Create/link Convex project (`pnpm exec convex dev` or dashboard).
2. Link Vercel: `vercel link` from the app root.
3. Add **`CONVEX_DEPLOY_KEY`** per Vercel environment (table above).
4. Add other secrets (WorkOS, Stripe, etc.) in **Vercel** and **Convex** as your app requires.
5. Run **`pnpm run env:sync:pull -- <target>`** once to populate `.env/sync/merged.<target>.env` and metadata (optional but recommended before first push).
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
