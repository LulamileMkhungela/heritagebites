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

1. Use a separate HTTPS subdomain such as `order.heritagebites.co.za` to keep the existing WordPress site and email unchanged. Clone `main` into a private folder **outside** the web document roots.
2. Run the install and build from the app folder. Set `HB_SITE_URL` and `VITE_SITE_URL` to the actual public URL when running `npm run build`. The clone does not contain `dist/`; if you cannot build on the server, build elsewhere and upload the app files **with** `dist/`, not the Pages `web/` folder. Do not upload `node_modules` or a filled-in `.env` from another machine.
3. In **NodeJS Manager → Custom**, select the folder containing `package.json` and start with `npm start`. Use a compatible Node version. The app's `PORT` must match the panel's assigned internal port; keep it behind the HTTPS proxy.
4. Set `HB_PUBLIC_URL` and `HB_SITE_URL` to the public HTTPS address for receipt links and search metadata. Set `HB_DATA_DIR` to an absolute, private, writable directory that survives updates. Use one app instance for the JSON store. Set `HB_TRUST_PROXY=1` only if the app sits behind a single trusted proxy and the Node port is not directly reachable.
5. Verify HTTPS, the home page and `/api/health` (`ok: true`). Test on a protected or otherwise controlled staging deployment; disabling card payments alone does not disable ordering.

Keep secrets in private host settings or a restricted `.env` in the app directory. For an existing Render preview, `render.yaml` remains the deployment blueprint. Do not accept real orders on an ephemeral filesystem.

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
