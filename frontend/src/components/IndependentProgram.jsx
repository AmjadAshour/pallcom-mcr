import React, { useEffect, useState } from 'react';
import { Radio } from 'lucide-react';
import { api, stationPath } from '../context/api.js';
import { ProgramWatermark } from './ProgramWatermark.jsx';
import { ProgramAds } from './ProgramAds.jsx';
import { LocalProgramScene } from './LocalProgramScene.jsx';

const en = { title: 'Independent Program', start: 'Start Program', stop: 'Stop Program', obs: 'Take OBS',
  fallback: 'Take slate', running: 'Running', stopped: 'Stopped', failed: 'Worker failed', starting: 'Starting',
  stopping: 'Stopping', disconnected: 'No signal', warming: 'Stabilizing', black: 'Black picture', frozen: 'Frozen picture', silent: 'Silent audio', ready: 'Ready', slate: 'Slate', receiver: 'Local receiver' };
const ar = { title: 'خرج البرنامج المستقل', start: 'تشغيل البرنامج', stop: 'إيقاف البرنامج', obs: 'بث مصدر OBS',
  fallback: 'بث لوحة الانتظار', running: 'قيد التشغيل', stopped: 'متوقف', failed: 'تعطل محرك البث', starting: 'جارٍ التشغيل',
  stopping: 'جارٍ الإيقاف', disconnected: 'لا توجد إشارة', warming: 'جارٍ تثبيت الإشارة', black: 'صورة سوداء', frozen: 'صورة متجمّدة', silent: 'صمت صوتي', ready: 'جاهز', slate: 'لوحة الانتظار', receiver: 'المستقبل المحلي' };

