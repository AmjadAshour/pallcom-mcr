import React, { useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Grid, GripVertical, Maximize } from 'lucide-react';
import { TallyIndicator } from '@mcr/ui';
import { ProgramPreview } from '../components/ProgramPreview.jsx';
import { useMcrStore } from '../context/useMcrStore.js';
import { api, stationPath } from '../context/api.js';
import { useMonitorFrame } from '../context/useProgramMonitor.js';
import { useProgramStatus } from '../context/useProgramStatus.js';

const grids = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'
};
const button = 'rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-cyan-400';
const programLabels = {
  running: ['Running', 'قيد التشغيل'],
  stopped: ['Stopped', 'متوقف'],
  starting: ['Starting', 'جارٍ التشغيل'],
  stopping: ['Stopping', 'جارٍ الإيقاف'],
  failed: ['Worker failed', 'تعطل محرك البث']
};

function readLayout(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    return {
      columns: Object.hasOwn(grids, saved?.columns) ? Number(saved.columns) : 2,
      order: Array.isArray(saved?.order) ? saved.order.filter((id) => typeof id === 'string') : [],
      preview: saved?.preview === true
    };
  } catch {
    return { columns: 2, order: [], preview: false };
  }
}

function StationTile({ station, preview, ar, canControl }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: station.id });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const online = station.status === 'ONLINE';
  const programPath = stationPath(station.id, '/program');
  const program = useProgramStatus(station.id, true, 5000);
  const programRunning = program?.state === 'running';
  const showIndependent = programRunning || (program?.configured && !online);
  const programFrame = useMonitorFrame(programPath + (preview ? '/input-preview' : '/program-monitor'), programRunning, 2000);
  const monitorTitle = preview
    ? (ar ? 'معاينة مدخل البرنامج المستقل' : 'Independent Program input preview')
    : (ar ? 'صورة خرج البرنامج المستقل' : 'Independent Program output');
  const onAir = showIndependent ? programRunning : online && station.streamStatus === 'STREAMING';
  const scene = preview ? station.currentPreviewScene : station.currentProgramScene;
  const fps = online && Number.isFinite(station.fps) ? station.fps.toFixed(1) + ' FPS' : '—';
  const bitrate = online && Number.isFinite(station.streamBitrateKbps) ? station.streamBitrateKbps.toLocaleString() + ' kb/s' : '— kb/s';
  const audio = online && station.ready ? station.audioInputs ?? [] : [];

  async function replay(action) {
    setBusy(true);
    setNotice('');
    try {
      await api(stationPath(station.id, '/replay/' + action), { method: 'POST' });
      setNotice(ar ? 'استلم OBS الطلب' : 'OBS accepted the request');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 1 : undefined }}
      className={`relative overflow-hidden rounded-lg border bg-black ${onAir ? 'border-red-600' : 'border-zinc-700'}`}>
      <header className="flex items-center gap-2 bg-zinc-900 px-2.5 py-1.5 text-xs">
        <button {...attributes} {...listeners} type="button" className="touch-none rounded p-1 hover:bg-zinc-700"
          aria-label={(ar ? 'ترتيب ' : 'Reorder ') + station.name}><GripVertical size={15} /></button>
        <TallyIndicator state={onAir ? 'program' : 'idle'} pulse={onAir} size="sm" />
        <strong className="min-w-0 flex-1 truncate">{station.name}</strong>
        {!showIndependent && <><span className="font-mono text-zinc-400" title={ar ? 'معدل بث OBS الفعلي' : 'Measured OBS stream bitrate'}>
          {online && station.streamReconnecting ? (ar ? 'إعادة الاتصال' : 'Reconnecting') : bitrate}
        </span>
        <span className="font-mono text-zinc-400">{fps}</span></>}
      </header>
      <div className="grid aspect-video place-items-center overflow-hidden bg-zinc-950">
        {showIndependent
          ? (programFrame ? <img className="h-full w-full object-contain" src={programFrame} alt={monitorTitle} />
            : <span className="text-xs text-zinc-400">{ar ? 'صورة البرنامج غير متاحة' : 'Program picture unavailable'}</span>)
          : <ProgramPreview key={JSON.stringify([preview, station.status, station.ready])} station={station} preview={preview} />}
      </div>
      <footer className="flex items-center justify-between gap-2 border-t border-zinc-800 px-3 py-2 text-xs">
        <span className="truncate text-zinc-300">{showIndependent ? (ar ? 'البرنامج المستقل' : 'Independent Program') : scene || '—'}</span>
        {showIndependent
          ? <span className={programRunning ? 'text-emerald-400' : 'text-zinc-400'}>{programLabels[program.state]?.[ar ? 1 : 0]}</span>
          : <span className={online ? 'text-emerald-400' : station.status === 'DEGRADED' ? 'text-amber-400' : 'text-zinc-400'}>{station.status}</span>}
      </footer>
      {!!audio.length && <div className="max-h-28 space-y-1 overflow-auto bg-zinc-950 px-3 py-2">
        {audio.map((input) => {
          const measured = Number.isFinite(input.peakDb);
          return <div key={input.name} className="flex items-center gap-2 text-xs">
            <span className="w-20 truncate" title={input.name}>{input.name}</span>
            {measured && <meter className="min-w-0 flex-1" dir="ltr" min={-60} max={0} low={-20} high={-6} optimum={-12}
              value={Math.min(0, Math.max(-60, input.peakDb))} aria-label={input.name + ' peak dBFS'} />}
            <span className="ms-auto whitespace-nowrap font-mono text-zinc-400">
              {input.muted ? (ar ? 'مكتوم' : 'Muted') : measured ? input.peakDb.toFixed(1) + ' dBFS' : '—'}
            </span>
          </div>;
        })}
      </div>}
      {online && station.ready && typeof station.replayBufferActive === 'boolean' && <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 px-3 py-2 text-xs">
        <span>{station.replayBufferActive ? (ar ? 'مخزن الإعادة نشط' : 'Replay buffer active') : (ar ? 'مخزن الإعادة متوقف' : 'Replay buffer stopped')}</span>
        {canControl && <>
          <button type="button" className={button} disabled={busy} onClick={() => replay(station.replayBufferActive ? 'stop' : 'start')}>
            {station.replayBufferActive ? (ar ? 'إيقاف المخزن' : 'Stop buffer') : (ar ? 'بدء المخزن' : 'Start buffer')}
          </button>
          {station.replayBufferActive && <button type="button" className={button} disabled={busy} onClick={() => replay('save')}>
            {ar ? 'حفظ آخر لقطة' : 'Save replay'}
          </button>}
        </>}
        {station.lastReplaySavedAt && <span>{ar ? 'آخر حفظ' : 'Last saved'} {new Date(station.lastReplaySavedAt).toLocaleTimeString()}</span>}
        {notice && <span role="status">{notice}</span>}
      </div>}
    </article>
  );
}

