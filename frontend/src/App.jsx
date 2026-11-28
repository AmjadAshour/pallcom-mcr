import React, { lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SessionGate } from './components/layout/SessionGate.jsx';
import { DashboardLayout } from './components/layout/DashboardLayout.jsx';
const OverviewPage = lazy(() => import('./pages/OverviewPage.jsx').then(module => ({ default: module.OverviewPage })));
const StationsPage = lazy(() => import('./pages/StationsPage.jsx').then(module => ({ default: module.StationsPage })));
const LiveControlPage = lazy(() => import('./pages/LiveControlPage.jsx').then(module => ({ default: module.LiveControlPage })));
const MultiviewPage = lazy(() => import('./pages/MultiviewPage.jsx').then(module => ({ default: module.MultiviewPage })));
const AudioMixerPage = lazy(() => import('./pages/AudioMixerPage.jsx').then(module => ({ default: module.AudioMixerPage })));
const SourcesScenesPage = lazy(() => import('./pages/SourcesScenesPage.jsx').then(module => ({ default: module.SourcesScenesPage })));
const MediaLibraryPage = lazy(() => import('./pages/MediaLibraryPage.jsx').then(module => ({ default: module.MediaLibraryPage })));
const GraphicsPage = lazy(() => import('./pages/GraphicsPage.jsx').then(module => ({ default: module.GraphicsPage })));
const MacrosPage = lazy(() => import('./pages/MacrosPage.jsx').then(module => ({ default: module.MacrosPage })));
const SchedulerPage = lazy(() => import('./pages/SchedulerPage.jsx').then(module => ({ default: module.SchedulerPage })));
const ActivityLogsPage = lazy(() => import('./pages/ActivityLogsPage.jsx').then(module => ({ default: module.ActivityLogsPage })));
const UsersPermissionsPage = lazy(() => import('./pages/UsersPermissionsPage.jsx').then(module => ({ default: module.UsersPermissionsPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage.jsx').then(module => ({ default: module.SettingsPage })));

const BroadcastOverlay = lazy(() => import('./components/BroadcastOverlay.jsx').then(module => ({ default: module.BroadcastOverlay })));

export function App() {
  const overlay = /^\/broadcast-overlay\/([a-f0-9]{64})\/?$/.exec(window.location.pathname);
  if (overlay) return <React.Suspense fallback={null}><BroadcastOverlay token={overlay[1]} /></React.Suspense>;
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<SessionGate>{(session) => <DashboardLayout {...session} />}</SessionGate>}>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/stations" element={<StationsPage />} />
          <Route path="/live" element={<LiveControlPage />} />
          <Route path="/multiview" element={<MultiviewPage />} />
          <Route path="/audio" element={<AudioMixerPage />} />
          <Route path="/media" element={<MediaLibraryPage />} />
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

