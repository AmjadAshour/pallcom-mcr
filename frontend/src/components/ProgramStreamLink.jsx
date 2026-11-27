import React, { useEffect, useState } from 'react';
import { api } from '../context/api.js';
import { pollWhileVisible } from '../context/pollWhileVisible.js';

const publicPath = '/iptv/program.m3u8';

export function ProgramStreamLink({ status, privatePath, programPath, canControl, language }) {
  const ar = language === 'ar';
  const running = status.state === 'running';
  const [publicReady, setPublicReady] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');
  const [playbackPath, setPlaybackPath] = useState(null);
  const [creatingLink, setCreatingLink] = useState(false);
  const [linkError, setLinkError] = useState('');

  useEffect(() => {
    if (!running) return;
    return pollWhileVisible(async signal => {
      try {
        const response = await fetch(publicPath, { method: 'HEAD', cache: 'no-store', signal });
        const contentType = response.headers.get('Content-Type') ?? '';
        if (!signal.aborted) {
          setPublicReady(response.ok && /^(application\/(vnd\.apple\.mpegurl|x-mpegurl)|audio\/mpegurl)(;|$)/i.test(contentType));
        }
      } catch {
        if (!signal.aborted) setPublicReady(false);
      }
    }, 5000);
  }, [running]);

  const path = running && publicReady ? publicPath : privatePath && (playbackPath ?? privatePath);
  const url = path ? new URL(path, window.location.origin).href : '';

  async function createLink() {
    setCreatingLink(true);
    setLinkError('');
    setCopyMessage('');
    try {
      const { data } = await api(programPath + '/hls/playback-link', { method: 'POST' });
      setPlaybackPath(data.path);
    } catch (error) {
      setLinkError(error.message);
    } finally {
      setCreatingLink(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopyMessage(ar ? 'تم نسخ الرابط.' : 'Link copied.');
    } catch {
      setCopyMessage(ar ? 'حدّد الرابط وانسخه من الحقل.' : 'Select and copy the address from the field.');
    }
  }

  return <section className="space-y-2 rounded border border-zinc-700 p-3">
    <h3 className="text-sm font-semibold">{ar ? 'رابط IPTV' : 'IPTV link'}</h3>
    {url ? <>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-sm">
          {publicReady ? (ar ? 'رابط المشاهدة' : 'Playback URL') : (playbackPath ? (ar ? 'رابط IPTV مؤقت' : 'Temporary IPTV URL') : (ar ? 'رابط مشاهدة خاص' : 'Private playback URL'))}
          <input readOnly dir="ltr" value={url} onFocus={event => event.currentTarget.select()}
            className="mt-1 block w-full rounded border border-zinc-600 bg-zinc-950 p-2 text-xs" />
        </label>
        <button type="button" onClick={copyLink} className="rounded border border-zinc-600 px-3 py-2 text-sm">
          {ar ? 'نسخ الرابط' : 'Copy link'}
        </button>
      </div>
      {!publicReady && <p className="text-xs text-zinc-400">
        {playbackPath
          ? (ar ? 'يفتح في مشغّل IPTV دون دخول، ويصلح لمدة ساعة ما دامت جلستا الدخول والبث نشطتين.' : 'Opens in IPTV players without signing in. Valid for one hour while your login and Program sessions are active.')
          : (ar ? 'رابط اللوحة يتطلب تسجيل الدخول.' : 'The dashboard link requires sign-in.')}
      </p>}
      {!publicReady && canControl && <button type="button" disabled={creatingLink} onClick={createLink}
        className="rounded border border-cyan-700 px-3 py-2 text-sm disabled:opacity-50">
        {creatingLink ? (ar ? 'جارٍ إنشاء الرابط…' : 'Creating link…')
          : (ar ? 'إنشاء رابط لمشغّل IPTV' : 'Create IPTV player link')}
      </button>}
      {linkError && <p role="alert" className="text-sm text-red-300">{linkError}</p>}
      {copyMessage && <p role="status" className="text-xs text-zinc-300">{copyMessage}</p>}
    </> : <p role="status" className="text-sm text-zinc-300">
      {!running ? (ar ? 'شغّل البرنامج لإظهار رابط IPTV.' : 'Start Program to show the IPTV link.')
        : status.hls === 'starting' ? (ar ? 'جارٍ تجهيز رابط IPTV…' : 'Preparing the IPTV link…')
        : (ar ? 'لا يوجد رابط IPTV جاهز لهذه الجلسة.' : 'No IPTV link is ready for this session.')}
    </p>}
    {running && <p className="text-xs text-zinc-400">
      {ar ? 'خرج UDP المحلي' : 'Local UDP output'} <code dir="ltr">udp://127.0.0.1:{status.outputPort}</code>
    </p>}
  </section>;
}