function MonitorWall({ storageKey, stations, ar, canControl }) {
  const [layout, setLayout] = useState(() => readLayout(storageKey));
  const [notice, setNotice] = useState('');
  const wall = useRef(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const byId = new Map(stations.map((station) => [station.id, station]));
  const order = [...new Set([...layout.order.filter((id) => byId.has(id)), ...byId.keys()])];

  function save(next) {
    setLayout(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setNotice('');
    } catch {
      setNotice(ar ? 'تعذّر حفظ التخطيط في هذا المتصفح' : 'This browser could not save the layout');
    }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === wall.current) await document.exitFullscreen();
      else await wall.current.requestFullscreen();
    } catch {
      setNotice(ar ? 'تعذّر فتح ملء الشاشة' : 'Fullscreen is unavailable');
    }
  }

  return (
    <section ref={wall} className="space-y-3 bg-zinc-950 p-2 fullscreen:overflow-auto">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2">
          <Grid className="text-cyan-400" size={20} />
          <h1 className="text-base font-semibold">{ar ? 'المراقبة المتعددة' : 'Multiview'}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className={button} aria-label={ar ? 'عدد الأعمدة' : 'Columns'} value={layout.columns}
            onChange={(event) => save({ ...layout, columns: Number(event.target.value) })}>
            {[2, 3, 4].map((count) => <option key={count} value={count}>{count} {ar ? 'أعمدة' : 'columns'}</option>)}
          </select>
          <button className={button} type="button" aria-pressed={layout.preview}
            onClick={() => save({ ...layout, preview: !layout.preview })}>
            {layout.preview ? (ar ? 'المصدر: المعاينة' : 'Bus: Preview') : (ar ? 'المصدر: البرنامج' : 'Bus: Program')}
          </button>
          {document.fullscreenEnabled && <button className={`inline-flex items-center gap-1 ${button}`} type="button" onClick={toggleFullscreen}>
            <Maximize size={14} />{ar ? 'ملء الشاشة' : 'Fullscreen'}
          </button>}
        </div>
      </header>
      <p className="text-xs text-zinc-400">{ar ? 'لقطات دورية من البرنامج المستقل أو OBS. ترتيب المحطات محفوظ في هذا المتصفح.' : 'Periodic snapshots from Independent Program or OBS. Station order is saved in this browser.'}</p>
      {notice && <p role="status" className="text-xs text-amber-400">{notice}</p>}
      {!order.length && <p className="py-10 text-center text-sm text-zinc-400">{ar ? 'أضف محطة لبدء المراقبة' : 'Add a station to start monitoring'}</p>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
        if (!over || active.id === over.id) return;
        const from = order.indexOf(active.id);
        const to = order.indexOf(over.id);
        if (from >= 0 && to >= 0) save({ ...layout, order: arrayMove(order, from, to) });
      }}>
        <SortableContext items={order} strategy={rectSortingStrategy}>
          <div className={`grid gap-3 ${grids[layout.columns]}`}>
            {order.map((id) => <StationTile key={id} station={byId.get(id)} preview={layout.preview} ar={ar} canControl={canControl} />)}
          </div>
        </SortableContext>
      </DndContext>
    </section>
  );
}

export function MultiviewPage() {
  const { language, stations } = useMcrStore();
  const user = useOutletContext();
  const key = 'mcr.multiview.' + JSON.stringify([user.organizationId, user.id]);
  const canControl = user.permissions.includes('*') || user.permissions.includes('station:control');
  return <MonitorWall key={key} storageKey={key} stations={stations} ar={language === 'ar'} canControl={canControl} />;
}
