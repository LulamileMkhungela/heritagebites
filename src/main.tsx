import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { BASE_URL } from './lib/api';
import './index.css';

/*
 * On GitHub Pages the site is served from a sub-path (/heritagebites/), so the
 * router needs that prefix or every link resolves one level too high. On the
 * Express host BASE_URL is "/" and this is a no-op.
 */
const basename = BASE_URL.replace(/\/$/, '') || '/';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);

/*
 * Clear the boot loader once React has committed. It is removed rather than
 * merely hidden so it cannot sit in the tab order or be found by a screen
 * reader, and it is faded first so the handover is not a blink.
 *
 * The 280ms matches the CSS transition; if the element is already gone (a
 * second mount in development) this is a no-op.
 */
const boot = document.getElementById('hb-boot');
if (boot) {
  boot.style.opacity = '0';
  window.setTimeout(() => boot.remove(), 280);
}
