import React from 'react';
import { NavLink } from 'react-router-dom';
import { useMcrStore } from '../../context/useMcrStore.js';
import { translations } from '../../i18n/translations.js';
import {
  LayoutDashboard,
  Radio,
  Sliders,
  Grid,
  Volume2,
  Layers,
  Sparkles,
  Zap,
  Calendar,
  FileText,
  Users,
  Settings
} from 'lucide-react';

export function Sidebar() {
  const { language } = useMcrStore();
  const t = translations[language] || translations.en;

  const navItems = [
    { to: '/', label: t.nav.overview, icon: LayoutDashboard },
    { to: '/stations', label: t.nav.stations, icon: Radio },
    { to: '/live', label: t.nav.liveControl, icon: Sliders },
    { to: '/multiview', label: t.nav.multiview, icon: Grid },
    { to: '/audio', label: t.nav.audioMixer, icon: Volume2 },
    { to: '/sources', label: t.nav.sourcesScenes, icon: Layers },
    { to: '/graphics', label: t.nav.graphics, icon: Sparkles },
    { to: '/macros', label: t.nav.macros, icon: Zap },
    { to: '/scheduler', label: t.nav.scheduler, icon: Calendar },
    { to: '/logs', label: t.nav.activityLogs, icon: FileText },
    { to: '/users', label: t.nav.usersPermissions, icon: Users },
    { to: '/settings', label: t.nav.settings, icon: Settings }
  ];

  return (
    <aside className="w-56 border-e border-zinc-800 bg-zinc-950 flex flex-col justify-between py-3 select-none shrink-0">
      <nav className="space-y-0.5 px-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-zinc-800 text-white font-semibold border border-zinc-700 shadow-inner'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* Operator Session Info */}
      <div className="px-3 pt-3 border-t border-zinc-900 mx-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <div className="overflow-hidden">
            <p className="text-[11px] font-mono text-zinc-300 font-bold truncate">{t.nav?.leadOperator || 'OP-AMJAD'}</p>
            <p className="text-[10px] font-mono text-zinc-500 uppercase">{t.nav?.operatorRole || 'SUPER ADMIN'}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
