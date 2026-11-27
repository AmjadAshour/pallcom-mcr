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

export function Sidebar({ permissions }) {
  const { language } = useMcrStore();
  const t = translations[language] || translations.en;

  const navItems = [
    { to: '/', label: t.nav.overview, icon: LayoutDashboard },
    { to: '/stations', label: t.nav.stations, icon: Radio },
    { to: '/live', label: t.nav.liveControl, icon: Sliders },
    { to: '/multiview', label: t.nav.multiview, icon: Grid },
    { to: '/audio', label: t.nav.audioMixer, icon: Volume2 },
    { to: '/sources', label: t.nav.sourcesScenes, icon: Layers },
    { to: '/graphics', label: t.nav.graphics, icon: Sparkles, permission: 'station:control' },
    { to: '/macros', label: t.nav.macros, icon: Zap, permission: 'station:control' },
    { to: '/scheduler', label: t.nav.scheduler, icon: Calendar, permission: 'station:control' },
    { to: '/logs', label: t.nav.activityLogs, icon: FileText, permission: 'audit:read' },
    { to: '/users', label: t.nav.usersPermissions, icon: Users, permission: 'user:manage' },
    { to: '/settings', label: t.nav.settings, icon: Settings }
  ].filter(({ permission }) => !permission || permissions.includes('*') || permissions.includes(permission));

  return (
    <aside className="w-56 overflow-y-auto border-e border-zinc-800 bg-zinc-950 py-3 select-none shrink-0">
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
    </aside>
  );
}
