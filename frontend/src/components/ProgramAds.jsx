import React, { useEffect, useRef, useState } from 'react';
import { adLayer, placementOrder } from '@mcr/shared';
import { api, stationPath } from '../context/api.js';
import { useMonitorFrame } from '../context/useProgramMonitor.js';

const button = 'rounded border border-zinc-600 px-3 py-1.5 text-sm disabled:opacity-50';
const input = 'w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm';
const stripWindow = ({ start, end, ...fields }) => fields;
const strip = (p) => ({ ...stripWindow(p), items: p.items.map(stripWindow) });
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function NumberField({ label, value, onChange, min, max }) {
  return (
    <label className="grid text-xs text-zinc-300">
      {label}
      <input
        className={input}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      />
    </label>
  );
}
function VideoFrame({ url, elapsed, frames }) {
  const ref = useRef(null);
  useEffect(() => {
    const video = ref.current;
    const align = () => {
      const t = (elapsed % (frames * 80)) / 1000;
      if (Math.abs(video.currentTime - t) > 0.09) video.currentTime = t;
    };
    if (video.readyState >= 1) align();
    video.addEventListener('loadedmetadata', align);
    return () => video.removeEventListener('loadedmetadata', align);
  }, [elapsed, frames]);
  return <video ref={ref} src={url} muted playsInline preload="auto" className="h-full w-full object-fill" />;
}
function Preview({ placements, assets, path, origin, background }) {
  const [clock, setClock] = useState(performance.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(performance.now()), 80);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="relative aspect-video overflow-hidden rounded border border-zinc-700 bg-black" dir="ltr">
      {background && <img alt="" src={background} className="absolute inset-0 h-full w-full" />}
      {[...placements].sort(placementOrder).map((p) => {
        const layer = adLayer(
          { ...p, start: null, end: null },
          { anchor: origin, offset: 0, paused: false },
          0,
          clock
        );
        const asset = assets.find((a) => a.id === layer?.asset);
        const rect = layer ?? p;
        const url = asset && '/api/v1' + path + '/assets/' + asset.id + '/media';
        return (
          <div
            key={p.id}
            className="absolute"
            style={{
              left: rect.x + '%',
              top: rect.y + '%',
              width: p.w + '%',
              height: p.h + '%',
              opacity: layer?.alpha ?? 0
            }}
          >
            {asset &&
              (asset.kind === 'video' ? (
                <VideoFrame url={url} elapsed={layer.elapsed} frames={asset.frames} />
              ) : (
                <img alt="" src={url} className="h-full w-full object-fill" />
              ))}
          </div>
        );
      })}
      {placements.map((p) => (
        <div
          key={p.id}
          className="pointer-events-none absolute border border-dashed border-white/70"
          style={{ left: p.x + '%', top: p.y + '%', width: p.w + '%', height: p.h + '%' }}
        >
          <span className="bg-black/70 px-1 text-xs text-white">
            {p.name} · {p.z}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ProgramAds({ stationId, language, status }) {
  const l = (en, ar) => (language === 'ar' ? ar : en);
  const path = stationPath(stationId, '/program/ads');
  const [opened, setOpened] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [assets, setAssets] = useState([]),
    [plan, setPlan] = useState(null),
    [placements, setPlacements] = useState([]);
  const [zone, setZone] = useState('UTC'),
    [selected, setSelected] = useState(''),
    [creative, setCreative] = useState('');
  const [origin, setOrigin] = useState(performance.now());
  const background = useMonitorFrame(stationPath(stationId, '/program/watermark/preview'),
    opened && status.state === 'running', 3000);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const p = placements.find((p) => p.id === selected);
  const dirty =
    plan && (JSON.stringify(placements) !== JSON.stringify(plan.placements.map(strip)) || zone !== plan.zone);
  async function perform(work) {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError(e.details?.map((i) => i.field + ' ' + i.message).join(', ') || e.message);
    } finally {
      setBusy(false);
    }
  }
  function accept(next) {
    setPlan(next);
    setPlacements(next.placements.map(strip));
    setZone(next.zone);
    setSelected((old) => (next.placements.some((p) => p.id === old) ? old : (next.placements[0]?.id ?? '')));
  }
  async function load() {
    const { data } = await api(path);
    setAssets(data.assets);
    accept(data.plan);
    setCreative(data.assets[0]?.id ?? '');
    setLoaded(true);
  }
  function edit(fields) {
    setPlacements((old) => old.map((entry) => (entry.id === selected ? { ...entry, ...fields } : entry)));
  }
  function changeItem(i, fields) {
    edit({ items: p.items.map((row, index) => (index === i ? { ...row, ...fields } : row)) });
  }
  function reorder(i, step) {
    const items = [...p.items];
    [items[i], items[i + step]] = [items[i + step], items[i]];
    edit({ items });
  }
  const intersections = placements.flatMap((a, i) =>
    placements
      .slice(i + 1)
      .filter((b) => overlap(a, b))
      .map((b) => a.name + ' / ' + b.name)
  );
  return (
    <details
      onToggle={(e) => {
        const open = e.currentTarget.open;
        setOpened(open);
        if (open && !loaded) void perform(load);
      }}
    >
      <summary className="cursor-pointer py-2 font-semibold">{l('Ad placements', 'مواضع الإعلانات')}</summary>
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      {opened && loaded && (
        <fieldset disabled={busy} className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid text-sm">
              {l('Ad library', 'مكتبة الإعلانات')}
              <select className={input} value={creative} onChange={(e) => setCreative(e.target.value)}>
                {!assets.length && <option value="">—</option>}
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.kind})
                  </option>
                ))}
              </select>
            </label>
            <label className="grid text-sm">
              {l('Add image or MP4 (30 s max)', 'إضافة صورة أو MP4 (حتى 30 ثانية)')}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,video/mp4"
                onChange={(e) => {
                  const file = e.target.files[0];
                  e.target.value = '';
                  if (!file) return;
                  void perform(async () => {
                    if (file.size > 12 * 1024 * 1024)
                      throw Error(l('Maximum upload is 12 MB', 'حد الرفع 12 ميغابايت'));
                    const { data } = await api(path + '/assets?name=' + encodeURIComponent(file.name), {
                      method: 'POST',
                      body: file
                    });
                    setAssets((old) => [...old, data]);
                    setCreative(data.id);
                  });
                }}
              />
            </label>
            <button
              className={button}
              disabled={!creative || placements.some((p) => p.items.some((i) => i.asset === creative))}
              onClick={() =>
                void perform(async () => {
                  if (!window.confirm(l('Remove this creative from the library?', 'حذف الإعلان من المكتبة؟')))
                    return;
                  await api(path + '/assets/' + creative, { method: 'DELETE' });
                  const remaining = assets.filter((a) => a.id !== creative);
                  setAssets(remaining);
                  setCreative(remaining[0]?.id ?? '');
                })
              }
            >
              {l('Remove creative', 'حذف الإعلان')}
            </button>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <h3>{l('Placement Preview', 'معاينة المواضع')}</h3>
              <Preview
                placements={placements}
                assets={assets}
                path={path}
                origin={origin}
                background={background}
              />
              <button className={button} onClick={() => setOrigin(performance.now())}>
                {l('Replay draft playlists', 'إعادة معاينة القوائم')}
              </button>
              <small className="block">
                {l(
                  'Preview auditions enabled playlists outside their schedule windows.',
                  'تعرض المعاينة القوائم المفعّلة بصرف النظر عن الجدول الزمني.'
                )}
              </small>
              {intersections.length > 0 && (
                <p className="text-sm text-amber-300">
                  {l('Overlapping boxes', 'المواضع المتداخلة')} · {intersections.join(', ')}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <label className="grid text-sm">
                {l('Schedule time zone (IANA)', 'المنطقة الزمنية للجدول (IANA)')}
                <input className={input} value={zone} onChange={(e) => setZone(e.target.value)} />
              </label>
              <div className="flex flex-wrap gap-2">
                {placements.map((entry) => (
                  <button
                    className={button}
                    aria-pressed={selected === entry.id}
                    key={entry.id}
                    onClick={() => setSelected(entry.id)}
                  >
                    {entry.name}
                  </button>
                ))}
                <button
                  className={button}
                  disabled={placements.length >= 4}
                  onClick={() => {
                    const id = crypto.randomUUID();
                    setPlacements([
                      ...placements,
                      {
                        id,
                        name: l('Placement ', 'موضع ') + (placements.length + 1),
                        enabled: true,
                        x: 5,
                        y: 5,
                        w: 25,
                        h: 20,
                        z: placements.length,
                        startLocal: '',
                        endLocal: '',
                        items: []
                      }
                    ]);
                    setSelected(id);
                  }}
                >
                  {l('Add placement', 'إضافة موضع')}
                </button>
              </div>
              {p && (
                <>
                  <label className="grid text-sm">
                    {l('Placement name', 'اسم الموضع')}
                    <input
                      className={input}
                      value={p.name}
                      onChange={(e) => edit({ name: e.target.value })}
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      onChange={(e) => edit({ enabled: e.target.checked })}
                    />{' '}
                    {l('Enable placement', 'تفعيل الموضع')}
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      ['x', 'X %'],
                      ['y', 'Y %'],
                      ['w', l('Width %', 'العرض %')],
                      ['h', l('Height %', 'الارتفاع %')],
                      ['z', l('Layer', 'الطبقة')]
                    ].map(([k, label]) => (
                      <NumberField
                        key={k}
                        label={label}
                        value={p[k]}
                        min={0}
                        max={k === 'z' ? 999 : 100}
                        onChange={(v) => edit({ [k]: v })}
                      />
                    ))}
                  </div>
                  {[
                    ['startLocal', l('Scheduled start', 'بدء مجدول')],
                    ['endLocal', l('Scheduled end', 'انتهاء مجدول')]
                  ].map(([k, label]) => (
                    <label key={k} className="grid text-sm">
                      {label}
                      <input
                        type="datetime-local"
                        className={input}
                        value={p[k]}
                        onChange={(e) => edit({ [k]: e.target.value })}
                      />
                    </label>
                  ))}
                  <button
                    className={button}
                    onClick={() => {
                      setPlacements(placements.filter((other) => other.id !== selected));
                      setSelected(placements.find((other) => other.id !== selected)?.id ?? '');
                    }}
                  >
                    {l('Remove placement', 'إزالة الموضع')}
                  </button>
                </>
              )}
            </div>
          </div>
          {p && (
            <div className="space-y-2">
              <h3>
                {l('Playlist', 'قائمة التشغيل')} · {p.name}
              </h3>
              {p.items.map((item, index) => (
                <div key={index} className="space-y-2 rounded border border-zinc-700 p-2">
                  <div className="flex flex-wrap gap-2">
                    <select
                      aria-label={l('Creative', 'الإعلان')}
                      className={button + ' bg-zinc-950'}
                      value={item.asset}
                      onChange={(e) => changeItem(index, { asset: e.target.value })}
                    >
                      {assets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                    {[-1, 1].map((step) => (
                      <button
                        className={button}
                        key={step}
                        disabled={index + step < 0 || index + step >= p.items.length}
                        onClick={() => reorder(index, step)}
                      >
                        {step < 0 ? l('Earlier', 'تقديم') : l('Later', 'تأخير')}
                      </button>
                    ))}
                    <button
                      className={button}
                      onClick={() => edit({ items: p.items.filter((_, i) => i !== index) })}
                    >
                      {l('Remove item', 'إزالة العنصر')}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
                    {[
                      ['duration', l('Display ms', 'العرض مللي ثانية')],
                      ['gap', l('Gap ms', 'الفاصل مللي ثانية')],
                      ['enter', l('Fade in ms', 'الظهور مللي ثانية')],
                      ['exit', l('Fade out ms', 'الاختفاء مللي ثانية')],
                      ['dx', l('Move X %', 'حركة X %')],
                      ['dy', l('Move Y %', 'حركة Y %')]
                    ].map(([k, label]) => (
                      <NumberField
                        key={k}
                        label={label}
                        value={item[k]}
                        onChange={(v) => changeItem(index, { [k]: v })}
                      />
                    ))}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      ['startLocal', l('Ad eligible from', 'بدء أهلية الإعلان')],
                      ['endLocal', l('Ad eligible until', 'نهاية أهلية الإعلان')]
                    ].map(([k, label]) => (
                      <label key={k} className="grid text-xs">
                        {label}
                        <input
                          type="datetime-local"
                          className={input}
                          value={item[k] ?? ''}
                          onChange={(e) => changeItem(index, { [k]: e.target.value })}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <button
                className={button}
                disabled={!creative || p.items.length >= 40}
                onClick={() =>
                  edit({
                    items: [
                      ...p.items,
                      { asset: creative, duration: 5000, gap: 0, enter: 0, exit: 0, dx: 0, dy: 0 }
                    ]
                  })
                }
              >
                {l('Append selected creative', 'إضافة الإعلان المحدد للقائمة')}
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              className={button}
              disabled={!dirty}
              onClick={() =>
                void perform(async () => {
                  accept(
                    (await api(path, { method: 'PUT', body: { zone, placements, revision: plan.revision } }))
                      .data
                  );
                })
              }
            >
              {l('Apply ads to Program', 'تطبيق الإعلانات على البرنامج')}
            </button>
            <button className={button} onClick={() => void perform(load)}>
              {l('Reload saved plan', 'إعادة تحميل الجدول المحفوظ')}
            </button>
            <span role="status">
              {dirty
                ? l('Preview edits', 'تعديلات المعاينة')
                : status.state !== 'running'
                  ? l('Saved', 'محفوظ')
                  : status.adsRevision === plan.revision
                    ? l('Applied', 'تم التطبيق')
                    : l('Applying', 'جارٍ التطبيق')}
            </span>
          </div>
          {plan.placements.length > 0 && (
            <div className="space-y-2">
              <h3>{l('Program controls', 'تحكم البرنامج')}</h3>
              {status.state === 'running' && <p className="text-sm">{l('Visible placements','المواضع الظاهرة')} · {status.visibleAds?.length ?? 0} / {plan.placements.length}</p>}
              {plan.placements.map((entry) => {
                const tr = plan.transport[entry.id];
                return (
                  <div key={entry.id} className="flex flex-wrap items-center gap-2">
                    <strong>{entry.name}</strong>
                    {!entry.enabled || tr.disabled ? (
                      <span>{l('Disabled', 'معطل')}</span>
                    ) : (
                      ['pause', 'skip', 'disable'].map((key) => {
                        const action = key === 'pause' && tr.paused ? 'resume' : key;
                        return (
                          <button
                            key={key}
                            className={button}
                            onClick={() =>
                              void perform(async () => {
                                const next = (
                                  await api(path + '/control', {
                                    method: 'POST',
                                    body: { action, id: entry.id, revision: plan.revision }
                                  })
                                ).data;
                                setPlan(next);
                                if (action === 'disable')
                                  setPlacements((old) =>
                                    old.map((p) => (p.id === entry.id ? { ...p, enabled: false } : p))
                                  );
                              })
                            }
                          >
                            {
                              {
                                pause: l('Pause', 'إيقاف مؤقت'),
                                resume: l('Resume', 'متابعة'),
                                skip: l('Skip', 'تخطي'),
                                disable: l('Disable now', 'تعطيل الآن')
                              }[action]
                            }
                          </button>
                        );
                      })
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </fieldset>
      )}
    </details>
  );
}
