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