function useMonitorFrame(path, running) {
  const [frame, setFrame] = useState(null);
  useEffect(() => {
    if (!running) { setFrame(null); return; }
    const abort = new AbortController();
    let timer;
    async function poll() {
      try {
        const { data } = await api(path, { signal: abort.signal });
        if (!abort.signal.aborted) setFrame(data);
      } catch {
        if (!abort.signal.aborted) setFrame(null);
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(poll, 1000);
      }
    }
    void poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [path, running]);
  return frame;
}

function PictureMonitor({ title, frame, waiting }) {
  return <figure className="min-w-0">
    <figcaption className="py-1 text-sm font-medium">{title}</figcaption>
    <div className="aspect-video grid place-items-center overflow-hidden rounded border border-zinc-700 bg-zinc-950">
      {frame ? <img className="h-full w-full object-contain" src={frame} alt={title} />
        : <p className="px-2 text-center text-sm text-zinc-400">{waiting}</p>}
    </div>
  </figure>;
}

export function IndependentProgram({ stationId, language, canControl }) {
  const t = language === 'ar' ? ar : en;
  const path = stationPath(stationId, '/program');
  const [status, setStatus] = useState(null);
  const [pending, setPending] = useState(false);
  const [gainDraft, setGainDraft] = useState(null);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const running = status?.state === 'running';
  const inputFrame = useMonitorFrame(path + '/input-preview', running);
  const secondInputFrame = useMonitorFrame(path + '/input-preview?input=secondary', running && Boolean(status.secondPort));
  const programFrame = useMonitorFrame(path + '/program-monitor', running);
  useEffect(() => {
    if (pending) return;
    const abort = new AbortController();
    let timer;
    async function poll() {
      try {
        const { data } = await api(path, { signal: abort.signal });
        if (!abort.signal.aborted) { setStatus(data); setReadError(''); }
      } catch (err) {
        if (!abort.signal.aborted) { setReadError(err.message); setStatus(null); }
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(poll, 2000);
      }
    }
    void poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [path, pending]);
  async function send(action, gainDb) {
    setPending(true);
    setError('');
    try {
      setStatus((await api(path, { method: 'POST', body: action === 'gain' ? { action, gainDb } : { action } })).data);
      if (action === 'gain' || action === 'stop') setGainDraft(null);
    }
    catch (err) { setError(err.message); }
    finally { setPending(false); }
  }
  if (!status?.configured && !readError && !error) return null;
  const actions = running ? ['stop', 'obs', 'fallback'] : ['start'];
  return <section className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 space-y-2">
    <h2 className="flex items-center gap-2 font-semibold"><Radio size={16} aria-hidden="true" />{t.title}</h2>
    {status && <p role="status" className="text-sm">{t[status.state]}
      {running && <> · PGM {status.source === 'obs2' ? (language === 'ar' ? 'المدخل الثاني' : 'Input 2')
        : status.source === 'obs' ? (status.inputMode === 'url' ? 'MPEG-TS URL' : 'OBS') : status.source === 'scene'
        ? (language === 'ar' ? 'مشهد محلي' : 'Local scene') : t.slate} · {status.inputMode === 'url' ? 'URL' : 'OBS'} {t[status.obs]}</>}</p>}
    {running && <p className="text-xs text-zinc-400">{t.receiver} <code dir="ltr">udp://127.0.0.1:{status.outputPort}</code></p>}
    {running && status.source === 'fallback' && ['waiting', 'unavailable'].includes(status.sourceRecovery) &&
      <p role="status" className="text-sm text-amber-300">{status.sourceRecovery === 'waiting'
        ? (language === 'ar' ? 'بانتظار جاهزية المصدر المحفوظ' : 'Waiting for the saved source')
        : (language === 'ar' ? 'تعذّرت استعادة المصدر المحفوظ' : 'Saved source could not be restored')}</p>}
    {running && <div className="grid gap-3 md:grid-cols-2">
      <PictureMonitor title={language === 'ar' ? 'معاينة المدخل (OBS / MPEG-TS)' : 'Input Preview (OBS / MPEG-TS)'}
        frame={inputFrame} waiting={language === 'ar' ? 'بانتظار الإشارة' : 'Waiting for input'} />
      <PictureMonitor title={language === 'ar' ? 'مراقبة صورة Program' : 'Program picture monitor'}
        frame={programFrame} waiting={language === 'ar' ? 'بانتظار صورة Program' : 'Waiting for Program picture'} />
      {status.secondPort && <PictureMonitor title={language === 'ar' ? 'معاينة المدخل الثاني' : 'Input 2 Preview'}
        frame={secondInputFrame} waiting={language === 'ar' ? 'بانتظار الإشارة' : 'Waiting for input'} />}
    </div>}
    {running && status.secondPort && <p className="text-xs text-zinc-400">
      {language === 'ar' ? 'المدخل الثاني' : 'Input 2'} · {t[status.obs2]} · <code dir="ltr">udp://{status.secondInputHost}:{status.secondPort}</code>
      {status.autoBackup && <> · {language === 'ar' ? 'احتياطي تلقائي' : 'Automatic backup'}</>}
    </p>}
    {running && [
      [language === 'ar' ? 'مستوى صوت المدخل' : 'Input audio level', status.inputAudioDbfs],
      [language === 'ar' ? 'مستوى صوت Program' : 'Program audio level', status.programAudioDbfs]
    ].map(([label, value]) => <div key={label} className="flex flex-wrap items-center gap-2 text-sm text-zinc-300">
      <span>{label}</span>
      {Number.isFinite(value) ? <>
        <meter aria-label={label} className="w-32" min={-90} max={0} value={value} />
        <span dir="ltr" className="tabular-nums">{value} dBFS</span>
      </> : <span>{language === 'ar' ? 'لا توجد قراءة' : 'No reading'}</span>}
    </div>)}
    {running && canControl && <button type="button" aria-pressed={Boolean(status.programMuted)}
      disabled={pending} className="rounded border border-zinc-600 px-3 py-2 text-sm disabled:opacity-50"
      onClick={() => send(status.programMuted ? 'unmute' : 'mute')}>
      {status.programMuted ? (language === 'ar' ? 'استعادة صوت Program' : 'Unmute Program')
        : (language === 'ar' ? 'كتم صوت Program' : 'Mute Program')}
    </button>}
    {running && canControl && <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="flex items-center gap-2">
        {language === 'ar' ? 'ضبط مستوى Program' : 'Program level adjustment'}
        <input type="range" min={-30} max={0} value={gainDraft ?? status.programGainDb ?? 0}
          disabled={pending} onChange={event => setGainDraft(Number(event.target.value))} />
      </label>
      <span dir="ltr">{gainDraft ?? status.programGainDb ?? 0} dB</span>
      <button type="button" className="rounded border border-zinc-600 px-3 py-2 disabled:opacity-50"
        disabled={pending || gainDraft === null || gainDraft === status.programGainDb}
        onClick={() => send('gain', gainDraft)}>{language === 'ar' ? 'تطبيق المستوى' : 'Apply level'}</button>
    </div>}
    {running && status.srt && status.srt !== 'disabled' && <p role="status" className="text-sm text-zinc-300">
      SRT {status.srtEncrypted && (language === 'ar' ? 'مشفّر' : 'encrypted')} · {({
        connecting: language === 'ar' ? 'جارٍ الاتصال' : 'Connecting',
        sending: language === 'ar' ? 'جارٍ الإرسال' : 'Sending',
        retrying: language === 'ar' ? 'إعادة المحاولة' : 'Retrying'
      })[status.srt]}
    </p>}
    {status?.recordingFile && <p className={status.recording === 'failed' ? 'text-sm text-red-300' : 'text-sm text-zinc-300'}>
      {language === 'ar' ? 'التسجيل' : 'Recording'} · {({
        starting: language === 'ar' ? 'جارٍ البدء' : 'Starting',
        recording: language === 'ar' ? 'قيد التسجيل' : 'Recording',
        completed: language === 'ar' ? 'اكتمل' : 'Completed',
        failed: language === 'ar' ? 'تعذر التسجيل' : 'Failed',
        interrupted: language === 'ar' ? 'انقطع التسجيل' : 'Interrupted'
      })[status.recording ?? 'starting']} · <code dir="ltr">{status.recordingFile}</code>
    </p>}
    {running && <p className="text-xs text-zinc-400">
      {language === 'ar' ? 'عنوان إرسال الإشارة' : 'Contribution endpoint'}{' '}
      {status.inputMode === 'url' ? (language === 'ar' ? 'رابط مهيّأ على الخادم' : 'Server-configured URL')
        : <code dir="ltr">udp://{status.inputHost}:{status.inputPort}</code>}
    </p>}
    {(readError || error) && <p role="alert" className="text-red-300">{readError || error}</p>}
    {status?.configured && <div className="flex flex-wrap gap-2">{actions.map(action =>
      <button key={action} className="rounded border border-zinc-600 px-3 py-2 text-sm disabled:opacity-50"
        disabled={!canControl || pending || ['starting', 'stopping'].includes(status.state) ||
          (action === 'obs' && (status.obs !== 'ready' || status.source === 'obs')) ||
          (action === 'fallback' && status.source === 'fallback')}
        onClick={() => send(action)}>{action === 'obs' && status.inputMode === 'url'
          ? (language === 'ar' ? 'أخذ إشارة الرابط' : 'Take URL input') : t[action]}</button>)}</div>}
    {status?.configured && canControl && <ProgramWatermark stationId={stationId} language={language} status={status} />}
    {status?.configured && canControl && <LocalProgramScene stationId={stationId} language={language} running={running}
      inputFrame={inputFrame} inputReady={status.obs === 'ready'} secondInputFrame={secondInputFrame}
      secondInputReady={status.obs2 === 'ready'} secondInputConfigured={Boolean(status.secondPort)} />}
    {status?.configured && canControl && <ProgramAds stationId={stationId} language={language} status={status} />}
  </section>;
}
