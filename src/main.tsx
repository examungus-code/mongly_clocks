import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { seedIfNeeded } from './db/seed';
import './index.css';

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
