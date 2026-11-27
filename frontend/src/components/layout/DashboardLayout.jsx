import React, { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from './Header.jsx';
import { Sidebar } from './Sidebar.jsx';
import { useMcrStore } from '../../context/useMcrStore.js';

export function DashboardLayout({ user, logout, error }) { 
  const { language, pending, connectionError, commandError } = useMcrStore();
  const ar = language === 'ar';
  return (
    <div className="flex flex-col h-screen w-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      <Header />
      <div className="flex items-center justify-end gap-3 border-b border-zinc-800 px-4 py-1 text-xs"><span>{user.email}</span><button className="underline" onClick={logout}>{ar ? 'تسجيل الخروج' : 'Sign out'}</button></div>
      <div className="flex flex-1 overflow-hidden">
        <Sidebar permissions={user.permissions} />
        <main className="min-w-0 flex-1 overflow-y-auto p-3 sm:p-4 bg-zinc-950/95 relative">
          {(error || connectionError || commandError) && <p role="alert" className="mb-3 text-red-300">{error || connectionError || commandError}</p>}
          {Object.values(pending).some(Boolean) && <p role="status" className="mb-3 text-cyan-300">{ar ? 'بانتظار تأكيد الجهاز…' : 'Waiting for device acknowledgement…'}</p>}
          <Suspense fallback={<p role="status">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>}>
            <Outlet context={user} />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

