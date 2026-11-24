import React, { useEffect, useState } from 'react';
import { Radio } from 'lucide-react';
import { api, stationPath } from '../context/api.js';
import { ProgramWatermark } from './ProgramWatermark.jsx';
import { ProgramAds } from './ProgramAds.jsx';

const en = { title: 'Independent Program', start: 'Start Program', stop: 'Stop Program', obs: 'Take OBS',
  fallback: 'Take slate', running: 'Running', stopped: 'Stopped', failed: 'Worker failed', starting: 'Starting',
  stopping: 'Stopping', disconnected: 'No signal', warming: 'Stabilizing', ready: 'Ready', slate: 'Slate', receiver: 'Local receiver' };
const ar = { title: 'خرج البرنامج المستقل', start: 'تشغيل البرنامج', stop: 'إيقاف البرنامج', obs: 'بث مصدر OBS',
  fallback: 'بث لوحة الانتظار', running: 'قيد التشغيل', stopped: 'متوقف', failed: 'تعطل محرك البث', starting: 'جارٍ التشغيل',
  stopping: 'جارٍ الإيقاف', disconnected: 'لا توجد إشارة', warming: 'جارٍ تثبيت الإشارة', ready: 'جاهز', slate: 'لوحة الانتظار', receiver: 'المستقبل المحلي' };

export function IndependentProgram({ stationId, language, canControl }) {
  const t = language === 'ar' ? ar : en;
  const path = stationPath(stationId, '/program');
  const [status, setStatus] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
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
  async function send(action) {
    setPending(true);
    setError('');
    try { setStatus((await api(path, { method: 'POST', body: { action } })).data); }
    catch (err) { setError(err.message); }
    finally { setPending(false); }
  }
  if (!status?.configured && !readError && !error) return null;
  const running = status?.state === 'running';
  const actions = running ? ['stop', 'obs', 'fallback'] : ['start'];
  return <section className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 space-y-2">
    <h2 className="flex items-center gap-2 font-semibold"><Radio size={16} aria-hidden="true" />{t.title}</h2>
    {status && <p role="status" className="text-sm">{t[status.state]}
      {running && <> · PGM {status.source === 'obs' ? 'OBS' : t.slate} · OBS {t[status.obs]}</>}</p>}
    {running && <p className="text-xs text-zinc-400">{t.receiver} <code dir="ltr">udp://127.0.0.1:{status.outputPort}</code></p>}
    {(readError || error) && <p role="alert" className="text-red-300">{readError || error}</p>}
    {status?.configured && <div className="flex flex-wrap gap-2">{actions.map(action =>
      <button key={action} className="rounded border border-zinc-600 px-3 py-2 text-sm disabled:opacity-50"
        disabled={!canControl || pending || ['starting', 'stopping'].includes(status.state) ||
          (action === 'obs' && (status.obs !== 'ready' || status.source === 'obs')) ||
          (action === 'fallback' && status.source === 'fallback')}
        onClick={() => send(action)}>{t[action]}</button>)}</div>}
    {status?.configured && canControl && <ProgramWatermark stationId={stationId} language={language} status={status} />}
    {status?.configured && canControl && <ProgramAds stationId={stationId} language={language} status={status} />}
  </section>;
}
