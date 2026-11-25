import React, { useState } from 'react';
import { api, stationPath } from '../context/api.js';

const style = 'rounded border border-zinc-600 bg-zinc-950 px-3 py-1.5 disabled:opacity-50';
const defaults = { video: '', image: '', x: 5, y: 5, w: 20, h: 20 };

export function LocalProgramScene({ stationId, language, running, inputFrame, inputReady,
  secondInputFrame, secondInputReady, secondInputConfigured }) {
  const label = (en, ar) => language === 'ar' ? ar : en;
  const root = stationPath(stationId, '/program');
  const [draft, setDraft] = useState(defaults);
  const [scenes, setScenes] = useState([]);
  const [assets, setAssets] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const [workerPreview, setWorkerPreview] = useState(null);
  const [transition, setTransition] = useState('cut');
  const media = id => '/api/v1' + root + '/ads/assets/' + id + '/media';
  const change = (key, value) => {
    setWorkerPreview(null);
    setDraft(old => ({ ...old, [key]: value }));
  };
  const network = draft.type === 'network';
  const networkFrame = draft.input === 'secondary' ? secondInputFrame : inputFrame;
  const networkReady = draft.input === 'secondary' ? secondInputReady : inputReady;
  const canSave = (!draft.id || draft.name?.trim()) && (network || (draft.video && draft.image));
  async function run(work) {
    setBusy(true);
    setMessage('');
    try { await work(); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  async function load() {
    const [saved, library] = await Promise.all([api(root + '/local-scene/library'), api(root + '/ads')]);
    setScenes(saved.data);
    setWorkerPreview(null);
    setDraft(saved.data.find(scene => scene.id === draft.id) ?? saved.data[0] ?? defaults);
    setAssets(library.data.assets);
    setLoaded(true);
  }
  async function save() {
    await api(root + '/local-scene', { method:'PUT', body:draft });
    setScenes(previous => previous.some(scene => scene.id === draft.id)
      ? previous.map(scene => scene.id === draft.id ? draft : scene)
      : [...previous, draft]);
  }
  return <details onToggle={event => { if (event.currentTarget.open && !loaded) void run(load); }}>
    <summary className="cursor-pointer py-2 font-semibold">{label('Program scenes', 'مشاهد Program')}</summary>
    <p className="text-sm text-zinc-300">{label('Choose imported creatives from the ad library. New imports retain their audio for Program. Preview is muted.', 'اختر ملفات مستوردة من مكتبة الإعلانات. يحتفظ الاستيراد الجديد بصوت الفيديو للبث. المعاينة صامتة.')}</p>
    <fieldset disabled={busy || !loaded} className="my-2 space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm">{label('Saved scenes', 'المشاهد المحفوظة')}
          <select className={style} value={scenes.some(scene => scene.id === draft.id) ? draft.id ?? 'legacy' : ''}
            onChange={event => {
              const scene = scenes.find(entry => (entry.id ?? 'legacy') === event.target.value);
              if (scene) { setDraft(scene); setMessage(''); setWorkerPreview(null); }
            }}>
            <option value="" disabled>{label('Unsaved scene', 'مشهد غير محفوظ')}</option>
            {scenes.map(scene => <option key={scene.id ?? 'legacy'} value={scene.id ?? 'legacy'}>
              {scene.name ?? label('Original scene', 'المشهد الأصلي')}</option>)}
          </select>
        </label>
        <button type="button" className={style} onClick={() => {
          setDraft({ ...defaults, id: crypto.randomUUID(), name: '' });
          setWorkerPreview(null);
          setMessage('');
        }}>{label('New scene', 'مشهد جديد')}</button>
        <button type="button" className={style} onClick={() => {
          setDraft({ id:crypto.randomUUID(), name:'', type:'network' });
          setWorkerPreview(null);
          setMessage('');
        }}>{label('New network scene', 'مشهد شبكي جديد')}</button>
      </div>
      <label className="grid gap-1 text-sm">{label('Scene name', 'اسم المشهد')}
        <input className={style} maxLength={80} value={draft.name ?? ''}
          onChange={event => change('name', event.target.value)} />
      </label>
      <div className="relative aspect-video overflow-hidden rounded border border-zinc-700 bg-black" aria-label={label('Scene Preview', 'معاينة المشهد')}>
        {network && (networkFrame
          ? <img className="h-full w-full object-contain" src={networkFrame} alt={label('Network input', 'المدخل الشبكي')} />
          : <p className="p-2 text-sm">{label('Waiting for network input', 'بانتظار المدخل الشبكي')}</p>)}
        {!network && workerPreview && running && <img className="h-full w-full object-contain" src={workerPreview}
          alt={label('Worker-rendered scene frame', 'لقطة المشهد من محرك البث')} />}
        {!network && (!workerPreview || !running) && draft.video && <video className="absolute inset-0 h-full w-full object-fill" autoPlay loop muted playsInline src={media(draft.video)} />}
        {(!workerPreview || !running) && draft.image && <img alt="" className="absolute" src={media(draft.image)}
          style={{left:draft.x+'%',top:draft.y+'%',width:draft.w+'%',height:draft.h+'%'}} />}
      </div>
      {network && <label className="grid gap-1 text-sm">{label('Network input', 'المدخل الشبكي')}
        <select className={style} value={draft.input ?? 'primary'} onChange={event => change('input', event.target.value)}>
          <option value="primary">{label('Primary input', 'المدخل الأول')}</option>
          <option value="secondary" disabled={!secondInputConfigured}>{label('Input 2', 'المدخل الثاني')}</option>
        </select>
      </label>}
      {!network && <div className="grid grid-cols-2 gap-2">
        {['video','image'].map(kind => <label key={kind} className="grid gap-1 text-sm">
          {kind === 'video' ? label('Background video','فيديو الخلفية') : label('Overlay image','الصورة فوق الفيديو')}
          <select className={style} value={draft[kind]} onChange={e => change(kind,e.target.value)}>
            <option value="">{label('Select file','اختر ملفًا')}</option>
            {assets.filter(a => a.kind === kind).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>)}
        {Object.entries({x:label('Left %','من اليسار %'),y:label('Top %','من الأعلى %'),w:label('Width %','العرض %'),h:label('Height %','الارتفاع %')}).map(([key,title]) =>
          <label key={key} className="grid gap-1 text-sm">{title}<input type="number" className={style}
            min={key === 'w' || key === 'h' ? 5 : 0} max={key === 'w' || key === 'h' ? 100 : 95}
            value={draft[key]} onChange={e => change(key,e.target.value === '' ? '' : Number(e.target.value))}/></label>)}
      </div>}
      <div className="flex flex-wrap gap-2">
        <label className="flex items-center gap-2 text-sm">{label('Transition', 'الانتقال')}
          <select className={style} value={transition} onChange={event => setTransition(event.target.value)}>
            <option value="cut">{label('Cut', 'قطع مباشر')}</option>
            <option value="fade">{label('Fade from black', 'ظهور تدريجي من السواد')}</option>
          </select>
        </label>
        {!network && <button type="button" className={style} disabled={!running || !canSave} onClick={() => run(async () => {
          if (workerPreview) { setWorkerPreview(null); return; }
          const { data } = await api(root + '/local-scene/preview', { method:'POST', body:draft });
          setWorkerPreview(data);
        })}>{workerPreview && running ? label('Resume moving preview', 'استئناف المعاينة المتحركة')
          : label('Preview worker frame', 'معاينة لقطة من المحرك')}</button>}
        <button className={style} onClick={() => run(load)}>{label('Reload scene and library','إعادة تحميل المشهد والمكتبة')}</button>
        <button className={style} disabled={!canSave} onClick={() => run(async () => {
          await save(); setMessage(label('Scene saved','تم حفظ المشهد'));
        })}>{label('Save scene','حفظ المشهد')}</button>
        <button className={style} disabled={!running || !canSave || (network && !networkReady)} onClick={() => run(async () => {
          await save(); await api(root + '/local-scene/take?transition=' + transition,{method:'POST',body:draft});
          setMessage(label('Scene taken to Program','تم أخذ المشهد إلى البث'));
        })}>{label('Take scene','أخذ المشهد')}</button>
      </div>
    </fieldset>
    <p role="status" className="text-sm">{message}</p>
  </details>;
}
