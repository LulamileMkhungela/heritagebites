# Heritage Bites

React/Vite storefront and Express ordering API. The production server serves both `dist/` and `/api` from one origin. The menus, prices and customer policies live in `server/seed.js`; GitHub Pages serves a separate static preview from `web/`.

## Build and run

Use Node.js 22.22.3 (tested) or a compatible release with npm.

```sh
npm ci --include=dev
npm run build
npm start
```

Open `http://localhost:4000` and check `/api/health`. Use `npm run dev` for the Vite dev server and API together. See [`.env.example`](.env.example) for local configuration. Never commit `.env`, credentials, order data or backups.

## Deploy on SPanel

1. Use a separate HTTPS subdomain such as `order.heritagebites.co.za`. Keep WordPress and email unchanged. Clone `main` into a private folder **outside** the web document roots, or keep the existing clone.
2. Set `HB_PUBLIC_URL` and `HB_SITE_URL` to that HTTPS origin. Set `HB_DATA_DIR` to an absolute, private, writable directory outside the clone so it survives updates. Use one app instance for the JSON store. Keep these settings in a restricted `.env` in the app folder or in the host's private settings. If the app already holds orders, back up and migrate them before changing the data directory.
3. Choose **Git Version Control → Actions → Pull & Deploy** on the existing clone, or wait for its scheduled pull. The production `dist/` is checked in so SPanel can deploy it without running Vite. Confirm `dist/index.html` and `dist/assets/` exist in the app folder. `.autodeploy` checks the committed bundle and reports `[SPanel] Frontend ready: dist/index.html (prebuilt)` in its output. It does not restart the app. If a previous manual `dist/` upload blocks Git from pulling, move only that folder outside the clone and retry.
4. In **NodeJS Manager → Custom**, use the existing clone folder containing `package.json`; the start command is `npm start`. Use a compatible Node version. Check the app's assigned internal port in NodeJS Manager. If the panel does not pass that number as `PORT`, set `PORT` to the same number in the app's private `.env`. `4000` is only the local default. Keep the port behind the HTTPS proxy. Set `HB_TRUST_PROXY=1` only if the app sits behind a single trusted proxy and the Node port is not directly reachable.
5. Once the bundle is present, use **NodeJS Manager → Restart**; no need to clone or redeploy the app. Open `/api/health` on the HTTPS subdomain, then the home page. If both show SPanel's **The application failed to start**, compare the port in the latest *Output* log with the port in NodeJS Manager and check the *Error* log. If health shows `ok: true` but the home page says **Frontend not built yet**, confirm the app is starting from the clone that contains `dist/`.

On revisions that do not include `dist/`, `.autodeploy` still tries to build from source. That path needs Node.js and npm in the Git deploy environment and uses `HB_SITE_URL` (or `HB_PUBLIC_URL`) from the environment or `.env`, defaulting to `https://order.heritagebites.co.za`. Keep production and preview builds separate. Test on a controlled staging deployment; disabling card payments alone does not disable orders. `render.yaml` remains the blueprint for the separate Render preview.

### Refresh the SPanel bundle

When a change affects the production frontend, rebuild and commit `dist/` with that change so SPanel doesn't serve an old bundle. Build off the host with a compatible Node version; running `npm run build` on the SPanel checkout rewrites tracked files and can block later pulls.

```sh
npm ci --include=dev
site=https://order.heritagebites.co.za
NODE_ENV=production HB_SITE_URL="$site" VITE_SITE_URL="$site" \
  VITE_BASE=/ VITE_API_BASE='' VITE_STATIC_PREVIEW=0 npm run build
git add -A -f -- dist/
```

Verify the generated `dist/index.html` and assets with `npm start` before committing. The force-add is intentional: `dist/` stays ignored for local builds and Tailwind source scanning. Commit the bundle files, not the ZIP, `node_modules/`, or `.env`.

## Before taking orders

- **Storage:** Check that a test order survives a restart. Schedule private off-server backups and test restoring one. Run `HB_DATA_DIR=/path/to/private-data npm run backup` with the actual data directory.
- **Kitchen:** Generate a push key pair with `npm run push:keys`, store the values privately, then enrol the kitchen device at `/alerts`. On iPhone, first add the site to the Home Screen (iOS 16.4+). Confirm the alert on a test order, and use `HB_BASE=https://your-app-host npm run notify:check` to monitor the channel. Confirm who watches for and handles orders; there is no staff order console.
- **Enquiries:** Confirm the Formspree destination and send a test enquiry to verify it arrives in the intended inbox.
- **Cards (Yoco):** Verify the actual checkout hostname with Yoco. Test using the account's test secret in `HB_YOCO_SECRET_KEY` and the matching signing secret in `HB_YOCO_WEBHOOK_SECRET`. Point the test webhook at `/api/payments/yoco/webhook` on the HTTPS app; the proxy must not rewrite the request body. Run `npm run check:payments` with the host settings loaded, verify `/api/payments/config`, and confirm a test payment is marked paid by the signed webhook. Use live secrets only after verification and a successful test. Never share keys in Git, chat or screenshots. No browser key is needed.

## GitHub Pages preview

The Pages deployment uses `main` at the repository root, which redirects to `web/`. Keep `web/`, the root `index.html`, `404.html` and `.nojekyll`. The preview uses a catalogue snapshot and a WhatsApp checkout handoff; it does not take live orders or card payments.

```sh
npm run build:pages
npm run preview:pages      # separate terminal
npm run test:pages
```

Build the preview separately from production so the static-preview settings and canonical URLs stay correct.

## Checks

Run `npm test` for server unit and integration tests. Run `npm run verify` for those tests plus render, interaction and accessibility checks against an isolated test server. `npm run test:mobile` creates a test order; never run it against a live shop. Use the local `npm run sandbox:yoco` gateway for checkout tests without real payments. Optional mobile screenshots (`HB_MOBILE_SHOTS=1`) go to the ignored `artifacts/mobile-audit/` directory.
