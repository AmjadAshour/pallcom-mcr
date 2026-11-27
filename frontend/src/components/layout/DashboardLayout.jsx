import React from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from './Header.jsx';
import { Sidebar } from './Sidebar.jsx';
import { useMcrStore } from '../../context/useMcrStore.js';

export function DashboardLayout({ user, logout, error }) { 
  const { stations, pending, connectionError, commandError } = useMcrStore();
  return (
    <div className="flex flex-col h-screen w-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      <Header permissions={user.permissions} />
      <div className="flex items-center justify-end gap-3 border-b border-zinc-800 px-4 py-1 text-xs"><span>{user.email}</span><button className="underline" onClick={logout}>Sign out</button></div>
      <div className="flex flex-1 overflow-hidden">
        <Sidebar permissions={user.permissions} />
        <main className="flex-1 overflow-y-auto p-4 bg-zinc-950/95 relative">
          {(error || connectionError || commandError) && <p role="alert" className="mb-3 text-red-300">{error || connectionError || commandError}</p>}
          {Object.values(pending).some(Boolean) && <p role="status" className="mb-3 text-cyan-300">Waiting for OBS…</p>}
          {!stations.length && <p className="mb-3 text-zinc-400">No stations available.</p>}
          <Outlet context={user} />
        </main>
      </div>
    </div>
  );
}

