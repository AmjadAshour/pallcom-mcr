import React, { useEffect, useState } from 'react';
import { Radio } from 'lucide-react';
import { api, stationPath } from '../context/api.js';
import { ProgramWatermark } from './ProgramWatermark.jsx';
import { ProgramAds } from './ProgramAds.jsx';
import { LocalProgramScene } from './LocalProgramScene.jsx';
import { ProgramAudioMonitor } from './ProgramAudioMonitor.jsx';

const en = { title: 'Independent Program', start: 'Start Program', stop: 'Stop Program', obs: 'Take OBS',
  fallback: 'Take slate', running: 'Running', stopped: 'Stopped', failed: 'Worker failed', starting: 'Starting',
  stopping: 'Stopping', disconnected: 'No signal', warming: 'Stabilizing', black: 'Black picture', frozen: 'Frozen picture', silent: 'Silent audio', ready: 'Ready', slate: 'Slate', receiver: 'Local receiver' };
const ar = { title: 'خرج البرنامج المستقل', start: 'تشغيل البرنامج', stop: 'إيقاف البرنامج', obs: 'بث مصدر OBS',
  fallback: 'بث لوحة الانتظار', running: 'قيد التشغيل', stopped: 'متوقف', failed: 'تعطل محرك البث', starting: 'جارٍ التشغيل',
  stopping: 'جارٍ الإيقاف', disconnected: 'لا توجد إشارة', warming: 'جارٍ تثبيت الإشارة', black: 'صورة سوداء', frozen: 'صورة متجمّدة', silent: 'صمت صوتي', ready: 'جاهز', slate: 'لوحة الانتظار', receiver: 'المستقبل المحلي' };
const receiverStatus = {
  en: { waiting: 'Waiting for receiver', decoding: 'Audio and video decoded', 'video-only': 'Video only',
    'audio-only': 'Audio only', 'no-media': 'No decoded media', offline: 'Receiver reports stopped' },
  ar: { waiting: 'بانتظار تقرير المستقبل', decoding: 'الصوت والصورة يصلان', 'video-only': 'الصورة فقط',
    'audio-only': 'الصوت فقط', 'no-media': 'لا توجد وسائط مفكوكة الترميز', offline: 'توقفت تقارير المستقبل' },
};

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

function InputAudioControl({ language, label, setting, pending, onApply }) {
  const [draft, setDraft] = useState(null);
  const arabic = language === 'ar';
  const mode = draft?.mode ?? setting.mode;
  const gainDb = draft?.gainDb ?? setting.gainDb;
  return <fieldset className="flex flex-wrap items-center gap-3 rounded border border-zinc-700 p-2 text-sm" disabled={pending}>
    <legend className="px-1">{label}</legend>
    <label className="flex items-center gap-2">
      {arabic ? 'التوجيه' : 'Routing'}
      <select className="rounded border border-zinc-600 bg-zinc-950 p-1" value={mode}
        onChange={event => setDraft({ ...draft, mode: event.target.value })}>
        <option value="follow">{arabic ? 'يتبع الصورة' : 'Follow picture'}</option>
        <option value="on">{arabic ? 'يمتزج عند الجاهزية' : 'Mix when ready'}</option>
        <option value="off">{arabic ? 'كتم المدخل' : 'Mute input'}</option>
      </select>
    </label>
    <label className="flex items-center gap-2">
      {arabic ? 'خفض المستوى' : 'Attenuation'}
      <input type="range" min={-30} max={0} value={gainDb}
        onChange={event => setDraft({ ...draft, gainDb: Number(event.target.value) })} />
      <span dir="ltr" className="tabular-nums">{gainDb} dB</span>
    </label>
    <button type="button" className="rounded border border-zinc-600 px-2 py-1 disabled:opacity-50"
      disabled={mode === setting.mode && gainDb === setting.gainDb}
      onClick={async () => { if (await onApply({ mode, gainDb })) setDraft(null); }}>
      {arabic ? 'تطبيق على Program' : 'Apply to Program'}
    </button>
    {setting.routed && <span>{arabic ? 'موجّه إلى Program' : 'Routed to Program'}</span>}
  </fieldset>;
}

