import React, { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';

function stopPlayback(audio) {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}

export function ProgramAudioMonitor({ path, language }) {
  const player = useRef(null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState(false);
  const arabic = language === 'ar';

  useEffect(() => {
    const audio = player.current;
    return () => stopPlayback(audio);
  }, []);

  function playbackFailed() {
    if (!player.current?.hasAttribute('src')) return;
    stopPlayback(player.current);
    setListening(false);
    setError(true);
  }

  function toggle() {
    const audio = player.current;
    setError(false);
    if (listening) {
      stopPlayback(audio);
      setListening(false);
      return;
    }
    audio.src = '/api/v1' + path;
    setListening(true);
    audio.play().catch(cause => {
      if (cause.name !== 'AbortError') playbackFailed();
    });
  }

  return <div className="flex flex-wrap items-center gap-2 text-sm">
    <audio ref={player} preload="none" onEnded={playbackFailed} onError={playbackFailed} />
    <button type="button" onClick={toggle}
      className="flex items-center gap-2 rounded border border-zinc-600 px-3 py-2">
      {listening ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
      {listening ? (arabic ? 'إيقاف الاستماع' : 'Stop listening')
        : (arabic ? 'الاستماع إلى Program' : 'Listen to Program')}
    </button>
    {error && <span role="status" className="text-red-300">
      {arabic ? 'تعذّر تشغيل مراقبة الصوت' : 'Program audio playback is unavailable'}
    </span>}
  </div>;
}
