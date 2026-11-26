import React, { useEffect, useState } from 'react';
import { api, stationPath } from '../context/api.js';

export function ProgramTicker({ stationId, language, status }) {
  const ar = language === 'ar';
  const path = stationPath(stationId, '/program/ticker');
  const [record, setRecord] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api(path, { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) { setRecord(data); setDraft(data.settings); setError(''); }
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [path, reload]);

  async function apply(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { data } = await api(path, { method: 'PUT', body: { ...draft, revision: record.revision } });
      setRecord(data);
      setDraft(data.settings);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  const change = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const applied = status.state === 'running' && status.tickerRevision === record?.revision;
  const dirty = draft && JSON.stringify(draft) !== JSON.stringify(record.settings);
  return <section className="space-y-3 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
    <h3 className="font-semibold">{ar ? 'الشريط الإخباري' : 'News ticker'}</h3>
    {draft && <form onSubmit={apply} className="space-y-3">
      <label className="block text-sm">
        {ar ? 'نص الشريط' : 'Headline text'}
        <textarea dir="auto" maxLength={400} rows={2} value={draft.text}
          className="mt-1 block w-full rounded border border-zinc-600 bg-zinc-950 p-2"
          onChange={event => change('text', event.target.value)} />
      </label>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={draft.enabled} onChange={event => change('enabled', event.target.checked)} />
          {ar ? 'إظهار أسفل البث' : 'Show at bottom of Program'}
        </label>
        <label className="flex items-center gap-2">
          {ar ? 'اتجاه الحركة' : 'Scroll direction'}
          <select className="rounded border border-zinc-600 bg-zinc-950 p-1" value={draft.direction}
            onChange={event => change('direction', event.target.value)}>
            <option value="left">{ar ? 'إلى اليسار' : 'Left'}</option>
            <option value="right">{ar ? 'إلى اليمين' : 'Right'}</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          {ar ? 'سرعة الحركة' : 'Scroll speed'}
          <input type="range" min={40} max={360} step={10} value={draft.speed}
            onChange={event => change('speed', Number(event.target.value))} />
          <output dir="ltr">{draft.speed} px/s</output>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button className="rounded border border-zinc-600 px-3 py-2 disabled:opacity-50" disabled={busy || !dirty || (draft.enabled && !draft.text.trim())}>
          {ar ? 'تطبيق الشريط على البث' : 'Apply ticker to Program'}
        </button>
        {!dirty && record.settings.enabled && <span role="status">
          {applied ? (ar ? 'ظاهر على خرج البث' : 'On Program output')
            : status.state === 'running' ? (ar ? 'بانتظار محرك البث' : 'Waiting for Program worker')
            : (ar ? 'محفوظ للتشغيل التالي' : 'Saved for next start')}
        </span>}
      </div>
    </form>}
    {error && <div className="flex gap-3 text-sm">
      <p role="alert" className="text-red-300">{error}</p>
      <button type="button" onClick={() => setReload(value => value + 1)}>{ar ? 'إعادة تحميل الإعدادات' : 'Reload settings'}</button>
    </div>}
  </section>;
}
