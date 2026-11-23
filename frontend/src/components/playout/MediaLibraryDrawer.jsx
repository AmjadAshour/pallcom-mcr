import React, { useId } from 'react';
import { formatDuration } from './usePlayout.js';

const field = 'w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm';
const button = 'rounded border border-zinc-700 px-3 py-2 text-xs font-semibold disabled:opacity-50';

export function MediaLibraryDrawer({ assets, search, setSearch, onScan, scanning, report, add, close, ar, canEdit }) {
  const filtered = assets.filter((asset) => asset.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return (
    <aside className="space-y-3 rounded-lg border border-zinc-700 bg-zinc-900 p-4" aria-label={ar ? 'مكتبة الوسائط' : 'Media library'}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{ar ? 'مكتبة الوسائط على جهاز OBS' : 'Media library on the OBS machine'}</h2>
        <div className="flex gap-2">
          <button className={button} disabled={scanning || !canEdit} onClick={onScan}>{scanning ? (ar ? 'جارٍ الفحص…' : 'Scanning…') : (ar ? 'فحص المجلدات' : 'Scan folders')}</button>
          <button className={button} onClick={close}>{ar ? 'إغلاق' : 'Close'}</button>
        </div>
      </header>
      <input className={field} type="search" value={search} placeholder={ar ? 'بحث عن ملف' : 'Search assets'}
        aria-label={ar ? 'بحث عن ملف' : 'Search assets'} onChange={(event) => setSearch(event.target.value)} />
      {report && <p role="status" className="text-xs text-amber-300">{report}</p>}
      <ul className="max-h-80 space-y-2 overflow-auto">
        {filtered.map((asset) => <li key={asset.assetId} className="flex flex-wrap items-center justify-between gap-2 rounded bg-zinc-950 p-2">
          <div className="min-w-0">
            <strong className="block break-all text-sm">{asset.title}</strong>
            <span className={asset.health === 'ready' ? 'text-xs text-zinc-400' : 'text-xs text-red-300'}>
              {asset.health === 'ready' ? `${formatDuration(asset.durationMs, true)} · ${asset.width ?? '—'}×${asset.height ?? '—'}`
                : (ar ? 'غير جاهز للبث' : 'Unusable asset')}
            </span>
          </div>
          <div className="flex gap-2">
            <button className={button} disabled={!canEdit || asset.health !== 'ready'} onClick={() => add(asset, 'items')}>{ar ? 'أضف للجدول' : 'Add to timeline'}</button>
            <button className={button} disabled={!canEdit || asset.health !== 'ready'} onClick={() => add(asset, 'filler')}>{ar ? 'أضف للاحتياط' : 'Add to filler'}</button>
          </div>
        </li>)}
        {!filtered.length && <li className="text-sm text-zinc-400">{ar ? 'لا توجد نتائج.' : 'No matching assets.'}</li>}
      </ul>
    </aside>
  );
}

export function AddLiveBlock({ add, scenes, ar, canEdit }) {
  const scenesId = useId();
  return <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const sceneName = String(data.get('sceneName')).trim();
    const title = String(data.get('title')).trim() || sceneName;
    const seconds = Number(data.get('seconds'));
    if (!sceneName || !Number.isFinite(seconds) || seconds < 1 || seconds > 86400) return;
    add({ id: crypto.randomUUID(), kind: 'live', category: 'live', sceneName, title, durationMs: Math.round(seconds * 1000), hardStartAt: null });
    form.reset();
  }}>
    <label className="text-xs text-zinc-400">{ar ? 'اسم الفقرة' : 'Block title'}
      <input name="title" maxLength={250} className={field + ' mt-1'} disabled={!canEdit} /></label>
    <label className="text-xs text-zinc-400">{ar ? 'مشهد OBS للبث المباشر' : 'OBS live feed scene'}
      <input list={scenesId} name="sceneName" required maxLength={250} className={field + ' mt-1'} disabled={!canEdit} />
      <datalist id={scenesId}>{scenes.map(({ name }) => <option value={name} key={name} />)}</datalist></label>
    <label className="text-xs text-zinc-400">{ar ? 'المدة بالثواني' : 'Duration in seconds'}
      <input name="seconds" type="number" step="0.001" min="1" max="86400" defaultValue="60" required className={field + ' mt-1'} disabled={!canEdit} /></label>
    <button className={button} disabled={!canEdit}>{ar ? 'أضف فقرة مباشرة' : 'Add live feed block'}</button>
  </form>;
}
