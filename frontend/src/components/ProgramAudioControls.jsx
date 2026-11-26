import React, { useState } from 'react';
import { api, stationPath } from '../context/api.js';
import { useProgramStatus } from '../context/useProgramStatus.js';

export function ProgramAudioControls({ stationId, language, canControl }) {
  const status = useProgramStatus(stationId);
  if (!status?.configured) return null;
  return <AudioControls key={status.session ?? 'stopped'} stationId={stationId} status={status}
    ar={language === 'ar'} canControl={canControl} />;
}

function AudioControls({ stationId, status, ar, canControl }) {
  const [draft, setDraft] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [response, setResponse] = useState(null);
  const controls = response?.previous === status ? response.data : status;
  const gain = draft ?? controls.programGainDb ?? 0;

  async function send(action) {
    setPending(true);
    setError('');
    try {
      const { data } = await api(stationPath(stationId, '/program'), { method: 'POST',
        body: action === 'gain' ? { action, gainDb: draft } : { action } });
      setResponse({ previous: status, data });
      if (action === 'gain') setDraft(null);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setPending(false);
    }
  }

  return <section className="space-y-3 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
    <h2 className="font-semibold">{ar ? 'صوت البرنامج المستقل' : 'Independent Program audio'}</h2>
    {status.state !== 'running' ? <p className="text-sm text-zinc-400">{ar ? 'البرنامج متوقف' : 'Program is stopped'}</p> : <>
      {[[ar ? 'مستوى المدخل' : 'Input level', status.inputAudioDbfs],
        [ar ? 'مستوى خرج Program' : 'Program output level', status.programAudioDbfs]].map(([label, level]) =>
        <div key={label} className="flex flex-wrap items-center gap-2 text-sm">
          <span>{label}</span>
          {Number.isFinite(level) && <><meter aria-label={label} className="w-32" min={-90} max={0} value={level} />
            <span dir="ltr">{level} dBFS</span></>}
        </div>)}
      {canControl && <div className="flex flex-wrap items-center gap-3 text-sm">
        <button type="button" aria-pressed={Boolean(controls.programMuted)} disabled={pending}
          className="rounded border border-zinc-600 px-3 py-2 disabled:opacity-50"
          onClick={() => send(controls.programMuted ? 'unmute' : 'mute')}>
          {controls.programMuted ? (ar ? 'استعادة صوت Program' : 'Unmute Program') : (ar ? 'كتم صوت Program' : 'Mute Program')}
        </button>
        <label className="flex items-center gap-2">
          {ar ? 'مستوى Program' : 'Program gain'}
          <input type="range" min={-30} max={0} value={gain} disabled={pending}
            onChange={event => setDraft(Number(event.target.value))} />
          <output dir="ltr">{gain} dB</output>
        </label>
        <button type="button" className="rounded border border-zinc-600 px-3 py-2 disabled:opacity-50"
          disabled={pending || draft === null || draft === controls.programGainDb} onClick={() => send('gain')}>
          {ar ? 'تطبيق المستوى' : 'Apply level'}
        </button>
      </div>}
    </>}
    {error && <p role="alert" className="text-red-300">{error}</p>}
  </section>;
}
