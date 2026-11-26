import React, { useEffect, useState } from 'react';
import { PROGRAM_SCENE_UPLOAD } from '@mcr/shared';
import { api } from '../context/api.js';
import { programVideoUrl, uploadProgramVideo } from '../context/programVideo.js';

const button = 'rounded border border-zinc-600 px-3 py-2 text-sm disabled:opacity-50';

export function ProgramVideoInput({ path, language, status, pending, onTake }) {
  const ar = language === 'ar';
  const [videos, setVideos] = useState([]);
  const [selection, setSelection] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const video = videos.find(asset => asset.id === (selection ?? status.sceneVideo));
  const onAir = Boolean(video && status.source === 'scene' && status.sceneVideo === video.id);

  useEffect(() => {
    const controller = new AbortController();
    api(path + '/ads', { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) {
        setVideos(data.assets.filter(asset => asset.kind === 'video'));
        setError('');
      }
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [path, reload]);

  async function upload(file) {
    setUploading(true);
    setError('');
    try {
      const asset = await uploadProgramVideo(path, file, language);
      setVideos(previous => [...previous, asset]);
      setSelection(asset.id);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setUploading(false);
    }
  }

  return <section className="min-w-0 space-y-2">
    <h3 className="py-1 text-sm font-medium">{ar ? 'مدخل الفيديو' : 'Video input'}</h3>
    <div className="grid aspect-video place-items-center overflow-hidden rounded border border-zinc-700 bg-zinc-950">
      {video ? <video key={video.id} className="h-full w-full object-contain" src={programVideoUrl(path, video.id)}
        aria-label={ar ? 'معاينة الفيديو المحلي' : 'Local video preview'} controls loop muted playsInline preload="metadata" />
        : <p className="px-2 text-center text-sm text-zinc-400">{ar ? 'اختر فيديو من المكتبة أو ارفع ملفًا' : 'Choose a video from the library or upload a file'}</p>}
    </div>
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid min-w-0 flex-1 gap-1 text-sm">
        {ar ? 'فيديو المدخل' : 'Input video'}
        <select value={video?.id ?? ''} onChange={event => setSelection(event.target.value)}
          disabled={uploading || pending} className="min-w-0 rounded border border-zinc-600 bg-zinc-950 p-2">
          <option value="">{ar ? 'اختر فيديو' : 'Select a video'}</option>
          {videos.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
        </select>
      </label>
      <button type="button" className={button} disabled={uploading || pending} onClick={() => setReload(value => value + 1)}>
        {ar ? 'تحديث المكتبة' : 'Refresh library'}
      </button>
      <button type="button" className={button} disabled={!video || onAir || status.state !== 'running' || uploading || pending}
        onClick={() => onTake(video.id)}>
        {onAir ? (ar ? 'الفيديو على الهواء' : 'Video on air') : (ar ? 'بث الفيديو' : 'Take video')}
      </button>
    </div>
    <label className="grid gap-1 text-sm">
      {ar ? 'رفع فيديو للمدخل' : 'Upload video to input'}
      <input type="file" accept="video/mp4,.mp4" disabled={uploading || pending} onChange={event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file) void upload(file);
      }} />
    </label>
    <p className="text-xs text-zinc-400">{ar
      ? `MP4 حتى ${PROGRAM_SCENE_UPLOAD.maxMib} ميبيبايت و${PROGRAM_SCENE_UPLOAD.maxSeconds} ثانية. المعاينة صامتة.`
      : `MP4 up to ${PROGRAM_SCENE_UPLOAD.maxMib} MiB and ${PROGRAM_SCENE_UPLOAD.maxSeconds} seconds. Preview is muted.`}</p>
    {uploading && <p role="status" className="text-sm">{ar ? 'جارٍ رفع الفيديو وتجهيزه…' : 'Uploading and preparing video…'}</p>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
  </section>;
}
