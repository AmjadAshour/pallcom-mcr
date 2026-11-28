import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { MEDIA_CATEGORIES } from '@mcr/shared';
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@mcr/ui';
import { Film, FolderInput, Globe, HardDrive, List, LayoutGrid, Pause, Play, RefreshCw, Search, Trash2, Upload, XCircle } from 'lucide-react';
import { api } from '../context/api.js';
import { useMcrStore } from '../context/useMcrStore.js';

const CATEGORY_LABELS = {
  MOVIES: { en: 'Movies', ar: 'أفلام' },
  TV_PROGRAMS: { en: 'TV Programs', ar: 'برامج تلفزيونية' },
  VIDEO_CLIPS: { en: 'Video Clips', ar: 'مقاطع فيديو' },
  MUSIC: { en: 'Music', ar: 'موسيقى' },
  AUDIO_RECORDINGS: { en: 'Audio Recordings', ar: 'تسجيلات صوتية' },
  ADVERTISEMENTS: { en: 'Advertisements', ar: 'إعلانات' },
  PROMOTIONS: { en: 'Promotions', ar: 'فيديوهات ترويجية' },
  INTROS_OUTROS: { en: 'Intros & Outros', ar: 'مقدمات وخواتيم القناة' },
  FALLBACK: { en: 'Fallback Content', ar: 'محتوى احتياطي (Fallback)' },
  IMAGES: { en: 'Images', ar: 'صور' },
  CHANNEL_LOGOS: { en: 'Channel Logos', ar: 'شعارات القنوات' },
  GRAPHICS: { en: 'Graphics', ar: 'جرافيكس' }
};

