/**
 * Service-window and delivery rules — re-exported from `shared/`.
 *
 * The rules live in one file that both the API and the browser can import, so
 * the storefront can work out the live service state itself (the GitHub Pages
 * preview has no server) without keeping a second copy of the schedule logic
 * that could drift from the one the API enforces.
 */
export * from '../../shared/service.js';
