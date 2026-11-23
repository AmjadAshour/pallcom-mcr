import React, { useEffect, useId, useState } from 'react';
import { api } from '../../context/api.js';
import { formatWallClock } from './usePlayout.js';

const field = 'mt-1 block w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-sm';
const action = 'rounded border border-zinc-700 px-3 py-2 text-xs font-semibold disabled:opacity-50';

export function PlayoutSettings({ plan, change, scenes, busy, dirty, running, ready, canEdit, act, ar }) {
  const list = useId();
  const decks = [plan.decks[0] || { sceneName: '', inputName: '' }, plan.decks[1] || { sceneName: '', inputName: '' }];
  const { graphics } = plan;
  const text = ar
    ? { logo: 'اللوغو', lowerThird: 'شريط الآن / التالي', ticker: 'شريط الأخبار' }
    : { logo: 'Logo / bug', lowerThird: 'Now / next lower third', ticker: 'News ticker' };

  function updateDeck(index, key, value) {
    const next = decks.map((deck, position) => position === index ? { ...deck, [key]: value } : deck);
    change('decks', next.some((deck) => deck.sceneName || deck.inputName) ? next : []);
  }

  return <div className="grid gap-4 lg:grid-cols-2">
    <section className="space-y-3 rounded-lg border border-zinc-800 p-4">
      <h2 className="font-semibold">{ar ? 'مشاهد ومشغّلات OBS' : 'OBS decks and backup'}</h2>
      <p className="text-xs text-zinc-400">{ar
        ? 'أنشئ مشهدين منفصلين، ولكل منهما مصدر وسائط خاص به. جهّز المشهد الاحتياطي ليعرض إشارة عند نفاد الجدول.'
        : 'Create two separate scenes with a dedicated Media Source in each. Keep the backup scene ready for continuity.'}</p>
      <datalist id={list}>{scenes.map(({ name }) => <option key={name} value={name} />)}</datalist>
      {decks.map((deck, index) => <fieldset key={index} className="grid gap-2 rounded border border-zinc-800 p-2 sm:grid-cols-2" disabled={running || !canEdit}>
        <legend className="px-1 text-xs text-cyan-200">{ar ? 'المشغّل' : 'Deck'} {index === 0 ? 'A' : 'B'}</legend>
        <label className="text-xs text-zinc-400">{ar ? 'المشهد' : 'Scene'}
          <input list={list} value={deck.sceneName} onChange={(event) => updateDeck(index, 'sceneName', event.target.value)} className={field} maxLength={250} /></label>
        <label className="text-xs text-zinc-400">{ar ? 'اسم مصدر الوسائط' : 'Media Source name'}
          <input value={deck.inputName} onChange={(event) => updateDeck(index, 'inputName', event.target.value)} className={field} maxLength={250} /></label>
      </fieldset>)}
      <label className="block text-xs text-zinc-400">{ar ? 'مشهد الاحتياط والطوارئ' : 'Backup / emergency scene'}
        <input list={list} value={plan.backupScene} onChange={(event) => change('backupScene', event.target.value)} disabled={!canEdit} className={field} maxLength={250} />
      </label>
    </section>
    <section className="space-y-3 rounded-lg border border-zinc-800 p-4">
      <h2 className="font-semibold">{ar ? 'أتمتة الجرافيكس' : 'OBS graphics automation'}</h2>
      {Object.entries(text).map(([key, title]) => <div className="flex items-end gap-2" key={key}>
        <label className="min-w-0 flex-1 text-xs text-zinc-400">{title}
          <input value={graphics[key + 'Source']} disabled={!canEdit} maxLength={250}
            onChange={(event) => change('graphics', { ...graphics, [key + 'Source']: event.target.value })} className={field} />
        </label>
        <button className={action} disabled={busy || dirty || !graphics[key + 'Source'] || !ready || !canEdit}
          aria-pressed={graphics[key]} onClick={() => act('overlay', { overlay: key, enabled: !graphics[key] })}>
          {graphics[key] ? (ar ? 'إخفاء الآن' : 'Hide now') : (ar ? 'إظهار الآن' : 'Show now')}
        </button>
      </div>)}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={graphics.hideLogoDuringAds} disabled={!canEdit}
          onChange={(event) => change('graphics', { ...graphics, hideLogoDuringAds: event.target.checked })} />
        {ar ? 'إخفاء اللوغو أثناء الفواصل الإعلانية' : 'Hide logo during ad breaks'}
      </label>
      <p className="text-xs text-zinc-400">{ar ? 'اكتب أسماء المصادر كما تظهر في OBS. شريط الآن / التالي يحتاج مصدر نص.' : 'Use the exact OBS source names. Now / next requires an OBS text source.'}</p>
    </section>
  </div>;
}

export function AsRunLog({ path, activeLogId, ar }) {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api(path + '/as-run', { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) { setLogs(data); setError(''); }
    }).catch((failure) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [path, activeLogId, refresh]);
  const columns = ar
    ? ['العنصر', 'التصنيف', 'الموعد', 'البدء الفعلي', 'النهاية الفعلية', 'النتيجة']
    : ['Item', 'Category', 'Planned', 'Actual start', 'Actual end', 'Outcome'];
  return <section className="space-y-3 rounded-lg border border-zinc-800 p-4">
    <header className="flex justify-between gap-2"><h2 className="font-semibold">{ar ? 'سجل البث الفعلي' : 'As-run log'}</h2>
      <button className={action} onClick={() => setRefresh((value) => value + 1)}>{ar ? 'تحديث' : 'Refresh'}</button></header>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {!logs.length ? <p className="text-sm text-zinc-400">{ar ? 'لا توجد سجلات بعد.' : 'No as-run records yet.'}</p> :
      <div className="overflow-auto"><table className="w-full whitespace-nowrap text-start text-xs">
        <thead><tr className="border-b border-zinc-700">{columns.map((name) => <th key={name} className="p-2 text-start">{name}</th>)}</tr></thead>
        <tbody>{logs.map((entry) => <tr className="border-b border-zinc-800" key={entry.id}>
          <td className="max-w-60 truncate p-2" title={entry.title}>{entry.title}</td><td className="p-2">{entry.category}</td>
          <td className="p-2" dir="ltr">{formatWallClock(entry.plannedAt, true)}</td>
          <td className="p-2" dir="ltr">{formatWallClock(entry.startedAt, true)}</td>
          <td className="p-2" dir="ltr">{formatWallClock(entry.endedAt, true)}</td>
          <td className="whitespace-normal p-2">{entry.outcome}{entry.detail ? ` · ${entry.detail}` : ''}</td>
        </tr>)}</tbody>
      </table></div>}
  </section>;
}
