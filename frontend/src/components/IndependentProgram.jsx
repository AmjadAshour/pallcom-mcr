import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Radio } from 'lucide-react';
import { api, stationPath } from '../context/api.js';
import { useMonitorFrame } from '../context/useProgramMonitor.js';
import { pollWhileVisible } from '../context/pollWhileVisible.js';
import { ProgramVideoInput } from './ProgramVideoInput.jsx';
import { ProgramAudioMonitor } from './ProgramAudioMonitor.jsx';

const en = { title: 'Independent Program', start: 'Start Program', stop: 'Stop Program', obs: 'Take Input 1', obs2: 'Take Input 2',
  fallback: 'Take slate', running: 'Running', stopped: 'Stopped', failed: 'Worker failed', starting: 'Starting',
  stopping: 'Stopping', disconnected: 'No signal', warming: 'Stabilizing', black: 'Black picture', frozen: 'Frozen picture', silent: 'Silent audio', ready: 'Ready', slate: 'Slate', receiver: 'Local receiver' };
const ar = { title: 'خرج البرنامج المستقل', start: 'تشغيل البرنامج', stop: 'إيقاف البرنامج', obs: 'بث المدخل الأول', obs2: 'بث المدخل الثاني',
  fallback: 'بث لوحة الانتظار', running: 'قيد التشغيل', stopped: 'متوقف', failed: 'تعطل محرك البث', starting: 'جارٍ التشغيل',
  stopping: 'جارٍ الإيقاف', disconnected: 'لا توجد إشارة', warming: 'جارٍ تثبيت الإشارة', black: 'صورة سوداء', frozen: 'صورة متجمّدة', silent: 'صمت صوتي', ready: 'جاهز', slate: 'لوحة الانتظار', receiver: 'المستقبل المحلي' };
const receiverStatus = {
  en: { waiting: 'Waiting for receiver', decoding: 'Audio and video decoded', 'video-only': 'Video only',
    'audio-only': 'Audio only', 'no-media': 'No decoded media', offline: 'Receiver reports stopped' },
  ar: { waiting: 'بانتظار تقرير المستقبل', decoding: 'الصوت والصورة يصلان', 'video-only': 'الصورة فقط',
    'audio-only': 'الصوت فقط', 'no-media': 'لا توجد وسائط مفكوكة الترميز', offline: 'توقفت تقارير المستقبل' },
};

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

export function IndependentProgram({ stationId, language, canControl }) {
  const t = language === 'ar' ? ar : en;
  const path = stationPath(stationId, '/program');
  const [status, setStatus] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const running = status?.state === 'running';
  const inputFrame = useMonitorFrame(path + '/input-preview', running, 2000);
  const secondInputFrame = useMonitorFrame(path + '/input-preview?input=secondary', running && Boolean(status.secondPort), 2000);
  const programFrame = useMonitorFrame(path + '/program-monitor', running, 2000);
  useEffect(() => {
    if (pending) return;
    return pollWhileVisible(async (signal) => {
      try {
        const { data } = await api(path, { signal });
        if (!signal.aborted) { setStatus(data); setReadError(''); }
      } catch (err) {
        if (!signal.aborted && err.status !== 429) { setReadError(err.message); setStatus(null); }
        throw err;
      }
    }, 3000);
  }, [path, pending]);
  async function send(body, suffix = '') {
    setPending(true);
    setError('');
    try {
      setStatus((await api(path + suffix, { method: 'POST', body })).data);
    }
    catch (err) { setError(err.message); return false; }
    finally { setPending(false); }
  }
  if (!status?.configured && !readError && !error) return null;
  const actions = running ? ['stop', 'fallback'] : ['start'];
  function takeButton(input) {
    return <button type="button" className="rounded border border-zinc-600 px-3 py-2 text-sm disabled:opacity-50"
      disabled={!canControl || pending || status[input] !== 'ready' || status.source === input}
      onClick={() => send({ action: input })}>
      {status.source === input ? (language === 'ar' ? 'على الهواء' : 'On air') : t[input]}
    </button>;
  }
  return <section className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 space-y-2">
    <h2 className="flex items-center gap-2 font-semibold"><Radio size={16} aria-hidden="true" />{t.title}</h2>
    {status && <p role="status" className="text-sm">{t[status.state]}
      {running && <> · PGM {status.source === 'obs2' ? (language === 'ar' ? 'المدخل الثاني' : 'Input 2')
        : status.source === 'obs' ? (status.inputMode === 'url' ? 'MPEG-TS URL' : (language === 'ar' ? 'المدخل الأول' : 'Input 1')) : status.source === 'scene'
        ? (language === 'ar' ? 'مشهد محلي' : 'Local scene') : t.slate}</>}</p>}
    {running && <p className="text-xs text-zinc-400">{t.receiver} <code dir="ltr">udp://127.0.0.1:{status.outputPort}</code></p>}
    {running && status.source === 'fallback' && ['waiting', 'unavailable'].includes(status.sourceRecovery) &&
      <p role="status" className="text-sm text-amber-300">{status.sourceRecovery === 'waiting'
        ? (language === 'ar' ? 'بانتظار جاهزية المصدر المحفوظ' : 'Waiting for the saved source')
        : (language === 'ar' ? 'تعذّرت استعادة المصدر المحفوظ' : 'Saved source could not be restored')}</p>}
    {status?.configured && <div className="grid gap-3 md:grid-cols-2">
      {running && <div className="min-w-0 space-y-2">
        <PictureMonitor title={language === 'ar' ? 'معاينة المدخل الأول' : 'Input 1 Preview'}
          frame={inputFrame} waiting={language === 'ar' ? 'بانتظار الإشارة' : 'Waiting for input'} />
        <div className="flex flex-wrap items-center gap-2 text-sm">{takeButton('obs')} <span>{t[status.obs]}</span></div>
      </div>}
      {running && <PictureMonitor title={language === 'ar' ? 'مراقبة صورة Program' : 'Program picture monitor'}
        frame={programFrame} waiting={language === 'ar' ? 'بانتظار صورة Program' : 'Waiting for Program picture'} />}
      {running && status.secondPort && <div className="min-w-0 space-y-2">
        <PictureMonitor title={language === 'ar' ? 'معاينة المدخل الثاني' : 'Input 2 Preview'}
          frame={secondInputFrame} waiting={language === 'ar' ? 'بانتظار الإشارة' : 'Waiting for input'} />
        <div className="flex flex-wrap items-center gap-2 text-sm">{takeButton('obs2')} <span>{t[status.obs2]}</span></div>
      </div>}
      {canControl && <ProgramVideoInput path={path} language={language} status={status} pending={pending}
        onTake={video => send({ video }, '/local-scene/video/take')} />}
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
        onApply={draft => send({ action: 'input-audio', inputAudio: { input, ...draft } })} />)}
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
          (action === 'fallback' && status.source === 'fallback')}
        onClick={() => send({ action })}>{t[action]}</button>)}</div>}
    {status?.configured && canControl && <nav className="flex flex-wrap gap-3 border-t border-zinc-700 pt-2 text-sm text-cyan-300">
      <Link to="/graphics">{language === 'ar' ? 'الجرافيكس والتراكبات' : 'Graphics & Overlays'}</Link>
      <Link to="/sources">{language === 'ar' ? 'المصادر والمشاهد' : 'Sources & Scenes'}</Link>
      <Link to="/audio">{language === 'ar' ? 'مزج الصوت' : 'Audio Mixer'}</Link>
    </nav>}
  </section>;
}