export function IndependentProgram({ stationId, language, canControl, canSchedule }) {
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
  async function send(action, setting) {
    setPending(true);
    setError('');
    try {
      const body = { action };
      if (action === 'gain') body.gainDb = setting;
      if (action === 'input-audio') body.inputAudio = setting;
      setStatus((await api(path, { method: 'POST', body })).data);
      if (action === 'gain' || action === 'stop') setGainDraft(null);
      return true;
    }
    catch (err) { setError(err.message); return false; }
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
      ...(status.secondPort ? [[language === 'ar' ? 'مستوى صوت المدخل الثاني' : 'Input 2 audio level', status.input2AudioDbfs]] : []),
      [language === 'ar' ? 'مستوى صوت Program' : 'Program audio level', status.programAudioDbfs]
    ].map(([label, value]) => <div key={label} className="flex flex-wrap items-center gap-2 text-sm text-zinc-300">
      <span>{label}</span>
      {Number.isFinite(value) ? <>
        <meter aria-label={label} className="w-32" min={-90} max={0} value={value} />
        <span dir="ltr" className="tabular-nums">{value} dBFS</span>
      </> : <span>{language === 'ar' ? 'لا توجد قراءة' : 'No reading'}</span>}
    </div>)}
    {running && status.audioMonitorAvailable &&
      <ProgramAudioMonitor key={status.session} path={path + '/audio-monitor'} language={language} />}
    {running && canControl && Object.entries(status.inputAudioMix ?? {}).map(([input, setting]) =>
      <InputAudioControl key={status.session + input} language={language} setting={setting} pending={pending}
        label={input === 'obs' ? (language === 'ar' ? 'صوت المدخل الأول' : 'Primary input audio')
          : (language === 'ar' ? 'صوت المدخل الثاني' : 'Secondary input audio')}
        onApply={draft => send('input-audio', { input, ...draft })} />)}
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
    {running && (status.srtDestinations ?? (status.srt && status.srt !== 'disabled'
      ? [{ id: 'primary', state: status.srt, encrypted: status.srtEncrypted }] : [])).map(destination =>
      <p key={destination.id} role="status" className="text-sm text-zinc-300">
        {destination.id === 'primary'
          ? (language === 'ar' ? 'وجهة SRT الأولى' : 'Primary SRT destination')
          : (language === 'ar' ? 'وجهة SRT الثانية' : 'Secondary SRT destination')}
        {destination.encrypted && (language === 'ar' ? ' · مشفّر' : ' · Encrypted')} · {({
          connecting: language === 'ar' ? 'جارٍ الاتصال' : 'Connecting',
          sending: language === 'ar' ? 'جارٍ الإرسال' : 'Sending',
          retrying: language === 'ar' ? 'إعادة المحاولة' : 'Retrying'
        })[destination.state]}
        {destination.receiver && <> · {language === 'ar' ? 'المستقبل' : 'Receiver'}{' '}
          {(receiverStatus[language] ?? receiverStatus.en)[destination.receiver]}</>}
      </p>)}
    {running && status.hls && status.hls !== 'disabled' && <p role="status" className="text-sm text-zinc-300">
      {status.hls === 'ready'
        ? <a className="underline" href={'/api/v1' + path + '/hls/' + status.session + '/index.m3u8'}>
          {language === 'ar' ? 'رابط بث HLS' : 'HLS playlist'}
        </a>
        : status.hls === 'failed' ? (language === 'ar' ? 'تعذّر خرج HLS' : 'HLS output unavailable')
          : (language === 'ar' ? 'جارٍ تجهيز خرج HLS' : 'Preparing HLS output')}
    </p>}
    {status?.deliveryIncidents?.length > 0 && <details className="rounded border border-zinc-700 p-2 text-sm">
      <summary className="cursor-pointer">{language === 'ar' ? 'سجل انقطاع المخارج واستعادتها' : 'Output incident history'}</summary>
      <ul className="mt-2 space-y-1">
        {status.deliveryIncidents.slice().reverse().map(incident => <li key={incident.id}>
          {incident.destination === 'hls' ? 'HLS' : incident.destination === 'primary'
            ? (language === 'ar' ? 'وجهة SRT الأولى' : 'Primary SRT')
            : (language === 'ar' ? 'وجهة SRT الثانية' : 'Secondary SRT')}
          {' · '}
          {incident.state === 'recovered' ? (language === 'ar' ? 'استُعيد الإرسال' : 'Delivery recovered')
            : (language === 'ar' ? 'تعذّر الإرسال' : 'Delivery unavailable')}
          {' · '}
          <time dateTime={incident.at}>{new Date(incident.at).toLocaleTimeString(language === 'ar' ? 'ar' : 'en')}</time>
        </li>)}
      </ul>
    </details>}
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
      secondInputReady={status.obs2 === 'ready'} secondInputConfigured={Boolean(status.secondPort)} canSchedule={canSchedule} />}
    {status?.configured && canControl && <ProgramAds stationId={stationId} language={language} status={status} />}
  </section>;
}
