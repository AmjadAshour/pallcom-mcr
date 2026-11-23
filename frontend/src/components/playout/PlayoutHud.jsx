import React, { useEffect, useRef, useState } from 'react';
import { formatDuration } from './usePlayout.js';

const button = 'rounded border border-zinc-700 px-3 py-2 text-xs font-semibold disabled:opacity-50';

export function PlayoutHud({ snapshot, connected, canControl, busy, act, scenes, ar }) {
  const [clock, setClock] = useState(() => performance.now());
  const [sound, setSound] = useState(false);
  const [emergencyScene, setEmergencyScene] = useState('');
  const audio = useRef(null);
  const wasOnline = useRef(false);
  const state = snapshot?.state;
  const offline = !state?.stationReady;
  const active = state?.active;
  const now = snapshot ? snapshot.serverNow + Math.max(0, clock - snapshot.receivedAt) : Date.now();
  const position = active ? Math.max(0, now - active.clockStartAt) : 0;
  const remaining = active?.endsAt != null ? Math.max(0, active.endsAt - now) : null;
  const progress = active?.item.durationMs ? Math.min(100, position / active.item.durationMs * 100) : 0;

  useEffect(() => {
    const interval = setInterval(() => setClock(performance.now()), 100);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => () => { void audio.current?.close().catch(() => {}); }, []);
  useEffect(() => {
    const ready = Boolean(connected && !offline);
    if (wasOnline.current && !ready && sound && audio.current?.state === 'running') {
      const context = audio.current;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 740;
      gain.gain.setValueAtTime(0.075, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.45);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.48);
    }
    wasOnline.current = ready;
  }, [connected, offline, sound]);

  async function toggleSound() {
    if (sound) return setSound(false);
    try {
      audio.current ??= new AudioContext();
      await audio.current.resume();
      setSound(true);
    } catch {
      setSound(false);
    }
  }

  return (
    <section className="sticky top-0 z-20 space-y-3 rounded-lg border border-zinc-700 bg-zinc-950 p-3 shadow-lg"
      aria-label={ar ? 'حالة البث' : 'Playout status'}>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div><span className="block text-xs text-zinc-400">{ar ? 'على الهواء الآن' : 'Now playing'}</span>
          <strong className="block truncate">{active?.item.title ?? '—'}</strong></div>
        <div><span className="block text-xs text-zinc-400">{ar ? 'التالي' : 'Up next'}</span>
          <strong className="block truncate">{snapshot?.next?.title ?? '—'}</strong></div>
        <div><span className="block text-xs text-zinc-400">{ar ? 'الوقت المنقضي' : 'Elapsed'}</span>
          <strong className="font-mono" dir="ltr">{active ? formatDuration(position) : '—'}</strong></div>
        <div><span className="block text-xs text-zinc-400">{ar ? 'العد التنازلي' : 'Remaining'}</span>
          <strong className="font-mono text-cyan-400" dir="ltr">{formatDuration(remaining === null ? NaN : Math.ceil(remaining / 1000) * 1000)}</strong></div>
      </div>
      <progress aria-label={ar ? 'تقدم العرض' : 'Playback progress'} value={progress} max={100}
        className="block h-2 w-full accent-cyan-500" />
      <div className="flex flex-wrap items-center gap-2">
        {canControl && <>
          <button className={button + ' bg-cyan-900'} disabled={busy || offline || state?.running} onClick={() => act('start')}>{ar ? 'بدء التشغيل' : 'Start playout'}</button>
          <button className={button} disabled={busy || !state?.running} onClick={() => act('release')}>{ar ? 'إيقاف الأتمتة' : 'Release automation'}</button>
          <button className={button} disabled={busy || offline || !state?.running} onClick={() => act('skip')}>{ar ? 'التالي الآن' : 'Play next now'}</button>
          <button className={button} disabled={busy || offline || !state?.running || active?.endsAt == null} onClick={() => act('restart')}>{ar ? 'إعادة العنصر الحالي' : 'Restart current'}</button>
          <select className="max-w-44 rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs"
            aria-label={ar ? 'مشهد الطوارئ' : 'Emergency destination'} value={emergencyScene}
            onChange={(event) => setEmergencyScene(event.target.value)}>
            <option value="">{ar ? 'مشهد الاحتياط' : 'Backup scene'}</option>
            {scenes.map(({ name }) => <option key={name} value={name}>{name}</option>)}
          </select>
          <button className={button + ' border-red-700 bg-red-950 text-red-100'}
            disabled={busy || offline || !(emergencyScene || snapshot?.plan.backupScene)}
            onClick={() => act('emergency', emergencyScene ? { sceneName: emergencyScene } : {})}>{ar ? 'قطع طارئ الآن' : 'Emergency cut now'}</button>
        </>}
        <button className={button} aria-pressed={sound} onClick={() => void toggleSound()}>{ar ? 'تنبيه صوتي' : 'Audio alert'} · {sound ? (ar ? 'مفعّل' : 'On') : (ar ? 'متوقف' : 'Off')}</button>
        {snapshot && (!connected || offline || state.alert) && <span role="alert" className="text-xs text-red-300">
          {!connected ? (ar ? 'انقطع التحديث المباشر' : 'Realtime disconnected') :
            offline ? (ar ? 'OBS غير متصل' : 'OBS disconnected') : state.alert}
        </span>}
      </div>
    </section>
  );
}
