# Publishing the site preview on GitHub Pages

This is the "show it to Regomoditswe" deployment: the real storefront — menu, plate
builder, prices, service rules, loyalty card copy, policies, customer quest — served
as a public static site, with everything that needs a server switched off and said so
plainly on every page.

It is **not** the live shop. Orders, card payments, loyalty lookups, the contact form
and quests need the Express API, and GitHub Pages cannot run Node.

---

## How the published site is produced

GitHub Pages serves **files from a branch**, and this account cannot run GitHub
Actions yet (the billing/spending limit blocks every job). So the preview is built
locally and committed:

```
main → /web    ← the built site
main → /       ← the repository root, which is what Pages is currently publishing
```

The repository root *is* the Vite source: its `index.html` points at
`/src/main.tsx`, a file only the dev server can serve. Publishing it directly is
what produced the blank page — the browser fetched TypeScript, got a 404, and React
never mounted.

Two things now make that harmless, whichever folder Pages is pointed at:

- the source `index.html` detects it is being served unbundled (its script tag still
  ends in `.tsx`, and no `/@vite/client` is present) and immediately hands over to
  `./web/`;
- `404.html` at the repository root catches deep links and sends them to the built
  home instead of GitHub's generic error page.

The build uses a **relative base** (`./`), so the same committed folder works at
`/heritagebites/web/` *and* at `/heritagebites/` (when Pages is pointed at `/web`).
The app works out its mount point at runtime from the bundle's own resolved URL.

`npm run build:pages` produces `web/`:

1. builds the React app with `VITE_STATIC_PREVIEW=1` and the `/heritagebites/` base;
2. asks the real Express API for one catalogue snapshot and writes
   `web/api/catalog.json` — so the preview cannot drift from the owner-approved
   menu, prices, policies and hours;
3. copies the shell to `web/404.html`, which is what makes `/menu`, `/quest` and
   other deep links work on Pages;
4. writes `.nojekyll` in `web/` **and at the repository root** — without the root
   one, Pages runs the branch through Jekyll.

### Rebuilding after a change

```bash
npm run build:pages                              # refresh web/ (relative base)
npm run preview:pages                            # check it on http://localhost:5055/heritagebites/
npm run test:pages                               # 8 checks: base path, images, preview guards
git add web && git commit -m "Refresh the Pages preview" && git push
```

**The published site is the committed `web/` folder.** If you edit content and push
without rebuilding, the live preview keeps showing the old build.

## One-time repository setup

1. **Repository is public** — Pages is not available for private repositories on the
   free plan.
2. **Settings → Pages → Build and deployment**
   - Source: **Deploy from a branch**
   - Branch: **main**
   - Folder: **/web**  ← recommended. `/ (root)` also works now (the source shell
     redirects to `./web/`), but the URL then carries the extra `/web/` segment and
     a refresh on a deep link lands on the home page instead of the route.
3. Save. The site appears at:

```
https://lulamilemkhungela.github.io/heritagebites/
```

A run of *"pages build and deployment"* appears in Actions; that is GitHub's own
publisher, not a workflow of ours, and it is the only Actions job this account can
run today.

## What the preview does and does not do

| On the Pages preview | Behaviour |
| --- | --- |
| Home, Meals, This Week, About, Policies, Customer quest | Full site, real content, real photos |
| Menu, plate builder, basket, prices | Work — the catalogue is a read-only snapshot of the owner-approved seed |
| Category chips, including the coming-soon archive | Navigate and scroll; archive cards stay inert (no price, no dish sheet, no basket) |
| Service strip ("Wednesday is a rest day…") | Live — the browser recomputes it from the shared service rules, so it never goes stale |
| Checkout | Shows **Preview checkout**: your basket and the published plate prices, with a WhatsApp button instead of payment |
| Contact form, Customer quest form | Submitting says the preview has ordering and messages switched off, and points to phone/WhatsApp — nothing is stored or sent |
| Loyalty card lookup | Replaced by a note: stamps need the live site; WhatsApp us to check |
| Search | Works — falls back to searching the loaded catalogue |
| Site-wide strip | "Preview — ordering and payments are switched off on this preview." |

Nothing is charged, no order is created, no enquiry is lost, and no customer data is
ever placed in this build.

## Notes and gotchas

- The base is relative on purpose (`VITE_BASE=./`), so no path has to be baked in.
  Override it (`VITE_BASE=/heritagebites/`) only if you want absolute asset URLs.
- Deep links are answered through `404.html`, so Pages returns a **404 status** for
  them even though the page renders. Normal for a static SPA; the real host returns
  correct 200s.
- `data/runtime/` is never included. The snapshot is generated from a throwaway data
  directory.
- The repository's root `index.html` is the Vite source entry (`/src/main.tsx`). It
  cannot be served by Pages — a browser cannot run TypeScript — which is exactly why
  the published folder is `/web` and not the repository root.

## Moving to the real site later

When the real host is ready (Node 20+ with a persistent disk — see
`docs/what-is-needed.md`):

- deploy the normal Express app (`npm run build` + `npm start`), which serves the
  site **and** the API from one origin, and nothing needs changing;
- or split them: host the ordinary static build anywhere and set `VITE_API_BASE` to
  the API origin at build time.

Then point Pages at nothing, or leave it as a preview, and take the client to the
real host.

## If Actions is fixed later

A workflow that builds and deploys `web/` was removed while billing blocks Actions
(it failed on every push). To restore it: copy the job from git history
(`git show 512a66d:.github/workflows/pages.yml`), set
**Settings → Pages → Source: GitHub Actions**, and let it publish the same folder.
