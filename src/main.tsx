import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { seedIfNeeded } from './db/seed';
import './index.css';

// PWA update strategy — belt-and-suspenders with the vite-plugin-pwa
// autoUpdate registration:
//   1. When the SW takes control of this page (i.e. a new deploy just
//      activated), reload once so we're actually running the new bundle
//      instead of the old JS in memory. Guard against loops.
//   2. Ping the SW to re-check for updates every time the tab comes back
//      into focus, so if she deploys while the PWA is open in the
//      background she gets the new version within seconds of switching to
//      it instead of on some background-check cadence.
if ('serviceWorker' in navigator) {
  const hadControllerAtLoad = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // If there was no controller when the page loaded, this is the very
    // first SW activation — no need to reload, we're already fresh.
    if (!hadControllerAtLoad) return;
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    navigator.serviceWorker.getRegistration().then((reg) => {
      reg?.update();
    });
  });
}

// Seed must finish before any screen reads from the DB, otherwise the sell
// screen flickers with empty payment-type lists.
seedIfNeeded().then(() => {
  const root = createRoot(document.getElementById('root')!);
  root.render(
    <StrictMode>
      <BrowserRouter basename="/mongly_clocks">
        <App />
      </BrowserRouter>
    </StrictMode>
  );
});
