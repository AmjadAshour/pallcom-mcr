import React from 'react';
import { Link } from 'react-router-dom';
import { useMcrStore } from '../context/useMcrStore.js';
import { translations } from '../i18n/translations.js';
import { Card, CardHeader, CardTitle, CardContent, StatusBadge, TallyIndicator } from '@mcr/ui';
import { Radio, Activity, Film } from 'lucide-react';

export function OverviewPage() {
  const { language, stations } = useMcrStore();
  const ar = language === 'ar';
  const t = translations[language] || translations.en;

  const totalStations = stations.length;
  const onlineStations = stations.filter((s) => s.status === 'ONLINE').length;
  const streamingStations = stations.filter((s) => s.streamStatus === 'STREAMING').length;
  const recordingStations = stations.filter((s) => s.recordStatus === 'RECORDING').length;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{t.nav.overview}</h1>
        <Link to={totalStations ? '/live' : '/stations'} className="rounded border border-cyan-700 px-3 py-2 text-sm text-cyan-200">
          {totalStations ? t.nav.liveControl : t.stations.addStation}
        </Link>
      </header>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Card className="border-l-4 border-l-cyan-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-mono text-zinc-400 uppercase">
                {ar ? 'محطات OBS المتصلة' : 'OBS stations connected'}
              </p>
              <h2 className="text-2xl font-mono font-bold text-white mt-1">
                {onlineStations} <span className="text-xs text-zinc-500 font-normal">/ {totalStations}</span>
              </h2>
            </div>
            <Radio className="w-8 h-8 text-cyan-400 opacity-80" />
          </div>
        </Card>

        <Card className="border-l-4 border-l-red-600">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-mono text-zinc-400 uppercase">
                {ar ? 'بثوث OBS النشطة' : 'Active OBS streams'}
              </p>
              <h2 className="text-2xl font-mono font-bold text-red-500 mt-1">
                {streamingStations} <span className="text-xs text-zinc-500 font-normal">{t.overview?.liveOnAir || 'Live On-Air'}</span>
              </h2>
            </div>
            <Activity className="w-8 h-8 text-red-500 animate-pulse" />
          </div>
        </Card>

        <Card className="border-l-4 border-l-blue-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-mono text-zinc-400 uppercase">
                {ar ? 'تسجيلات OBS النشطة' : 'Active OBS recordings'}
              </p>
              <h2 className="text-2xl font-mono font-bold text-blue-400 mt-1">
                {recordingStations} <span className="text-xs text-zinc-500 font-normal">{t.overview?.capturing || 'Capturing'}</span>
              </h2>
            </div>
            <Film className="w-8 h-8 text-blue-400 opacity-80" />
          </div>
        </Card>

      </div>

      {/* Station Fleet Summary Table */}
      <Card>
        <CardHeader>
          <CardTitle>{t.overview?.fleetStatus || 'Broadcast Fleet Status'}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-zinc-950 text-zinc-400 uppercase border-b border-zinc-800">
                <tr>
                  <th className="p-2.5">{t.overview?.colStation || 'Station'}</th>
                  <th className="p-2.5">{t.overview?.colStudio || 'Studio'}</th>
                  <th className="p-2.5">{t.overview?.colStatus || 'Status'}</th>
                  <th className="p-2.5">{t.overview?.colPgm || 'On-Air Program Scene'}</th>
                  <th className="p-2.5">{t.overview?.colPvw || 'Preview Scene'}</th>
                  <th className="p-2.5">{t.overview?.colFps || 'FPS'}</th>
                  <th className="p-2.5">{t.overview?.colCpu || 'CPU'}</th>
                  <th className="p-2.5">{t.overview?.colHeartbeat || 'Last Heartbeat'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {stations.map((st) => (
                  <tr key={st.id} className="hover:bg-zinc-800/30 transition-colors">
                    <td className="p-2.5 font-bold text-white flex items-center gap-2">
                      <TallyIndicator
                        state={st.streamStatus === 'STREAMING' ? 'program' : st.status === 'ONLINE' ? 'preview' : 'idle'}
                        size="sm"
                      />
                      {st.name}
                    </td>
                    <td className="p-2.5 text-zinc-400">{st.studioName}</td>
                    <td className="p-2.5">
                      <StatusBadge status={st.status} />
                    </td>
                    <td className="p-2.5 text-red-400 font-bold truncate max-w-[180px]">
                      {st.currentProgramScene || '—'}
                    </td>
                    <td className="p-2.5 text-emerald-400 truncate max-w-[180px]">
                      {st.currentPreviewScene || '—'}
                    </td>
                    <td className="p-2.5 text-zinc-300">{st.fps.toFixed(2)}</td>
                    <td className="p-2.5 text-zinc-300">{st.cpuUsage.toFixed(1)}%</td>
                    <td className="p-2.5 text-zinc-500">
                      {st.lastHeartbeat ? new Date(st.lastHeartbeat).toLocaleTimeString() : (t.overview?.offline || 'Offline')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
