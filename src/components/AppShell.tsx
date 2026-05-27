import { NavLink, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

const NAV = [
  { to: '/', label: 'Home', icon: '⚙' },
  { to: '/sell', label: 'Sell', icon: '🔑' },
  { to: '/catalogue', label: 'Catalogue', icon: '⏱' },
  { to: '/inventory', label: 'Inventory', icon: '⚖' },
  { to: '/history', label: 'History', icon: '🕰' },
  { to: '/sync', label: 'Sync', icon: '↻' },
  { to: '/settings', label: 'Settings', icon: '✦' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const isSellMode = loc.pathname.startsWith('/sell') || loc.pathname.startsWith('/cart');

  return (
    <div className="h-full flex flex-col">
      <header className="border-b-2 border-brass bg-white text-walnut px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <NavLink to="/" className="flex items-center" aria-label="Clockwork Traveler — home">
            <img
              src="/mongly_clocks/logo.webp"
              alt="Clockwork Traveler"
              className="h-8 sm:h-10 w-auto"
            />
          </NavLink>
          <span className="text-xs text-walnut/50 font-ui hidden sm:inline">
            offline-first inventory
          </span>
        </div>
      </header>

      <main className={`flex-1 overflow-auto ${isSellMode ? 'touch-roomy' : ''}`}>
        <div className="max-w-6xl mx-auto p-4 sm:p-6">{children}</div>
      </main>

      <nav className="border-t-2 border-brass bg-white text-walnut">
        <div className="max-w-6xl mx-auto grid grid-cols-7">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex flex-col items-center py-2 text-xs font-ui transition-colors ${
                  isActive
                    ? 'text-walnut bg-brass-soft'
                    : 'text-walnut/60 hover:text-walnut hover:bg-brass-tint'
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