function formatBytes(bytes) {
  const num = Number(bytes || 0);
  if (num < 1024) return `${num} B`;
  if (num < 1024 ** 2) return `${(num / 1024).toFixed(1)} KiB`;
  if (num < 1024 ** 3) return `${(num / 1024 ** 2).toFixed(1)} MiB`;
  return `${(num / 1024 ** 3).toFixed(2)} GiB`;
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return '—';
  const total = Math.round(Number(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hrs > 0
    ? `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${mins}:${String(secs).padStart(2, '0')}`;
}

export function MediaLibraryPage() {
  const user = useOutletContext();
  const { language, stations } = useMcrStore();
  const ar = language === 'ar';
  const label = (en, arText) => (ar ? arText : en);

  const canUpload = user.permissions.includes('*') || user.permissions.includes('media:upload');
  const canDelete = user.permissions.includes('*') || user.permissions.includes('media:delete');

  const [viewMode, setViewMode] = useState('grid');
  const [assets, setAssets] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 12, total: 0, totalPages: 1 });
  const [storageInfo, setStorageInfo] = useState(null);
  const [playlists, setPlaylists] = useState([]);
  const [serverFiles, setServerFiles] = useState([]);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');

  const [uploadCategory, setUploadCategory] = useState('MOVIES');
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadFolder, setUploadFolder] = useState('');
  const [uploadTags, setUploadTags] = useState('');
  const [uploadChannelId, setUploadChannelId] = useState('');
  const [uploadQueue, setUploadQueue] = useState([]);
  const activeControllers = useRef(new Map());

  const [importMode, setImportMode] = useState('');
  const [selectedServerFile, setSelectedServerFile] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');

  const [selectedAsset, setSelectedAsset] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [playlistName, setPlaylistName] = useState('');
  const [playlistKind, setPlaylistKind] = useState('VIDEO');
  const [playlistAssetIds, setPlaylistAssetIds] = useState([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadLibrary = useCallback(async (pageToLoad = pagination.page) => {
    try {
      const query = new URLSearchParams({
        page: String(pageToLoad),
        pageSize: String(pagination.pageSize),
        sortBy,
        sortOrder,
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(categoryFilter ? { category: categoryFilter } : {}),
        ...(kindFilter ? { kind: kindFilter } : {}),
        ...(statusFilter ? { processingStatus: statusFilter } : {})
      });
      const [assetsRes, storageRes, playlistsRes] = await Promise.all([
        api('/media/assets?' + query.toString()),
        api('/media/storage'),
        api('/media/playlists')
      ]);
      setAssets(assetsRes.data.items);
      setPagination(assetsRes.data.pagination);
      setStorageInfo(storageRes.data);
      setPlaylists(playlistsRes.data);
    } catch (err) {
      setError(err.message);
    }
  }, [pagination.page, pagination.pageSize, sortBy, sortOrder, search, categoryFilter, kindFilter, statusFilter]);

  useEffect(() => {
    void loadLibrary(1);
  }, [categoryFilter, kindFilter, statusFilter, sortBy, sortOrder]);

  useEffect(() => {
    const hasProcessing = assets.some(a => ['UPLOADING', 'UPLOADED', 'VALIDATING', 'PROCESSING'].includes(a.processingStatus));
    if (!hasProcessing) return;
    const timer = setInterval(() => { void loadLibrary(pagination.page); }, 2500);
    return () => clearInterval(timer);
  }, [assets, pagination.page, loadLibrary]);

  function updateQueueItem(sessionId, updater) {
    setUploadQueue(prev => prev.map(item => (item.sessionId === sessionId ? { ...item, ...updater(item) } : item)));
  }

  async function runChunkTransfer(queueItem) {
    const { sessionId, file, chunkSizeBytes } = queueItem;
    let offset = queueItem.receivedBytes || 0;
    const startedAt = Date.now();
    const startOffset = offset;

    try {
      const statusRes = await api(`/media/uploads/${encodeURIComponent(sessionId)}`);
      offset = Number(statusRes.data.receivedBytes || 0);
    } catch {
      // keep known offset
    }

    updateQueueItem(sessionId, () => ({ state: 'uploading', receivedBytes: offset, error: '' }));

    while (offset < file.size) {
      const controller = new AbortController();
      activeControllers.current.set(sessionId, controller);

      const end = Math.min(offset + chunkSizeBytes, file.size);
      const chunk = file.slice(offset, end, 'application/offset+octet-stream');

      let succeeded = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(`/api/v1/media/uploads/${encodeURIComponent(sessionId)}`, {
            method: 'PATCH',
            credentials: 'same-origin',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/offset+octet-stream',
              'Upload-Offset': String(offset)
            },
            body: chunk
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok || !body.success) {
            if (response.status === 409 && body.details?.receivedBytes !== undefined) {
              offset = Number(body.details.receivedBytes);
              succeeded = true;
              break;
            }
            throw new Error(body.error || `Chunk transfer failed (${response.status})`);
          }
          offset = Number(body.data.receivedBytes);
          succeeded = true;
          break;
        } catch (err) {
          if (controller.signal.aborted) {
            updateQueueItem(sessionId, () => ({ state: 'paused', speedBps: 0 }));
            return;
          }
          if (attempt === 2) {
            updateQueueItem(sessionId, () => ({ state: 'paused', error: err.message, speedBps: 0 }));
            return;
          }
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        }
      }

      if (!succeeded) return;
      const elapsedSec = Math.max(0.1, (Date.now() - startedAt) / 1000);
      const transferred = Math.max(0, offset - startOffset);
      const speedBps = Math.round(transferred / elapsedSec);
      const remainingBytes = Math.max(0, file.size - offset);
      const etaSeconds = speedBps > 0 ? Math.round(remainingBytes / speedBps) : null;

      updateQueueItem(sessionId, () => ({
        receivedBytes: offset,
        speedBps,
        etaSeconds
      }));
    }

    activeControllers.current.delete(sessionId);
    updateQueueItem(sessionId, () => ({ state: 'finalizing', speedBps: 0, etaSeconds: 0 }));

    try {
      await api(`/media/uploads/${encodeURIComponent(sessionId)}/complete`, {
        method: 'POST',
        body: {}
      });
      updateQueueItem(sessionId, () => ({ state: 'completed' }));
      setNotice(label('Upload completed and queued for FFprobe validation.', 'اكتمل الرفع وتم إدراج الملف للفحص والمعالجة.'));
      await loadLibrary(1);
    } catch (err) {
      updateQueueItem(sessionId, () => ({ state: 'failed', error: err.message }));
    }
  }

  async function startFileUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setNotice('');
    try {
      const title = (uploadTitle.trim() || file.name.replace(/\.[^.]+$/, '')).slice(0, 250);
      const tags = uploadTags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 25);
      const channelIds = uploadChannelId ? [uploadChannelId] : [];
      const res = await api('/media/uploads', {
        method: 'POST',
        body: {
          title,
          category: uploadCategory,
          folder: uploadFolder.trim(),
          tags,
          channelIds,
          originalFilename: file.name,
          declaredMimeType: file.type || 'application/octet-stream',
          expectedSizeBytes: file.size
        }
      });
      const session = res.data;
      const item = {
        sessionId: session.id,
        title: session.title,
        filename: file.name,
        file,
        expectedSizeBytes: file.size,
        receivedBytes: 0,
        chunkSizeBytes: Math.min(session.chunkSizeBytes || 4 * 1024 * 1024, 4 * 1024 * 1024),
        state: 'uploading',
        speedBps: 0,
        etaSeconds: null,
        error: ''
      };
      setUploadQueue(prev => [item, ...prev]);
      setUploadTitle('');
      void runChunkTransfer(item);
    } catch (err) {
      setError(err.message);
    }
  }

  function pauseUpload(sessionId) {
    const controller = activeControllers.current.get(sessionId);
    if (controller) {
      controller.abort();
      activeControllers.current.delete(sessionId);
    }
    updateQueueItem(sessionId, () => ({ state: 'paused', speedBps: 0 }));
  }

  function resumeUpload(sessionId) {
    const item = uploadQueue.find(q => q.sessionId === sessionId);
    if (item && item.file) {
      void runChunkTransfer(item);
    }
  }

  async function cancelUpload(sessionId) {
    pauseUpload(sessionId);
    try {
      await api(`/media/uploads/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
    } catch {
      // Ignore if already removed
    }
    setUploadQueue(prev => prev.filter(item => item.sessionId !== sessionId));
    await loadLibrary(pagination.page);
  }

  async function openDirectoryImport() {
    setImportMode('directory');
    setError('');
    try {
      const res = await api('/media/import/directory');
      setServerFiles(res.data);
      if (res.data[0]) setSelectedServerFile(res.data[0].filename);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDirectoryImport(event) {
    event.preventDefault();
    if (!selectedServerFile) return;
    setBusy(true);
    setError('');
    try {
      await api('/media/import/directory', {
        method: 'POST',
        body: {
          relativeFilename: selectedServerFile,
          title: uploadTitle.trim() || selectedServerFile,
          category: uploadCategory,
          folder: uploadFolder.trim(),
          tags: uploadTags.split(',').map(t => t.trim()).filter(Boolean),
          channelIds: uploadChannelId ? [uploadChannelId] : []
        }
      });
      setNotice(label('Server file imported and queued for validation.', 'تم استيراد الملف من مجلد الخادم وإدراجه للفحص.'));
      setImportMode('');
      setUploadTitle('');
      await loadLibrary(1);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleUrlImport(event) {
    event.preventDefault();
    if (!remoteUrl.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api('/media/import/url', {
        method: 'POST',
        body: {
          url: remoteUrl.trim(),
          title: uploadTitle.trim() || undefined,
          category: uploadCategory,
          folder: uploadFolder.trim(),
          tags: uploadTags.split(',').map(t => t.trim()).filter(Boolean),
          channelIds: uploadChannelId ? [uploadChannelId] : []
        }
      });
      setNotice(label('Remote media imported and queued for validation.', 'تم استيراد الوسائط من الرابط المباشر وإدراجها للفحص.'));
      setRemoteUrl('');
      setImportMode('');
      setUploadTitle('');
      await loadLibrary(1);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteAsset(assetId) {
    setBusy(true);
    setError('');
    try {
      await api(`/media/assets/${encodeURIComponent(assetId)}?confirm=true`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      if (selectedAsset?.id === assetId) setSelectedAsset(null);
      setNotice(label('Media asset deleted.', 'تم حذف ملف الوسائط بنجاح.'));
      await loadLibrary(pagination.page);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreatePlaylist(event) {
    event.preventDefault();
    if (!playlistName.trim() || !playlistAssetIds.length) return;
    setBusy(true);
    setError('');
    try {
      await api('/media/playlists', {
        method: 'POST',
        body: {
          name: playlistName.trim(),
          kind: playlistKind,
          items: playlistAssetIds.map((assetId, index) => ({ assetId, order: index }))
        }
      });
      setPlaylistName('');
      setPlaylistAssetIds([]);
      setNotice(label('Playlist created.', 'تم إنشاء قائمة التشغيل.'));
      await loadLibrary(pagination.page);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeletePlaylist(id) {
    setBusy(true);
    setError('');
    try {
      await api(`/media/playlists/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await loadLibrary(pagination.page);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Film className="w-5 h-5 text-cyan-400" />
          <h1 className="text-base font-bold font-mono text-white uppercase tracking-wide">
            {label('Media Library & Resumable Ingest', 'مكتبة الوسائط الاحترافية والرفع القابل للاستئناف')}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}>
            {viewMode === 'grid' ? <List className="w-4 h-4 me-1" /> : <LayoutGrid className="w-4 h-4 me-1" />}
            {viewMode === 'grid' ? label('List view', 'عرض كقائمة') : label('Grid view', 'عرض كشبكة')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => loadLibrary(pagination.page)}>
            <RefreshCw className="w-4 h-4 me-1" />
            {label('Refresh', 'تحديث')}
          </Button>
        </div>
      </div>

      {error && <p role="alert" className="rounded border border-red-800 bg-red-950/40 p-2.5 text-xs text-red-300">{error}</p>}
      {notice && <p role="status" className="rounded border border-emerald-800 bg-emerald-950/40 p-2.5 text-xs text-emerald-300">{notice}</p>}

      {/* Storage & Disk Usage Banner */}
      {storageInfo && (
        <Card>
          <CardContent className="p-3 flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-cyan-400" />
              <span>
                {label('Organization Storage:', 'تخزين المؤسسة:')}{' '}
                <strong className="text-white">{formatBytes(storageInfo.storedBytes)}</strong>
                {' / '}
                {formatBytes(storageInfo.quotaBytes)}
                {storageInfo.reservedUploadBytes > 0 && ` (${label('Reserved:', 'محجوز للرفع:')} ${formatBytes(storageInfo.reservedUploadBytes)})`}
              </span>
            </div>
            <div>
              {label('Free Disk Space:', 'المساحة الحرة على القرص:')}{' '}
              <strong className={storageInfo.disk?.lowDiskAlert ? 'text-amber-400' : 'text-emerald-400'}>
                {formatBytes(storageInfo.disk?.freeBytes)}
              </strong>
              {storageInfo.disk?.lowDiskAlert && (
                <span className="ms-2 rounded bg-amber-900/50 px-2 py-0.5 text-amber-300">
                  {label('LOW STORAGE ALERT', 'تنبيه انخفاض المساحة')}
                </span>
              )}
            </div>
            <div>
              {label('Max File Size:', 'أقصى حجم للملف:')}{' '}
              <strong className="text-white">{formatBytes(storageInfo.limits?.maxFileSizeBytes)}</strong>
              {' · '}
              {label('Max Duration:', 'أقصى مدة:')}{' '}
              <strong className="text-white">{Math.round((storageInfo.limits?.maxDurationSeconds || 0) / 3600)}h</strong>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upload & Import Controls */}
      {canUpload && (
        <Card>
          <CardHeader>
            <CardTitle>{label('Upload & Import Media (Movies, Audio, Ads, Logos)', 'رفع واستيراد الوسائط (أفلام، صوتيات، إعلانات، شعارات)')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2">
              <label className="space-y-1">
                <span>{label('Title (optional)', 'العنوان (اختياري)')}</span>
                <Input value={uploadTitle} onChange={e => setUploadTitle(e.target.value)} maxLength={250} placeholder={label('Media title', 'عنوان الملف')} />
              </label>
              <label className="space-y-1">
                <span>{label('Category', 'التصنيف')}</span>
                <select className="w-full rounded bg-zinc-900 border border-zinc-700 p-2 text-white" value={uploadCategory} onChange={e => setUploadCategory(e.target.value)}>
                  {MEDIA_CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{CATEGORY_LABELS[cat]?.[ar ? 'ar' : 'en'] || cat}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span>{label('Folder', 'المجلد')}</span>
                <Input value={uploadFolder} onChange={e => setUploadFolder(e.target.value)} maxLength={160} placeholder={label('e.g. movies/2026', 'مثال: movies/2026')} />
              </label>
              <label className="space-y-1">
                <span>{label('Tags (comma-separated)', 'الوسوم (مفصولة بفاصلة)')}</span>
                <Input value={uploadTags} onChange={e => setUploadTags(e.target.value)} placeholder={label('drama, hd, prime', 'فيلم, عالي الدقة')} />
              </label>
              <label className="space-y-1">
                <span>{label('Authorized Channel', 'القناة المرتبطة')}</span>
                <select className="w-full rounded bg-zinc-900 border border-zinc-700 p-2 text-white" value={uploadChannelId} onChange={e => setUploadChannelId(e.target.value)}>
                  <option value="">{label('All organization channels', 'كافة قنوات المؤسسة')}</option>
                  {stations.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded bg-cyan-700 px-3 py-2 font-semibold text-white hover:bg-cyan-600">
                <Upload className="w-4 h-4" />
                <span>{label('Select File for Resumable Upload', 'اختر ملفًا للرفع القابل للاستئناف')}</span>
                <input
                  type="file"
                  className="hidden"
                  accept=".mp4,.mkv,.mov,.avi,.ts,.m2ts,.webm,.mp3,.aac,.wav,.flac,.m4a,.ogg,.png,.jpg,.jpeg,.webp"
                  onChange={startFileUpload}
                />
              </label>
              <Button type="button" variant="outline" size="sm" onClick={openDirectoryImport}>
                <FolderInput className="w-4 h-4 me-1" />
                {label('Import from Server Directory', 'استيراد من مجلد الخادم المصرّح')}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setImportMode(importMode === 'url' ? '' : 'url')}>
                <Globe className="w-4 h-4 me-1" />
                {label('Import from Direct HTTPS URL', 'استيراد من رابط HTTPS مباشر')}
              </Button>
            </div>

            {importMode === 'directory' && (
              <form onSubmit={handleDirectoryImport} className="flex flex-wrap items-end gap-2 rounded border border-zinc-800 bg-zinc-950 p-3">
                <label className="flex-1 space-y-1">
                  <span>{label('Authorized Server Import Directory Files', 'ملفات مجلد الاستيراد المصرّح على الخادم')}</span>
                  <select className="w-full rounded bg-zinc-900 border border-zinc-700 p-2" value={selectedServerFile} onChange={e => setSelectedServerFile(e.target.value)}>
                    {serverFiles.length === 0 && <option value="">{label('No files in server import directory', 'لا توجد ملفات في مجلد الاستيراد')}</option>}
                    {serverFiles.map(f => <option key={f.filename} value={f.filename}>{f.filename} ({formatBytes(f.sizeBytes)})</option>)}
                  </select>
                </label>
                <Button disabled={busy || !selectedServerFile}>{label('Import Selected File', 'استيراد الملف المحدد')}</Button>
                <Button type="button" variant="outline" onClick={() => setImportMode('')}>{label('Cancel', 'إلغاء')}</Button>
              </form>
            )}

            {importMode === 'url' && (
              <form onSubmit={handleUrlImport} className="flex flex-wrap items-end gap-2 rounded border border-zinc-800 bg-zinc-950 p-3">
                <label className="flex-1 space-y-1">
                  <span>{label('Direct HTTPS Media URL (SSRF-Protected)', 'رابط الوسائط المباشر عبر HTTPS (محمي ضد SSRF)')}</span>
                  <Input type="url" required value={remoteUrl} onChange={e => setRemoteUrl(e.target.value)} placeholder="https://example.com/media/movie.mp4" />
                </label>
                <Button disabled={busy || !remoteUrl.trim()}>{label('Start URL Import', 'بدء الاستيراد من الرابط')}</Button>
                <Button type="button" variant="outline" onClick={() => setImportMode('')}>{label('Cancel', 'إلغاء')}</Button>
              </form>
            )}

            {/* Active Resumable Upload Queue */}
            {uploadQueue.length > 0 && (
              <div className="space-y-2 border-t border-zinc-800 pt-3">
                <h3 className="font-semibold text-zinc-200">{label('Resumable Upload Queue', 'قائمة انتظار الرفع القابل للاستئناف')}</h3>
                {uploadQueue.map(item => {
                  const pct = item.expectedSizeBytes > 0
                    ? Math.min(100, Math.round((item.receivedBytes / item.expectedSizeBytes) * 100))
                    : 0;
                  return (
                    <div key={item.sessionId} className="rounded border border-zinc-800 bg-zinc-950 p-2.5 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <strong className="text-white">{item.title}</strong>
                          <span className="ms-2 text-zinc-400">({item.filename})</span>
                        </div>
                        <div className="flex items-center gap-2 font-mono">
                          <span>{pct}%</span>
                          <span>({formatBytes(item.receivedBytes)} / {formatBytes(item.expectedSizeBytes)})</span>
                          {item.speedBps > 0 && <span>· {formatBytes(item.speedBps)}/s</span>}
                          {item.etaSeconds !== null && item.state === 'uploading' && <span>· ETA {item.etaSeconds}s</span>}
                          <span className="uppercase text-cyan-400">{item.state}</span>
                        </div>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded bg-zinc-800">
                        <div className="h-full bg-cyan-500 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      {item.error && <p className="text-red-300">{item.error}</p>}
                      <div className="flex items-center gap-2">
                        {item.state === 'uploading' && (
                          <Button type="button" variant="outline" size="sm" onClick={() => pauseUpload(item.sessionId)}>
                            <Pause className="w-3.5 h-3.5 me-1" />
                            {label('Pause', 'إيقاف مؤقت')}
                          </Button>
                        )}
                        {item.state === 'paused' && (
                          <Button type="button" variant="outline" size="sm" onClick={() => resumeUpload(item.sessionId)}>
                            <Play className="w-3.5 h-3.5 me-1" />
                            {label('Resume', 'استئناف')}
                          </Button>
                        )}
                        {item.state !== 'completed' && (
                          <Button type="button" variant="outline" size="sm" onClick={() => cancelUpload(item.sessionId)}>
                            <XCircle className="w-3.5 h-3.5 me-1" />
                            {label('Cancel', 'إلغاء')}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Search & Filter Bar */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-end gap-3 text-xs">
          <form
            className="flex-1 min-w-[200px] flex items-end gap-2"
            onSubmit={e => { e.preventDefault(); void loadLibrary(1); }}
          >
            <label className="flex-1 space-y-1">
              <span>{label('Search Title, Filename, Tags', 'بحث في العنوان، اسم الملف، الوسوم')}</span>
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={label('Search media...', 'ابحث في الوسائط...')} />
            </label>
            <Button type="submit" size="sm">
              <Search className="w-3.5 h-3.5 me-1" />
              {label('Search', 'بحث')}
            </Button>
          </form>

          <label className="space-y-1">
            <span>{label('Category', 'التصنيف')}</span>
            <select className="block rounded bg-zinc-900 border border-zinc-700 p-2" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
              <option value="">{label('All Categories', 'كل التصنيفات')}</option>
              {MEDIA_CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{CATEGORY_LABELS[cat]?.[ar ? 'ar' : 'en'] || cat}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span>{label('Media Type', 'نوع الوسائط')}</span>
            <select className="block rounded bg-zinc-900 border border-zinc-700 p-2" value={kindFilter} onChange={e => setKindFilter(e.target.value)}>
              <option value="">{label('All Types', 'كل الأنواع')}</option>
              <option value="VIDEO">{label('Video', 'فيديو')}</option>
              <option value="AUDIO">{label('Audio', 'صوت')}</option>
              <option value="IMAGE">{label('Image / Graphic', 'صورة / شعار')}</option>
            </select>
          </label>

          <label className="space-y-1">
            <span>{label('Processing Status', 'حالة المعالجة')}</span>
            <select className="block rounded bg-zinc-900 border border-zinc-700 p-2" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">{label('All Statuses', 'كل الحالات')}</option>
              <option value="READY">READY</option>
              <option value="VALIDATING">VALIDATING</option>
              <option value="PROCESSING">PROCESSING</option>
              <option value="FAILED">FAILED</option>
              <option value="QUARANTINED">QUARANTINED</option>
            </select>
          </label>

          <label className="space-y-1">
            <span>{label('Sort By', 'ترتيب حسب')}</span>
            <select className="block rounded bg-zinc-900 border border-zinc-700 p-2" value={`${sortBy}:${sortOrder}`} onChange={e => {
              const [by, ord] = e.target.value.split(':');
              setSortBy(by);
              setSortOrder(ord);
            }}>
              <option value="createdAt:desc">{label('Newest First', 'الأحدث أولاً')}</option>
              <option value="createdAt:asc">{label('Oldest First', 'الأقدم أولاً')}</option>
              <option value="sizeBytes:desc">{label('Largest File Size', 'الأكبر حجماً')}</option>
              <option value="durationSeconds:desc">{label('Longest Duration', 'الأطول مدة')}</option>
              <option value="title:asc">{label('Title (A–Z)', 'العنوان (أ–ي)')}</option>
            </select>
          </label>
        </CardContent>
      </Card>

      {/* Main Content: Media Assets Grid/List & Preview Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className={selectedAsset ? 'lg:col-span-8' : 'lg:col-span-12'}>
          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between">
              <CardTitle>
                {label('Media Assets', 'ملفات الوسائط')} ({pagination.total})
              </CardTitle>
              <div className="flex items-center gap-2 text-xs">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page <= 1}
                  onClick={() => loadLibrary(pagination.page - 1)}
                >
                  {label('Previous', 'السابق')}
                </Button>
                <span className="font-mono">
                  {pagination.page} / {pagination.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => loadLibrary(pagination.page + 1)}
                >
                  {label('Next', 'التالي')}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {assets.length === 0 ? (
                <p className="py-8 text-center text-xs text-zinc-400">
                  {label('No media assets match the current filter.', 'لا توجد ملفات وسائط مطابقة للبحث الحالي.')}
                </p>
              ) : viewMode === 'grid' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {assets.map(asset => (
                    <div
                      key={asset.id}
                      onClick={() => setSelectedAsset(asset)}
                      className={`cursor-pointer rounded border p-2.5 transition-all text-xs space-y-2 ${
                        selectedAsset?.id === asset.id
                          ? 'border-cyan-500 bg-zinc-800/80'
                          : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'
                      }`}
                    >
                      <div className="relative aspect-video w-full overflow-hidden rounded bg-zinc-900 flex items-center justify-center">
                        {asset.thumbnailKey ? (
                          <img
                            src={`/api/v1/media/assets/${encodeURIComponent(asset.id)}/thumbnail`}
                            alt={asset.title}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <span className="font-mono text-[11px] text-zinc-500 uppercase">{asset.kind}</span>
                        )}
                        <span className="absolute bottom-1 end-1 rounded bg-black/80 px-1.5 py-0.5 font-mono text-[10px] text-white">
                          {formatDuration(asset.durationSeconds)}
                        </span>
                      </div>
                      <div>
                        <div className="font-bold text-white truncate">{asset.title}</div>
                        <div className="text-[11px] text-zinc-400 truncate">
                          {CATEGORY_LABELS[asset.category]?.[ar ? 'ar' : 'en'] || asset.category} · {formatBytes(asset.sizeBytes)}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] font-mono">
                        <span className={`px-1.5 py-0.5 rounded ${
                          asset.processingStatus === 'READY'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : asset.processingStatus === 'FAILED' || asset.processingStatus === 'QUARANTINED'
                              ? 'bg-red-950 text-red-300 border border-red-800'
                              : 'bg-amber-950 text-amber-300 border border-amber-800'
                        }`}>
                          {asset.processingStatus}
                        </span>
                        <span className="text-zinc-400">{asset.references?.usageState || 'AVAILABLE'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-zinc-950 text-zinc-400 uppercase border-b border-zinc-800">
                      <tr>
                        <th className="p-2">{label('Title', 'العنوان')}</th>
                        <th className="p-2">{label('Category', 'التصنيف')}</th>
                        <th className="p-2">{label('Format / Codec', 'الصيغة / الترميز')}</th>
                        <th className="p-2">{label('Duration', 'المدة')}</th>
                        <th className="p-2">{label('Size', 'الحجم')}</th>
                        <th className="p-2">{label('Status', 'الحالة')}</th>
                        <th className="p-2">{label('Usage', 'الاستخدام')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60">
                      {assets.map(asset => (
                        <tr
                          key={asset.id}
                          onClick={() => setSelectedAsset(asset)}
                          className={`cursor-pointer hover:bg-zinc-800/40 ${selectedAsset?.id === asset.id ? 'bg-zinc-800/70' : ''}`}
                        >
                          <td className="p-2 font-bold text-white">{asset.title}</td>
                          <td className="p-2 text-zinc-300">{CATEGORY_LABELS[asset.category]?.[ar ? 'ar' : 'en'] || asset.category}</td>
                          <td className="p-2 text-zinc-400">
                            {[asset.containerFormat, asset.videoCodec, asset.audioCodec].filter(Boolean).join(' / ') || '—'}
                          </td>
                          <td className="p-2 text-zinc-300">{formatDuration(asset.durationSeconds)}</td>
                          <td className="p-2 text-zinc-300">{formatBytes(asset.sizeBytes)}</td>
                          <td className="p-2 text-cyan-400">{asset.processingStatus}</td>
                          <td className="p-2 text-zinc-400">{asset.references?.usageState || 'AVAILABLE'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Selected Media Inspector & Safe Deletion Panel */}
        {selectedAsset && (
          <div className="lg:col-span-4">
            <Card>
              <CardHeader className="flex items-center justify-between">
                <CardTitle>{label('Media Inspector & Preview', 'معاينة وتفاصيل الملف')}</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => { setSelectedAsset(null); setConfirmDeleteId(null); }}>
                  ✕
                </Button>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                {selectedAsset.processingStatus === 'READY' && (
                  <div className="overflow-hidden rounded border border-zinc-800 bg-black">
                    {selectedAsset.kind === 'VIDEO' && (
                      <video
                        key={selectedAsset.id}
                        controls
                        preload="metadata"
                        className="aspect-video w-full"
                        src={`/api/v1/media/assets/${encodeURIComponent(selectedAsset.id)}/preview`}
                      />
                    )}
                    {selectedAsset.kind === 'AUDIO' && (
                      <div className="p-3">
                        <audio
                          key={selectedAsset.id}
                          controls
                          preload="metadata"
                          className="w-full"
                          src={`/api/v1/media/assets/${encodeURIComponent(selectedAsset.id)}/preview`}
                        />
                      </div>
                    )}
                    {selectedAsset.kind === 'IMAGE' && (
                      <img
                        src={`/api/v1/media/assets/${encodeURIComponent(selectedAsset.id)}/preview`}
                        alt={selectedAsset.title}
                        className="max-h-60 w-full object-contain"
                      />
                    )}
                  </div>
                )}

                <div className="space-y-1 font-mono">
                  <p><span className="text-zinc-400">{label('Title:', 'العنوان:')}</span> <strong className="text-white">{selectedAsset.title}</strong></p>
                  <p><span className="text-zinc-400">{label('Filename:', 'اسم الملف الأصلي:')}</span> {selectedAsset.originalFilename}</p>
                  <p><span className="text-zinc-400">{label('Category:', 'التصنيف:')}</span> {CATEGORY_LABELS[selectedAsset.category]?.[ar ? 'ar' : 'en'] || selectedAsset.category}</p>
                  <p><span className="text-zinc-400">{label('Size:', 'الحجم:')}</span> {formatBytes(selectedAsset.sizeBytes)}</p>
                  <p><span className="text-zinc-400">{label('Duration:', 'المدة:')}</span> {formatDuration(selectedAsset.durationSeconds)}</p>
                  <p><span className="text-zinc-400">{label('Container / MIME:', 'الحاوية:')}</span> {selectedAsset.containerFormat || '—'} ({selectedAsset.mimeType})</p>
                  {selectedAsset.videoCodec && (
                    <p><span className="text-zinc-400">{label('Video:', 'الفيديو:')}</span> {selectedAsset.videoCodec} · {selectedAsset.width}×{selectedAsset.height} @ {selectedAsset.frameRate || '—'} fps</p>
                  )}
                  {selectedAsset.audioCodec && (
                    <p><span className="text-zinc-400">{label('Audio:', 'الصوت:')}</span> {selectedAsset.audioCodec} · {selectedAsset.audioChannels || '—'}ch @ {selectedAsset.sampleRateHz || '—'} Hz</p>
                  )}
                  <p><span className="text-zinc-400">{label('Compatibility:', 'التوافق مع البث:')}</span> <strong className="text-cyan-400">{selectedAsset.broadcastCompatibility}</strong></p>
                  <p><span className="text-zinc-400">{label('Usage Status:', 'حالة الارتباط:')}</span> <strong>{selectedAsset.references?.usageState}</strong></p>
                  <p className="break-all"><span className="text-zinc-400">SHA-256:</span> {selectedAsset.checksumSha256}</p>
                </div>

                {selectedAsset.compatibilityNotes?.length > 0 && (
                  <ul className="list-disc ps-4 text-zinc-300 space-y-0.5">
                    {selectedAsset.compatibilityNotes.map((note, idx) => <li key={idx}>{note}</li>)}
                  </ul>
                )}

                {selectedAsset.errorReason && (
                  <p role="alert" className="rounded border border-red-800 bg-red-950/50 p-2 text-red-300">
                    {selectedAsset.errorReason}
                  </p>
                )}

                {canUpload && selectedAsset.processingStatus === 'READY' && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (!playlistAssetIds.includes(selectedAsset.id)) {
                        setPlaylistAssetIds(prev => [...prev, selectedAsset.id]);
                      }
                    }}
                  >
                    {label('Add to Playlist Draft', 'إضافة إلى مسودة قائمة التشغيل')}
                  </Button>
                )}

                {canDelete && (
                  <div className="border-t border-zinc-800 pt-2">
                    {!selectedAsset.eligibleForDeletion ? (
                      <p className="text-amber-300">
                        {label('Deletion locked: referenced by ', 'الحذف مقفل لارتباط الملف بـ: ')}
                        {selectedAsset.references?.blockingReasons?.join(', ')}
                      </p>
                    ) : confirmDeleteId === selectedAsset.id ? (
                      <div className="space-y-2 rounded border border-red-800 bg-red-950/30 p-2">
                        <p className="text-red-200">
                          {label('Confirm permanent deletion of this media asset?', 'هل تؤكد الحذف النهائي لملف الوسائط هذا؟')}
                        </p>
                        <div className="flex gap-2">
                          <Button disabled={busy} onClick={() => handleDeleteAsset(selectedAsset.id)}>
                            {label('Confirm Delete', 'تأكيد الحذف')}
                          </Button>
                          <Button type="button" variant="outline" onClick={() => setConfirmDeleteId(null)}>
                            {label('Cancel', 'إلغاء')}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button type="button" variant="outline" size="sm" onClick={() => setConfirmDeleteId(selectedAsset.id)}>
                        <Trash2 className="w-3.5 h-3.5 me-1 text-red-400" />
                        {label('Delete Media Asset', 'حذف ملف الوسائط')}
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Video & Audio Playlists Section */}
      <Card>
        <CardHeader>
          <CardTitle>{label('Video & Audio Playlists (Movie Channel & Independent Audio Ready)', 'قوائم تشغيل الفيديو والصوت (جاهزة لقناة الأفلام والصوت المستقل)')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          {canUpload && (
            <form onSubmit={handleCreatePlaylist} className="flex flex-wrap items-end gap-2 rounded border border-zinc-800 bg-zinc-950 p-3">
              <label className="space-y-1">
                <span>{label('Playlist Name', 'اسم قائمة التشغيل')}</span>
                <Input value={playlistName} onChange={e => setPlaylistName(e.target.value)} placeholder={label('e.g. Weekend Movies 72h', 'مثال: أفلام نهاية الأسبوع')} />
              </label>
              <label className="space-y-1">
                <span>{label('Playlist Type', 'النوع')}</span>
                <select className="block rounded bg-zinc-900 border border-zinc-700 p-2" value={playlistKind} onChange={e => setPlaylistKind(e.target.value)}>
                  <option value="VIDEO">{label('Video Playlist', 'قائمة فيديو')}</option>
                  <option value="AUDIO">{label('Audio Playlist', 'قائمة صوتيات')}</option>
                </select>
              </label>
              <div className="text-zinc-400">
                {label('Draft items selected:', 'العناصر المحددة في المسودة:')} <strong className="text-white">{playlistAssetIds.length}</strong>
              </div>
              <Button disabled={busy || !playlistName.trim() || playlistAssetIds.length === 0}>
                {label('Save Playlist', 'حفظ قائمة التشغيل')}
              </Button>
              {playlistAssetIds.length > 0 && (
                <Button type="button" variant="outline" onClick={() => setPlaylistAssetIds([])}>
                  {label('Clear Draft', 'مسح المسودة')}
                </Button>
              )}
            </form>
          )}

          {playlists.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {playlists.map(pl => (
                <div key={pl.id} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950 p-2.5">
                  <div>
                    <strong className="text-white">{pl.name}</strong>
                    <p className="text-zinc-400 font-mono">{pl.kind} · {pl.items.length} {label('items', 'عناصر')}</p>
                  </div>
                  {canDelete && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => handleDeletePlaylist(pl.id)}>
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
