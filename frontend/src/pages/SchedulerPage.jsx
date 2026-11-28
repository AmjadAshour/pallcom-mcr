import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { AutomationPage } from '../components/AutomationPage.jsx';
import { AddLiveBlock, MediaLibraryDrawer } from '../components/playout/MediaLibraryDrawer.jsx';
import { PlayoutHud } from '../components/playout/PlayoutHud.jsx';
import { AsRunLog, PlayoutSettings } from '../components/playout/PlayoutSettings.jsx';
import { PlayoutTimeline } from '../components/playout/PlayoutTimeline.jsx';
import { MultiTrackBroadcastScheduler } from '../components/playout/MultiTrackBroadcastScheduler.jsx';
import { usePlayout } from '../components/playout/usePlayout.js';
import { api, stationPath } from '../context/api.js';
import { useMcrStore } from '../context/useMcrStore.js';

const control = 'rounded border border-zinc-700 px-3 py-2 text-xs font-semibold disabled:opacity-50';

function StationPlayout({ station, canControl, ar }) {
  const path = stationPath(station.id, '/playout');
  const { snapshot, connected, error: connectionError, accept } = usePlayout(path, station.id);
  const [draft, setDraft] = useState(null);
  const [tab, setTab] = useState('timeline');
  const [lane, setLane] = useState('main');
  const [openLibrary, setOpenLibrary] = useState(false);
  const [assets, setAssets] = useState([]);
  const [search, setSearch] = useState('');
  const [scanReport, setScanReport] = useState('');
  const [health, setHealth] = useState({});
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const plan = draft ?? snapshot?.plan;
  const dirty = draft !== null;
  const versionConflict = draft && draft.revision !== snapshot?.plan.revision;

  useEffect(() => {
    const controller = new AbortController();
    api(path + '/assets', { signal: controller.signal }).then(({ data }) => setAssets(data))
      .catch((failure) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [path]);

  const healthKey = [...new Set([...(plan?.items ?? []), ...(plan?.filler ?? [])]
    .map((item) => item.assetId).filter(Boolean))].sort().join('|');
  useEffect(() => {
    if (!canControl || !snapshot?.state.stationReady || !healthKey) return;
    const controller = new AbortController();
    let timer;
    async function checkAssets() {
      try {
        const { data } = await api(path + '/health', { method: 'POST', signal: controller.signal, body: { assetIds: healthKey.split('|') } });
        if (!controller.signal.aborted) setHealth(Object.fromEntries(data.map((asset) => [asset.assetId, asset.health])));
      } catch {
        // The operator can use the explicit check to surface transport errors.
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(checkAssets, 30000);
      }
    }
    void checkAssets();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [path, healthKey, canControl, snapshot?.state.stationReady]);

  function change(key, value) {
    if (!canControl || busy) return;
    setDraft((current) => ({ ...(current ?? snapshot.plan), [key]: value }));
  }

  function append(key, item) {
    if (!canControl || busy) return;
    if (plan[key].length >= (key === 'items' ? 150 : 50)) {
      setError(ar ? 'بلغت القائمة حد العناصر المسموح.' : 'This queue has reached its item limit.');
      return;
    }
    setDraft((current) => {
      const base = current ?? snapshot.plan;
      return { ...base, [key]: [...base[key], item] };
    });
  }

  async function save() {
    if (!draft || versionConflict) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await api(path, { method: 'PUT', body: draft });
      accept(data);
      setDraft(null);
    } catch (failure) {
      setError(failure.details?.[0]?.message || failure.message);
    } finally {
      setBusy(false);
    }
  }

  async function act(action, params = {}) {
    setBusy(true);
    setError('');
    try {
      const { data } = await api(path + '/control', { method: 'POST', body: { action, ...params } });
      accept(data);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  async function scan() {
    setScanning(true);
    setScanReport('');
    setError('');
    try {
      const { data } = await api(path + '/scan', { method: 'POST' });
      setAssets(data.assets);
      setHealth((current) => ({ ...current, ...Object.fromEntries(data.assets.map((asset) => [asset.assetId, asset.health])) }));
      setScanReport([...(data.warnings ?? []), ...(data.truncated ? [ar ? 'تم بلوغ حد الفحص.' : 'Scan limit reached.'] : [])].join(' · '));
    } catch (failure) {
      setScanReport(failure.message);
    } finally {
      setScanning(false);
    }
  }

  async function check() {
    if (!healthKey) return;
    setChecking(true);
    setError('');
    try {
      const { data } = await api(path + '/health', { method: 'POST', body: { assetIds: healthKey.split('|') } });
      setHealth(Object.fromEntries(data.map((asset) => [asset.assetId, asset.health])));
    } catch (failure) {
      setError(failure.message);
    } finally {
      setChecking(false);
    }
  }

  if (!snapshot) return <p role={connectionError ? 'alert' : 'status'}>{connectionError || (ar ? 'جارٍ تحميل الجدول…' : 'Loading playout…')}</p>;
  const tabNames = ar ? { timeline: 'جدول التشغيل', settings: 'إعدادات OBS', log: 'سجل البث', jobs: 'المهام المجدولة' } :
    { timeline: 'Timeline', settings: 'OBS settings', log: 'As-run log', jobs: 'Scheduled jobs' };

  return <div className="space-y-4">
    <PlayoutHud snapshot={snapshot} connected={connected} canControl={canControl} busy={busy} act={act} scenes={station.scenes} ar={ar} />
    <nav className="flex flex-wrap gap-2" aria-label={ar ? 'أقسام التشغيل' : 'Playout sections'}>
      {Object.entries(tabNames).map(([id, name]) => <button key={id} className={control + (tab === id ? ' bg-zinc-800' : '')}
        aria-pressed={tab === id} onClick={() => setTab(id)}>{name}</button>)}
    </nav>
    {(error || connectionError || versionConflict) && <p role="alert" className="text-sm text-red-300">
      {error || connectionError || (ar ? 'تغيّر الجدول من جلسة أخرى. تجاهل المسودة لتحميل النسخة الجديدة.' :
        'Another session updated the schedule. Discard this draft to load the new revision.')}
    </p>}
    {canControl && ['timeline', 'settings'].includes(tab) && <div className="flex flex-wrap items-center gap-2">
      <button className={control + ' bg-cyan-800 text-white'} disabled={!dirty || busy || Boolean(versionConflict)} onClick={save}>
        {ar ? 'حفظ وتطبيق فورًا' : 'Save & apply immediately'}
      </button>
      <button className={control} disabled={!dirty || busy} onClick={() => { setDraft(null); setError(''); }}>{ar ? 'تجاهل المسودة' : 'Discard draft'}</button>
      {dirty && <span className="text-xs text-amber-300">{ar ? 'تغييرات غير محفوظة' : 'Unsaved changes'}</span>}
    </div>}
    {tab === 'timeline' && <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className={control} onClick={() => setOpenLibrary(!openLibrary)} aria-expanded={openLibrary}>{ar ? 'مكتبة الوسائط' : 'Media library'}</button>
        <button className={control} disabled={!canControl || checking || !healthKey || !snapshot.state.stationReady} onClick={check}>
          {checking ? (ar ? 'جارٍ التحقق…' : 'Checking…') : (ar ? 'فحص صلاحية الملفات' : 'Check media health')}
        </button>
        <label className="flex items-center gap-2 px-2 text-sm">
          <input type="checkbox" checked={plan.loop} disabled={!canControl || busy} onChange={(event) => change('loop', event.target.checked)} />
          {ar ? 'تكرار على مدار الساعة' : '24/7 loop'}
        </label>
      </div>
      {openLibrary && <MediaLibraryDrawer {...{ assets, search, setSearch, scanning, ar }} report={scanReport} onScan={scan}
        canEdit={canControl && !busy} close={() => setOpenLibrary(false)} add={(asset, target) => append(target, {
          id: crypto.randomUUID(), kind: 'media', category: target === 'filler' ? 'filler' : 'show',
          title: asset.title.slice(0, 250), assetId: asset.assetId, durationMs: asset.durationMs, hardStartAt: null
        })} />}
      {canControl && <AddLiveBlock ar={ar} scenes={station.scenes} canEdit={!busy} add={(item) => append('items', item)} />}
      <div className="flex flex-wrap gap-2">
        <button className={control} aria-pressed={lane === 'main'} onClick={() => setLane('main')}>{ar ? 'قائمة البث' : 'Main playlist'} · {plan.items.length}</button>
        <button className={control} aria-pressed={lane === 'filler'} onClick={() => setLane('filler')}>{ar ? 'قائمة المواد الاحتياطية' : 'Fallback playlist'} · {plan.filler.length}</button>
      </div>
      {lane === 'main' && <p className="text-xs text-zinc-400">{ar ? 'تُعرض الأوقات حسب توقيت جهازك.' : 'Fixed starts and estimates use your device time zone.'} {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>}
      <PlayoutTimeline plan={plan} snapshot={snapshot} lane={lane} assetHealth={health} canEdit={canControl && !busy} change={change} ar={ar} />
    </section>}
    {tab === 'settings' && <PlayoutSettings {...{ plan, change, busy, dirty, act, ar }} scenes={station.scenes}
      running={snapshot.state.running} ready={snapshot.state.stationReady} canEdit={canControl} />}
    {tab === 'log' && <AsRunLog path={path} activeLogId={snapshot.state.active?.logId} ar={ar} />}
    {tab === 'jobs' && <AutomationPage title={tabNames.jobs} scheduled />}
  </div>;
}

export function SchedulerPage() {
  const { stations, selectedStationId, selectStation, language } = useMcrStore();
  const { permissions } = useOutletContext();
  const ar = language === 'ar';
  const canControl = permissions.includes('*') || permissions.includes('station:control');
  const canManageSchedule = permissions.includes('*') || permissions.includes('schedule:manage');
  const canPublishSchedule = permissions.includes('*') || permissions.includes('schedule:publish');
  const canEmergency = permissions.includes('*') || permissions.includes('broadcast:emergency');
  const station = stations.find((item) => item.id === selectedStationId) ?? stations[0];
  return <section className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
      <h1 className="text-lg font-bold">{ar ? 'جدولة البث والتشغيل التلفزيوني' : 'TV playout and scheduling'}</h1>
      <label className="flex items-center gap-2 text-sm">{ar ? 'محطة البث' : 'Broadcast station'}
        <select className="rounded border border-zinc-700 bg-zinc-900 p-2" value={station?.id ?? ''}
          onChange={(event) => selectStation(event.target.value)}>
          {!station && <option value="">—</option>}
          {stations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
    </header>
    {station && (
      <MultiTrackBroadcastScheduler
        key={`mt-sched-${station.id}`}
        stationId={station.id}
        language={language}
        canManageSchedule={canManageSchedule}
        canPublishSchedule={canPublishSchedule}
        canControlStation={canControl}
        canEmergency={canEmergency}
      />
    )}
    {station ? <StationPlayout key={station.id} {...{ station, canControl, ar }} />
      : <p className="text-sm text-zinc-400">{ar ? 'أضف محطة لتشغيل الجدول.' : 'Add a station to configure its playout.'}</p>}
  </section>;
}
