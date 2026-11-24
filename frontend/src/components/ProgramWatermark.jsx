import React, { useEffect, useState } from 'react';
import { watermarkBounds } from '@mcr/shared';
import { api, stationPath } from '../context/api.js';

const en = { title: 'Program watermark', preview: 'Watermark Preview', enabled: 'Enable watermark',
  choose: 'Use station logo', upload: 'Upload logo', anchor: 'Anchor', x: 'Horizontal inset (%)', y: 'Vertical inset (%)',
  size: 'Width (% of canvas)', opacity: 'Opacity (%)', apply: 'Apply to Program', reload: 'Reload saved settings',
  corners: ['Top left', 'Top right', 'Bottom left', 'Bottom right'], saved: 'Saved for next start', live: 'Applied to Program',
  pending: 'Pending changes', waiting: 'Waiting for worker', empty: 'Preview canvas', invalid: 'Choose a PNG, JPEG or WebP up to 512 KB.' };
const ar = { title: 'شعار البرنامج', preview: 'معاينة الشعار', enabled: 'تفعيل الشعار', choose: 'استخدام شعار المحطة',
  upload: 'رفع شعار', anchor: 'موضع الارتكاز', x: 'الهامش الأفقي (%)', y: 'الهامش الرأسي (%)', size: 'العرض (% من اللوحة)',
  opacity: 'العتامة (%)', apply: 'تطبيق على البرنامج', reload: 'إعادة تحميل الإعدادات المحفوظة',
  corners: ['أعلى اليسار', 'أعلى اليمين', 'أسفل اليسار', 'أسفل اليمين'], saved: 'محفوظ للتشغيل القادم',
  live: 'طُبّق على البرنامج', pending: 'تعديلات معلقة', waiting: 'بانتظار محرك البث', empty: 'لوحة المعاينة',
  invalid: 'اختر صورة PNG أو JPEG أو WebP بحجم لا يتجاوز 512 كيلوبايت.' };
const anchors = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const control = 'rounded border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-sm disabled:opacity-50';

export function ProgramWatermark({ stationId, language, status }) {
  const t = language === 'ar' ? ar : en;
  const path = stationPath(stationId, '/program/watermark');
  const [opened, setOpened] = useState(false);
  const [record, setRecord] = useState(null);
  const [draft, setDraft] = useState(null);
  const [reload, setReload] = useState(0);
  const [frame, setFrame] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const running = status.state === 'running';

  useEffect(() => {
    if (!opened) return;
    const abort = new AbortController();
    api(path, { signal: abort.signal }).then(({ data }) => {
      if (!abort.signal.aborted) { setRecord(data); setDraft(data.settings); setError(''); }
    }).catch(err => { if (!abort.signal.aborted) setError(err.message); });
    return () => abort.abort();
  }, [path, reload, opened]);

  useEffect(() => {
    if (!opened || !running) { setFrame(null); return; }
    const abort = new AbortController();
    let timer;
    async function refresh() {
      try {
        const { data } = await api(path + '/preview', { signal: abort.signal });
        if (!abort.signal.aborted) setFrame(data);
      } catch { if (!abort.signal.aborted) setFrame(null); }
      finally { if (!abort.signal.aborted) timer = setTimeout(refresh, 1000); }
    }
    void refresh();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [path, opened, running]);

  const change = (key, value) => setDraft(old => ({ ...old, [key]: value }));
  const dirty = record && JSON.stringify(record.settings) !== JSON.stringify(draft);
  async function upload(file) {
    if (!file) return;
    if (file.size > 512 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError(t.invalid); return; }
    setBusy(true);
    try {
      const reader = new FileReader();
      const image = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const check = new Image();
      check.src = image;
      await check.decode();
      change('image', image);
      setError('');
    } catch { setError(t.invalid); }
    finally { setBusy(false); }
  }
  async function apply(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const { revision } = await api(path, { method: 'PUT', body: { ...draft, revision: record.revision } });
      setRecord({ ...record, settings: draft, revision });
      setError('');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  const box = draft && watermarkBounds(draft, record.canvas);
  return <details onToggle={e => setOpened(e.currentTarget.open)}>
    <summary className="cursor-pointer py-2 font-semibold">{t.title}</summary>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {opened && draft && <form onSubmit={apply}>
      <fieldset disabled={busy} className="grid gap-3 md:grid-cols-2">
        <figure><figcaption className="mb-1 text-sm">{t.preview}</figcaption>
          <svg role="img" aria-label={t.preview} viewBox={`0 0 ${record.canvas.width} ${record.canvas.height}`}
            className="w-full rounded border border-zinc-700 bg-zinc-950">
            {frame && <image href={frame} width="100%" height="100%" />}
            {draft.enabled && draft.image && <image href={draft.image} x={box.left} y={box.top} width={box.width} height={box.height}
              opacity={draft.opacity / 100} preserveAspectRatio={`${box.right ? 'xMax' : 'xMin'}${box.bottom ? 'YMax' : 'YMin'} meet`} />}
          </svg>
          {!frame && <small>{t.empty} · {record.canvas.width} × {record.canvas.height}</small>}
        </figure>
        <div className="grid gap-2">
          <label><input type="checkbox" checked={draft.enabled} onChange={e => change('enabled', e.target.checked)} /> {t.enabled}</label>
          <label className="grid text-sm">{t.upload}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => upload(e.target.files[0])} /></label>
          {record.stationLogo && <button type="button" className={control} onClick={() => change('image', record.stationLogo)}>{t.choose}</button>}
          <label className="grid text-sm">{t.anchor}<select className={control} value={draft.anchor} onChange={e => change('anchor', e.target.value)}>
            {anchors.map((anchor, i) => <option key={anchor} value={anchor}>{t.corners[i]}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-2">{['x', 'y', 'size', 'opacity'].map(key =>
            <label className="grid text-sm" key={key}>{t[key]}<input className={control} type="number" step="any" required
              min={key === 'size' ? 1 : 0} max={key === 'x' || key === 'y' ? 95 : 100}
              value={draft[key]} onChange={e => change(key, e.target.value === '' ? '' : Number(e.target.value))} /></label>)}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:col-span-2">
          <button className={control} disabled={!dirty || (draft.enabled && !draft.image)}>{t.apply}</button>
          <button type="button" className={control} onClick={() => setReload(n => n + 1)}>{t.reload}</button>
          <span role="status" className="text-sm">{dirty ? t.pending : !running ? t.saved : status.watermarkRevision === record.revision ? t.live : t.waiting}</span>
        </div>
      </fieldset>
    </form>}
  </details>;
}
