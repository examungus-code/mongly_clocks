import { NavLink, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

const NAV = [
  { to: '/', label: 'Home', icon: '⚙' },
  { to: '/sell', label: 'Sell', icon: '🔑' },
  { to: '/catalogue', label: 'Catalogue', icon: '⏱' },
  { to: '/history', label: 'History', icon: '🕰' },
  { to: '/sync', label: 'Sync', icon: '↻' },
  { to: '/settings', label: 'Settings', icon: '✦' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const isSellMode = loc.pathname.startsWith('/sell') || loc.pathname.startsWith('/cart');

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-brass/40 bg-walnut text-parchment-light px-4 py-3 shadow-md">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <NavLink to="/" className="font-display text-2xl tracking-wide">
            <span className="text-brass-light">Clockwork</span>{' '}
            <span className="text-parchment-light">Traveler</span>
          </NavLink>
          <span className="text-xs text-parchment/60 font-ui hidden sm:inline">
            offline-first inventory
          </span>
        </div>
      </header>

      <main className={`flex-1 overflow-auto ${isSellMode ? 'touch-roomy' : ''}`}>
        <div className="max-w-6xl mx-auto p-4 sm:p-6">{children}</div>
      </main>

      <nav className="border-t border-brass/40 bg-walnut/95 text-parchment-light">
        <div className="max-w-6xl mx-auto grid grid-cols-6">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex flex-col items-center py-2 text-xs font-ui transition-colors ${
                  isActive
                    ? 'text-brass-light bg-walnut-dark'
                    : 'text-parchment-light/70 hover:text-brass-light'
                }`
              }
            >
              <span className="text-lg leading-none">{item.icon}</span>
              <span className="mt-0.5">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
