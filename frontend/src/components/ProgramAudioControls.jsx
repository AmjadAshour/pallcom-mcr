import React, { useState } from 'react';
import { api, stationPath } from '../context/api.js';
import { useProgramStatus } from '../context/useProgramStatus.js';

export function ProgramAudioControls({ stationId, language, canControl }) {
  const status = useProgramStatus(stationId);
  if (!status?.configured) return null;
  return <AudioControls key={status.session ?? 'stopped'} stationId={stationId} status={status}
    ar={language === 'ar'} canControl={canControl} />;
}

function InputAudioControl({ ar, label, setting, pending, onApply }) {
  const [draft, setDraft] = useState(null);
  const mode = draft?.mode ?? setting.mode;
  const gainDb = draft?.gainDb ?? setting.gainDb;
  return <fieldset className="flex flex-wrap items-center gap-3 rounded border border-zinc-700 p-2 text-sm" disabled={pending}>
    <legend className="px-1">{label}</legend>
    <label className="flex items-center gap-2">
      {ar ? 'التوجيه' : 'Routing'}
      <select className="rounded border border-zinc-600 bg-zinc-950 p-1" value={mode}
        onChange={event => setDraft({ ...draft, mode: event.target.value })}>
        <option value="follow">{ar ? 'يتبع الصورة' : 'Follow picture'}</option>
        <option value="on">{ar ? 'يمتزج عند الجاهزية' : 'Mix when ready'}</option>
        <option value="off">{ar ? 'كتم المدخل' : 'Mute input'}</option>
      </select>
    </label>
    <label className="flex items-center gap-2">
      {ar ? 'خفض المستوى' : 'Attenuation'}
      <input type="range" min={-30} max={0} value={gainDb}
        onChange={event => setDraft({ ...draft, gainDb: Number(event.target.value) })} />
      <span dir="ltr" className="tabular-nums">{gainDb} dB</span>
    </label>
    <button type="button" className="rounded border border-zinc-600 px-2 py-1 disabled:opacity-50"
      disabled={mode === setting.mode && gainDb === setting.gainDb}
      onClick={async () => { if (await onApply({ mode, gainDb })) setDraft(null); }}>
      {ar ? 'تطبيق على Program' : 'Apply to Program'}
    </button>
    {setting.routed && <span>{ar ? 'موجّه إلى Program' : 'Routed to Program'}</span>}
  </fieldset>;
}

function AudioControls({ stationId, status, ar, canControl }) {
  const [draft, setDraft] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [response, setResponse] = useState(null);
  const controls = response?.previous === status ? response.data : status;
  const gain = draft ?? controls.programGainDb ?? 0;

  async function send(body) {
    setPending(true);
    setError('');
    try {
      const { data } = await api(stationPath(stationId, '/program'), { method: 'POST', body });
      setResponse({ previous: status, data });
      if (body.action === 'gain') setDraft(null);
      return true;
    } catch (failure) {
      setError(failure.message);
      return false;
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
      {canControl && Object.entries(controls.inputAudioMix ?? {}).map(([input, setting]) =>
        <InputAudioControl key={status.session + input} ar={ar} setting={setting} pending={pending}
          label={input === 'obs' ? (ar ? 'صوت المدخل الأول' : 'Primary input audio')
            : (ar ? 'صوت المدخل الثاني' : 'Secondary input audio')}
          onApply={draft => send({ action: 'input-audio', inputAudio: { input, ...draft } })} />)}
      {canControl && <div className="flex flex-wrap items-center gap-3 text-sm">
        <button type="button" aria-pressed={Boolean(controls.programMuted)} disabled={pending}
          className="rounded border border-zinc-600 px-3 py-2 disabled:opacity-50"
          onClick={() => send({ action: controls.programMuted ? 'unmute' : 'mute' })}>
          {controls.programMuted ? (ar ? 'استعادة صوت Program' : 'Unmute Program') : (ar ? 'كتم صوت Program' : 'Mute Program')}
        </button>
        <label className="flex items-center gap-2">
          {ar ? 'مستوى Program' : 'Program gain'}
          <input type="range" min={-30} max={0} value={gain} disabled={pending}
            onChange={event => setDraft(Number(event.target.value))} />
          <output dir="ltr">{gain} dB</output>
        </label>
        <button type="button" className="rounded border border-zinc-600 px-3 py-2 disabled:opacity-50"
          disabled={pending || draft === null || draft === controls.programGainDb} onClick={() => send({ action: 'gain', gainDb: draft })}>
          {ar ? 'تطبيق المستوى' : 'Apply level'}
        </button>
      </div>}
    </>}
    {error && <p role="alert" className="text-red-300">{error}</p>}
  </section>;
}
