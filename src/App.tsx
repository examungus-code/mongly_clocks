import { Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Dashboard } from './screens/dashboard/Dashboard';
import { StartSession } from './screens/session/StartSession';
import { Sell } from './screens/sell/Sell';
import { Cart } from './screens/sell/Cart';
import { Catalogue } from './screens/catalogue/Catalogue';
import { InventoryLog } from './screens/inventory/InventoryLog';
import { History } from './screens/history/History';
import { Sync } from './screens/sync/Sync';
import { Settings } from './screens/settings/Settings';

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/session/start" element={<StartSession />} />
        <Route path="/sell" element={<Sell />} />
        <Route path="/cart" element={<Cart />} />
        <Route path="/catalogue" element={<Catalogue />} />
        <Route path="/inventory" element={<InventoryLog />} />
        <Route path="/history" element={<History />} />
        <Route path="/sync" element={<Sync />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
