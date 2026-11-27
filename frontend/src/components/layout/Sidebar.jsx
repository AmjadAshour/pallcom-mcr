import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Calendar, FileText, Grid, Layers, LayoutDashboard, Menu, Radio, Settings, Sliders, Sparkles, Users, Volume2, Zap } from 'lucide-react';
import { useMcrStore } from '../../context/useMcrStore.js';
import { translations } from '../../i18n/translations.js';

export function Sidebar({ permissions }) {
  const language = useMcrStore(state => state.language);
  const [expanded, setExpanded] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  const { pathname } = useLocation();
  const ar = language === 'ar';
  const t = (translations[language] || translations.en).nav;
  const can = permission => permissions.includes('*') || permissions.includes(permission);
  const sections = [
    { title: ar ? 'البث' : 'Broadcast', items: [
      ['/', t.overview, LayoutDashboard],
      ['/live', t.liveControl, Sliders],
      ['/multiview', t.multiview, Grid],
      ['/sources', ar ? 'المصادر والجدولة' : 'Sources & scheduling', Layers],
      ['/graphics', t.graphics, Sparkles],
      ['/audio', t.audioMixer, Volume2],
    ] },
    { title: ar ? 'الإدارة' : 'Administration', items: [
      ['/stations', t.stations, Radio],
      ...(can('audit:read') ? [['/logs', t.activityLogs, FileText]] : []),
      ...(can('user:manage') ? [['/users', t.usersPermissions, Users]] : []),
    ] },
  ];
  const integrations = [
    ['/scheduler', ar ? 'جدولة OBS' : 'OBS scheduler', Calendar],
    ['/macros', ar ? 'أتمتة OBS' : 'OBS automation', Zap],
    ...(can('station:manage') ? [['/settings', ar ? 'اقتران OBS' : 'OBS pairing', Settings]] : []),
  ];

  function links(items) {
    return items.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === '/'}
      aria-label={label} title={expanded ? undefined : label}
      className={({ isActive }) =>
        'flex min-h-10 items-center gap-3 rounded px-2 text-sm focus-visible:outline focus-visible:outline-cyan-400 ' +
        (isActive ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-900 hover:text-white')}>
      <Icon size={17} className="shrink-0" aria-hidden="true" />
      {expanded && <span>{label}</span>}
    </NavLink>);
  }

  return <aside className={`shrink-0 overflow-y-auto border-e border-zinc-800 bg-zinc-950 px-2 py-2 ${expanded ? 'w-40 sm:w-52' : 'w-12'}`}>
    <button type="button" aria-expanded={expanded} aria-controls="mcr-navigation"
      aria-label={expanded ? (ar ? 'طي القائمة' : 'Collapse menu') : (ar ? 'توسيع القائمة' : 'Expand menu')}
      onClick={() => setExpanded(value => !value)} className="grid min-h-10 w-full place-items-center rounded text-zinc-300 hover:bg-zinc-800">
      <Menu size={18} aria-hidden="true" />
    </button>
    <nav id="mcr-navigation" aria-label={ar ? 'القائمة الرئيسية' : 'Main navigation'} className="space-y-3">
      {sections.map(({ title, items }) => <div key={title} className="border-t border-zinc-800 pt-2">
        {expanded && <p className="px-2 text-xs text-zinc-400">{title}</p>}
        {links(items)}
      </div>)}
      {expanded ? <details key={pathname} open={integrations.some(([to]) => to === pathname)} className="border-t border-zinc-800 pt-2">
        <summary className="cursor-pointer px-2 py-2 text-xs text-zinc-400">{ar ? 'تكامل OBS' : 'OBS integration'}</summary>
        {links(integrations)}
      </details> : <div className="border-t border-zinc-800 pt-2">{links(integrations)}</div>}
    </nav>
  </aside>;
}
