import React, { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { api } from '../context/api.js';
import { useMcrStore } from '../context/useMcrStore.js';
import { translations } from '../i18n/translations.js';
import { Card, Button, StatusBadge, TallyIndicator } from '@mcr/ui';
import { Plus, Key, Trash2 } from 'lucide-react';

export function StationsPage() {
  const { language, stations, selectStation, synchronize, pending, deleteStation } = useMcrStore();
  const t = translations[language] || translations.en;
  const ar = language === 'ar';
  const [filter, setFilter] = useState('ALL'); // ALL, ONLINE, STREAMING

  const navigate = useNavigate();
  const user = useOutletContext();
  const can = (permission) => user.permissions.includes('*') || user.permissions.includes(permission);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const deleteLabel = language === 'ar' ? 'حذف المحطة' : 'Delete station';

  async function confirmDelete(station) {
    const message = language === 'ar'
      ? `هل تريد حذف محطة «${station.name}» نهائيًا من الخادم؟ سيتم إلغاء اقترانها وحذف مهامها المجدولة.`
      : `Permanently delete “${station.name}” from the server? This removes its pairing and scheduled jobs.`;
    if (!window.confirm(message)) return;
    setDeleteError('');
    try {
      await deleteStation(station.id);
    } catch (failure) {
      const message = language === 'ar' ? 'تعذّر حذف المحطة' : 'Could not delete station';
      setDeleteError(`${message} · ${station.name} · ${failure.message}`);
    }
  }

  async function addStation(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError('');
    try {
      await api('/stations', { method: 'POST', body: {
        name: form.get('name')
      } });
      setAdding(false);
      await synchronize();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  }

  const filteredStations = stations.filter((s) => {
    if (filter === 'ONLINE') return s.status === 'ONLINE';
    if (filter === 'STREAMING') return s.streamStatus === 'STREAMING';
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Header & Filter Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-lg font-bold font-mono tracking-wide text-white uppercase">
            {t.nav.stations}
          </h1>
          <p className="text-xs text-zinc-400">{ar ? 'أنشئ المحطات وافتح التحكم المباشر.' : 'Create stations and open their live controls.'}</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-zinc-900 border border-zinc-800 rounded p-0.5 text-xs font-mono">
            <button
              onClick={() => setFilter('ALL')}
              className={`px-3 py-1 rounded ${filter === 'ALL' ? 'bg-zinc-800 text-white font-bold' : 'text-zinc-400'}`}
            >
              {t.stations.filterAll}
            </button>
            <button
              onClick={() => setFilter('ONLINE')}
              className={`px-3 py-1 rounded ${filter === 'ONLINE' ? 'bg-zinc-800 text-white font-bold' : 'text-zinc-400'}`}
            >
              {t.stations.filterOnline}
            </button>
            <button
              onClick={() => setFilter('STREAMING')}
              className={`px-3 py-1 rounded ${filter === 'STREAMING' ? 'bg-zinc-800 text-white font-bold' : 'text-zinc-400'}`}
            >
              {t.stations.filterStreaming}
            </button>
          </div>

          <Button variant="secondary" size="sm" onClick={() => navigate('/settings')} disabled={!can('station:manage')}>
            <Key className="w-3.5 h-3.5 me-1 text-amber-400" />
            {t.stations?.pairAgent || 'Pair Agent'}
          </Button>
          <Button variant="primary" size="sm" onClick={() => setAdding(!adding)} disabled={!can('station:manage')}>
            <Plus className="w-3.5 h-3.5 me-1" />
            {t.stations.addStation}
          </Button>
        </div>
      </div>

      {adding && <form onSubmit={addStation} className="flex flex-wrap items-end gap-3 rounded border border-zinc-800 p-3">
        <label>{ar ? 'اسم المحطة' : 'Station name'}
          <input className="block rounded bg-zinc-800 p-2" name="name" minLength={2} maxLength={100} required />
        </label>
        <Button type="submit" disabled={saving}>{ar ? 'حفظ المحطة' : 'Save station'}</Button>
        {error && <p role="alert">{error}</p>}
      </form>}
      {deleteError && <p role="alert" className="text-sm text-red-400">{deleteError}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 gap-4">
        {filteredStations.map((st) => {
          const isOnline = st.status === 'ONLINE';
          const isStreaming = st.streamStatus === 'STREAMING';

          return (
            <Card
              key={st.id}
              className={`relative overflow-hidden transition-all border ${
                isStreaming
                  ? 'border-red-600/60 shadow-[0_0_15px_rgba(220,38,38,0.2)]'
                  : 'border-zinc-800 hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center justify-between pb-3 border-b border-zinc-800/80">
                <div className="flex items-center gap-2.5">
                  <TallyIndicator
                    state={isStreaming ? 'program' : isOnline ? 'preview' : 'idle'}
                    pulse={isStreaming}
                    size="md"
                  />
                  <div>
                    <h3 className="font-mono font-bold text-sm text-white">{st.name}</h3>
                    <p className="text-[11px] text-zinc-400">{st.studioName}</p>
                  </div>
                </div>
                <StatusBadge status={isStreaming ? 'STREAMING' : st.status} />
              </div>

              {/* Live Scene Displays */}
              <div className="grid grid-cols-2 gap-2 my-3">
                <div className="bg-zinc-950/80 border border-zinc-800/80 rounded p-2">
                  <span className="text-[10px] font-mono uppercase text-red-500 font-bold block mb-1">
                    {t.stations?.programOnAir || 'PROGRAM (ON AIR)'}
                  </span>
                  <p className="text-xs font-semibold text-zinc-100 truncate">
                    {st.currentProgramScene || (t.stations?.noScene || 'No Scene')}
                  </p>
                </div>
                <div className="bg-zinc-950/80 border border-zinc-800/80 rounded p-2">
                  <span className="text-[10px] font-mono uppercase text-emerald-400 font-bold block mb-1">
                    {t.stations?.previewDeck || 'PREVIEW'}
                  </span>
                  <p className="text-xs font-semibold text-zinc-100 truncate">
                    {st.currentPreviewScene || (t.stations?.noScene || 'No Scene')}
                  </p>
                </div>
              </div>

              {/* Performance Metrics */}
              <div className="grid grid-cols-3 gap-2 bg-zinc-950/40 rounded p-2 text-xs font-mono mb-3 border border-zinc-900">
                <div>
                  <span className="text-zinc-500 text-[10px] uppercase block">{t.stations?.fps || 'FPS'}</span>
                  <span className="text-zinc-200 font-bold">{st.fps.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-zinc-500 text-[10px] uppercase block">{t.stations?.cpu || 'CPU'}</span>
                  <span className="text-zinc-200 font-bold">{st.cpuUsage.toFixed(1)}%</span>
                </div>
                <div>
                  <span className="text-zinc-500 text-[10px] uppercase block">{t.stations?.memory || 'RAM'}</span>
                  <span className="text-zinc-200 font-bold">{st.memoryUsage.toFixed(1)}%</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-800/60">
                <div className="flex items-center gap-2">
                {can('station:manage') && (
                  <Button variant="outline" size="sm" onClick={() => navigate('/settings?pair=' + encodeURIComponent(st.id))}
                    aria-label={`${t.stations.pairAgent} · ${st.name}`} className="text-xs">
                    <Key className="w-3.5 h-3.5 me-1" aria-hidden="true" />
                    {t.stations.pairAgent}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => { selectStation(st.id); navigate('/live'); }}
                  className="text-xs font-mono"
                >
                  {ar ? 'فتح التحكم المباشر' : 'Open Live Control'}
                </Button>
                {can('station:manage') && (
                  <Button variant="danger" size="sm" disabled={pending[st.id]}
                    aria-label={`${deleteLabel} · ${st.name}`} onClick={() => confirmDelete(st)}
                    className="text-xs font-mono">
                    <Trash2 className="w-3.5 h-3.5 me-1" aria-hidden="true" />
                    {deleteLabel}
                  </Button>
                )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}



