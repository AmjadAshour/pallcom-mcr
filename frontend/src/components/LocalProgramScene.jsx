import React, { useState } from 'react';
import { PROGRAM_SCENE_UPLOAD } from '@mcr/shared';
import { api, stationPath } from '../context/api.js';
import { programVideoUrl, uploadProgramVideo } from '../context/programVideo.js';

const style = 'rounded border border-zinc-600 bg-zinc-950 px-3 py-1.5 disabled:opacity-50';
const defaults = { video: '', image: '', x: 5, y: 5, w: 20, h: 20 };

export function LocalProgramScene({ stationId, language, running, inputFrame, inputReady,
  secondInputFrame, secondInputReady, secondInputConfigured, canSchedule }) {
  const label = (en, ar) => language === 'ar' ? ar : en;
  const root = stationPath(stationId, '/program');
  const [draft, setDraft] = useState(defaults);
  const [scenes, setScenes] = useState([]);
  const [events, setEvents] = useState([]);
  const [scheduleHeld, setScheduleHeld] = useState(false);
  const [scheduledTime, setScheduledTime] = useState('');
  const [reschedule, setReschedule] = useState(null);
  const [repeatDaily, setRepeatDaily] = useState(false);
  const [playlist, setPlaylist] = useState([]);
  const [fillerSceneId, setFillerSceneId] = useState('');
  const schedulePath = root + '/local-scene/schedule';
  const [assets, setAssets] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const [workerPreview, setWorkerPreview] = useState(null);
  const [transition, setTransition] = useState('cut');
  const media = id => programVideoUrl(root, id);
  const change = (key, value) => {
    setWorkerPreview(null);
    setDraft(old => ({ ...old, [key]: value }));
  };
  const network = draft.type === 'network';
  const networkFrame = draft.input === 'secondary' ? secondInputFrame : inputFrame;
  const networkReady = draft.input === 'secondary' ? secondInputReady : inputReady;
  const canSave = (!draft.id || draft.name?.trim()) && (network || Boolean(draft.video));
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
    await refreshSchedule();
    setLoaded(true);
  }
  async function save() {
    await api(root + '/local-scene', { method:'PUT', body:draft });
    setScenes(previous => previous.some(scene => scene.id === draft.id)
      ? previous.map(scene => scene.id === draft.id ? draft : scene)
      : [...previous, draft]);
  }
  async function uploadVideo(file) {
    await run(async () => {
      setMessage(label('Uploading and preparing video…', 'جارٍ رفع الفيديو وتجهيزه…'));
      const data = await uploadProgramVideo(root, file, language);
      setAssets(previous => [...previous, data]);
      setDraft({ ...defaults, id: crypto.randomUUID(), video: data.id,
        name: file.name.replace(/\.mp4$/i, '').trim().slice(0, 80) || label('Video scene', 'مشهد فيديو') });
      setWorkerPreview(null);
      setMessage(label('Video ready. Select Take scene to put it on Program.', 'الفيديو جاهز. اضغط أخذ المشهد لعرضه على البث.'));
    });
  }
  async function refreshSchedule() {
    const [events, hold] = await Promise.all([api(schedulePath),api(schedulePath+'-hold')]);
    setEvents(events.data);
    setScheduleHeld(hold.data.held);
  }
  return <details onToggle={event => { if (event.currentTarget.open && !loaded) void run(load); }}>
    <summary className="cursor-pointer py-2 font-semibold">{label('Program scenes', 'مشاهد Program')}</summary>
    <fieldset disabled={busy || !loaded} className="my-2 space-y-2">
      <label className="grid gap-1 rounded border border-zinc-700 px-3 py-2 text-sm">
        <span className="font-semibold">{label('Upload video to Program', 'رفع فيديو للبث')}</span>
        <input type="file" accept="video/mp4,.mp4" onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void uploadVideo(file);
        }} />
        <span className="text-xs text-zinc-400">{label(
          `MP4 up to ${PROGRAM_SCENE_UPLOAD.maxMib} MiB and ${PROGRAM_SCENE_UPLOAD.maxSeconds} seconds. Preview is muted.`,
          `ملف MP4 حتى ${PROGRAM_SCENE_UPLOAD.maxMib} ميبيبايت و${PROGRAM_SCENE_UPLOAD.maxSeconds} ثانية. المعاينة صامتة.`
        )}</span>
      </label>
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
          {kind === 'video' ? label('Background video','فيديو الخلفية') : label('Overlay image (optional)','صورة فوق الفيديو (اختيارية)')}
          <select className={style} value={draft[kind] ?? ''} onChange={e => change(kind,e.target.value)}>
            <option value="">{kind === 'image' ? label('No overlay','بدون صورة') : label('Select file','اختر ملفًا')}</option>
            {assets.filter(a => a.kind === kind).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>)}
        {draft.image && Object.entries({x:label('Left %','من اليسار %'),y:label('Top %','من الأعلى %'),w:label('Width %','العرض %'),h:label('Height %','الارتفاع %')}).map(([key,title]) =>
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
    {loaded && <div className="space-y-2">
      <h3 className="text-sm font-semibold">{label('Program schedule', 'جدول بث Program')}</h3>
      {scheduleHeld && <p role="status" className="text-sm text-amber-300">
        {label('Schedule on hold. Due events are skipped.', 'الجدول متوقف مؤقتًا. تُتجاوز المواعيد التي يحين وقتها.')}
      </p>}
      {canSchedule && <button type="button" disabled={busy} className={style} onClick={() => run(async () => {
        await api(schedulePath+'-hold',{method:'PUT',body:{held:!scheduleHeld}});
        await refreshSchedule();
      })}>{scheduleHeld ? label('Resume schedule', 'استئناف الجدول') : label('Hold schedule', 'إيقاف الجدول مؤقتًا')}</button>}
      {canSchedule && <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm">{label('Air time (device time)', 'موعد البث (توقيت الجهاز)')}
          <input className={style} type="datetime-local" value={scheduledTime}
            onChange={event => setScheduledTime(event.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={repeatDaily} onChange={event => setRepeatDaily(event.target.checked)} />
          {label('Repeat every 24 hours', 'تكرار كل 24 ساعة')}
        </label>
        <button type="button" className={style}
          disabled={busy || !scheduledTime || !scenes.some(scene => scene.id && scene.id === draft.id)}
          onClick={() => run(async () => {
            await api(schedulePath, {method:'POST',body:{sceneId:draft.id,dueAt:new Date(scheduledTime).getTime(),repeatDaily}});
            await refreshSchedule();
          })}>{label('Schedule saved scene', 'جدولة المشهد المحفوظ')}</button>
      </div>}
      {canSchedule && <div className="space-y-2">
        <h4 className="text-sm font-semibold">{label('Scene sequence', 'قائمة المشاهد المتسلسلة')}</h4>
        <p className="text-xs text-zinc-300">{label('Uses the air time above. Choose a filler scene to play after the final item.',
          'تبدأ القائمة في الموعد أعلاه. يمكنك اختيار مشهد لملء الفراغ بعد العنصر الأخير.')}</p>
        <label className="grid gap-1 text-sm">{label('Filler after the sequence', 'مشهد التعبئة بعد القائمة')}
          <select className={style} value={fillerSceneId} onChange={event => setFillerSceneId(event.target.value)}>
            <option value="">{label('Keep the final scene on air', 'إبقاء المشهد الأخير على الهواء')}</option>
            {scenes.filter(scene=>scene.id && scene.type!=='network').map(scene=>
              <option key={scene.id} value={scene.id}>{scene.name}</option>)}
          </select>
        </label>
        <ol className="space-y-1">{playlist.map((entry, index) => <li key={entry.key} className="flex flex-wrap items-center gap-2 text-sm">
          <span>{index+1}. {scenes.find(scene => scene.id === entry.sceneId)?.name}</span>
          {(index < playlist.length-1 || fillerSceneId) && <label>{label('Seconds until next scene', 'الثواني حتى المشهد التالي')}{' '}
            <input className={style+' w-24'} type="number" min={1} max={86400} value={entry.durationSeconds}
              onChange={event => setPlaylist(items => items.map(item => item.key === entry.key
                ? {...item,durationSeconds:event.target.valueAsNumber || ''} : item))} />
          </label>}
          <button type="button" className={style} onClick={() => setPlaylist(items => items.filter(item => item.key !== entry.key))}>
            {label('Remove', 'إزالة')}</button>
        </li>)}</ol>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={style} disabled={busy || playlist.length>=32 ||
            !scenes.some(scene => scene.id && scene.id === draft.id)}
            onClick={() => setPlaylist(items => [...items,{key:crypto.randomUUID(),sceneId:draft.id,durationSeconds:60}])}>
            {label('Append selected scene', 'إضافة المشهد المحدد')}</button>
          <button type="button" className={style} disabled={busy || !scheduledTime || playlist.length<2 ||
            (fillerSceneId ? playlist : playlist.slice(0,-1)).some(item =>
              !Number.isInteger(item.durationSeconds) || item.durationSeconds<1 || item.durationSeconds>86400)}
            onClick={() => run(async () => {
              await api(root+'/local-scene/schedule-list',{method:'POST',body:{dueAt:new Date(scheduledTime).getTime(),
                fillerSceneId:fillerSceneId || undefined,
                items:playlist.map(({sceneId,durationSeconds},index) => ({
                  sceneId,durationSeconds:index===playlist.length-1 && !fillerSceneId ? 1 : durationSeconds
                }))}});
              setPlaylist([]);
              await refreshSchedule();
            })}>{label('Schedule sequence', 'جدولة القائمة')}</button>
        </div>
      </div>}
      <button type="button" disabled={busy} className={style} onClick={() => run(refreshSchedule)}>
        {label('Refresh schedule log', 'تحديث سجل الجدولة')}
      </button>
      {' '}<a className={style} href={'/api/v1'+schedulePath+'.csv'} download>
        {label('Download schedule CSV', 'تنزيل سجل الجدولة CSV')}
      </a>
      <ul className="space-y-1 text-sm">{events.map(event => <li key={event.id} className="flex flex-wrap gap-2">
        <span>{scenes.find(scene => scene.id === event.sceneId)?.name ?? event.sceneId}</span>
        {Boolean(event.repeatDaily) && <span>{label('Repeats every 24 hours','يتكرر كل 24 ساعة')}</span>}
        <span>{new Date(event.dueAt).toLocaleString()} · {({
          pending: label('Pending','قيد الانتظار'), running: label('Taking','جارٍ الأخذ'),
          aired: label('Take accepted','تم أخذ المشهد'), failed: label('Failed','تعذّر التنفيذ'),
          skipped: label('Skipped','تم التجاوز')
        })[event.state]}</span>
        {event.executedAt && <span>{new Date(event.executedAt).toLocaleString()}</span>}
        {event.error && <span className="text-amber-300">{event.error}</span>}
        {canSchedule && event.state === 'pending' && <button type="button" disabled={busy} className={style}
          onClick={() => setReschedule({id:event.id,previousDueAt:event.dueAt,time:''})}>
          {label('Change time','تعديل الموعد')}</button>}
        {reschedule?.id === event.id && event.state === 'pending' && canSchedule && <>
          <label className="flex items-center gap-2">{label('New time (device time)','الموعد الجديد (توقيت الجهاز)')}
            <input type="datetime-local" className={style} value={reschedule.time}
              onChange={event=>setReschedule({...reschedule,time:event.target.value})} />
          </label>
          <button type="button" className={style} disabled={busy || !reschedule.time} onClick={() => run(async () => {
            await api(schedulePath+'/'+reschedule.id,{method:'PATCH',body:{
              dueAt:new Date(reschedule.time).getTime(),previousDueAt:reschedule.previousDueAt
            }});
            setReschedule(null);
            await refreshSchedule();
          })}>{label('Save time','حفظ الموعد')}</button>
          <button type="button" className={style} disabled={busy} onClick={()=>setReschedule(null)}>
            {label('Close editor','إغلاق التعديل')}</button>
        </>}
        {canSchedule && event.state === 'pending' && <button type="button" disabled={busy} className={style}
          onClick={() => run(async () => {
            await api(schedulePath + '/' + event.id,{method:'DELETE'});
            await refreshSchedule();
          })}>{label('Cancel','إلغاء')}</button>}
      </li>)}</ul>
    </div>}
    <p role="status" className="text-sm">{message}</p>
  </details>;
}
