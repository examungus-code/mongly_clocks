import { Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Dashboard } from './screens/dashboard/Dashboard';
import { Sell } from './screens/sell/Sell';
import { RecentSales } from './screens/sell/RecentSales';
import { Catalogue } from './screens/catalogue/Catalogue';
import { AdjustmentLog } from './screens/history/AdjustmentLog';
import { Sold } from './screens/sold/Sold';
import { Sync } from './screens/sync/Sync';
import { Settings } from './screens/settings/Settings';

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/sell" element={<Sell />} />
        <Route path="/sell/recent" element={<RecentSales />} />
        <Route path="/catalogue" element={<Catalogue />} />
        <Route path="/sold" element={<Sold />} />
        <Route path="/history" element={<AdjustmentLog />} />
        {/* Old paths from the previous labeling — redirect so any
            bookmarks / nav links pointing at them still land somewhere sensible. */}
        <Route path="/inventory" element={<Navigate to="/history" replace />} />
        {/* Sessions were removed; the festival is picked on the Sell screen. */}
        <Route
          path="/session/start"
          element={<Navigate to="/sell" replace />}
        />
        <Route path="/sync" element={<Sync />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
