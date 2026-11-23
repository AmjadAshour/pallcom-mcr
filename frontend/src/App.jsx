import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SessionGate } from './components/layout/SessionGate.jsx';
import { DashboardLayout } from './components/layout/DashboardLayout.jsx';
import { OverviewPage } from './pages/OverviewPage.jsx';
import { StationsPage } from './pages/StationsPage.jsx';
import { LiveControlPage } from './pages/LiveControlPage.jsx';
import { MultiviewPage } from './pages/MultiviewPage.jsx';
import { AudioMixerPage } from './pages/AudioMixerPage.jsx';
import { SourcesScenesPage } from './pages/SourcesScenesPage.jsx';
import { GraphicsPage } from './pages/GraphicsPage.jsx';
import { BroadcastOverlay } from './components/BroadcastOverlay.jsx';
import { MacrosPage } from './pages/MacrosPage.jsx';
import { SchedulerPage } from './pages/SchedulerPage.jsx';
import { ActivityLogsPage } from './pages/ActivityLogsPage.jsx';
import { UsersPermissionsPage } from './pages/UsersPermissionsPage.jsx';
import { SettingsPage } from './pages/SettingsPage.jsx';

export function App() {
  const overlay = /^\/broadcast-overlay\/([a-f0-9]{64})\/?$/.exec(window.location.pathname);
  if (overlay) return <BroadcastOverlay token={overlay[1]} />;
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<SessionGate>{(session) => <DashboardLayout {...session} />}</SessionGate>}>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/stations" element={<StationsPage />} />
          <Route path="/live" element={<LiveControlPage />} />
          <Route path="/multiview" element={<MultiviewPage />} />
          <Route path="/audio" element={<AudioMixerPage />} />
          <Route path="/sources" element={<SourcesScenesPage />} />
          <Route path="/graphics" element={<GraphicsPage />} />
          <Route path="/macros" element={<MacrosPage />} />
          <Route path="/scheduler" element={<SchedulerPage />} />
          <Route path="/logs" element={<ActivityLogsPage />} />
          <Route path="/users" element={<UsersPermissionsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;

