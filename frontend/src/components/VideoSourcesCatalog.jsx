import React, { useCallback, useEffect, useState } from 'react';
import { VIDEO_SOURCE_TYPES } from '@mcr/shared';
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@mcr/ui';
import { Activity, Eye, Plus, RefreshCw, ShieldAlert, Trash2, Video } from 'lucide-react';
import { api } from '../context/api.js';

const SOURCE_TYPE_LABELS = {
  UPLOADED_FILE: { en: 'Uploaded Video File', ar: 'ملف فيديو مرفوع' },
  MOVIE: { en: 'Full-Length Movie', ar: 'فيلم طويل' },
  PLAYLIST: { en: 'Video Playlist', ar: 'قائمة تشغيل فيديو' },
  OBS_LIVE: { en: 'OBS Live Station Stream', ar: 'بث محطة OBS مباشر' },
  HLS_STREAM: { en: 'External HLS/M3U8 Stream', ar: 'بث خارجي HLS / M3U8' },
  RTMP_STREAM: { en: 'External RTMP/RTMPS Stream', ar: 'بث خارجي RTMP / RTMPS' },
  SRT_STREAM: { en: 'External SRT Stream', ar: 'بث خارجي SRT' },
  RTSP_STREAM: { en: 'External RTSP Camera Stream', ar: 'بث كاميرا RTSP' },
  REMOTE_VIDEO_URL: { en: 'Direct Remote Video URL', ar: 'رابط ملف فيديو خارجي مباشر' },
  SERVER_FILE: { en: 'Authorized Server Media File', ar: 'ملف وسائط على الخادم المصرّح' }
};

export function VideoSourcesCatalog({ language, stations, canManageVideo }) {
  const ar = language === 'ar';
  const label = (en, arText) => (ar ? arText : en);

  const [sources, setSources] = useState([]);
  const [mediaAssets, setMediaAssets] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [serverFiles, setServerFiles] = useState([]);

  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedSource, setSelectedSource] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState('MOVIE');
  const [formStationId, setFormStationId] = useState('');
  const [formAssetId, setFormAssetId] = useState('');
  const [formPlaylistId, setFormPlaylistId] = useState('');
  const [formStreamUrl, setFormStreamUrl] = useState('');
  const [formSecret, setFormSecret] = useState('');
  const [formServerFile, setFormServerFile] = useState('');
  const [formMaxRetries, setFormMaxRetries] = useState(5);
  const [formBackoffBase, setFormBackoffBase] = useState(2000);
  const [formFallbackMode, setFormFallbackMode] = useState('SLATE');
  const [formFallbackSourceId, setFormFallbackSourceId] = useState('');
  const [formFallbackAssetId, setFormFallbackAssetId] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadCatalog = useCallback(async () => {
    try {
      const q = new URLSearchParams({
        ...(typeFilter ? { sourceType: typeFilter } : {}),
        ...(search.trim() ? { search: search.trim() } : {})
      });
      const [sourcesRes, assetsRes, playlistsRes] = await Promise.all([
        api('/video-sources?' + q.toString()),
        api('/media/assets?kind=VIDEO&processingStatus=READY&pageSize=100'),
        api('/media/playlists?kind=VIDEO')
      ]);
      setSources(sourcesRes.data);
      setMediaAssets(assetsRes.data.items || []);
      setPlaylists(playlistsRes.data || []);
    } catch (err) {
      setError(err.message);
    }
  }, [typeFilter, search]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  async function openCreateForm() {
    setShowCreate(!showCreate);
    if (!showCreate && canManageVideo) {
      try {
        const res = await api('/media/import/directory');
        setServerFiles(res.data || []);
      } catch {
        // ignore
      }
    }
  }

  async function handleCreateSource(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body = {
        name: formName.trim(),
        sourceType: formType,
        stationId: formStationId || null,
        mediaAssetId: ['UPLOADED_FILE', 'MOVIE'].includes(formType) ? (formAssetId || null) : null,
        playlistId: formType === 'PLAYLIST' ? (formPlaylistId || null) : null,
        streamUrl: ['HLS_STREAM', 'RTMP_STREAM', 'SRT_STREAM', 'RTSP_STREAM', 'REMOTE_VIDEO_URL'].includes(formType)
          ? formStreamUrl.trim()
          : null,
        secret: formSecret.trim() ? formSecret.trim() : null,
        serverFilePath: formType === 'SERVER_FILE' ? formServerFile : null,
        reconnectEnabled: true,
        maxRetries: Number(formMaxRetries) || 5,
        backoffBaseMs: Number(formBackoffBase) || 2000,
        backoffMaxMs: Math.max(Number(formBackoffBase) || 2000, 30000),
        fallbackMode: formFallbackMode,
        fallbackSourceId: formFallbackSourceId || null,
        fallbackAssetId: formFallbackAssetId || null
      };
      await api('/video-sources', { method: 'POST', body });
      setFormName('');
      setFormStreamUrl('');
      setFormSecret('');
      setShowCreate(false);
      setNotice(label('Video source registered and validated.', 'تم تسجيل مصدر الفيديو والتحقق منه بنجاح.'));
      await loadCatalog();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleProbeSource(sourceId) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await api(`/video-sources/${encodeURIComponent(sourceId)}/probe`, { method: 'POST' });
      setSelectedSource(res.data);
      setNotice(label('Source health and connection probed.', 'تم فحص اتصال وجاهزية المصدر.'));
      await loadCatalog();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteSource(sourceId) {
    setBusy(true);
    setError('');
    try {
      await api(`/video-sources/${encodeURIComponent(sourceId)}?confirm=true`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      if (selectedSource?.id === sourceId) setSelectedSource(null);
      setNotice(label('Video source deleted.', 'تم حذف مصدر الفيديو.'));
      await loadCatalog();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Video className="w-4 h-4 text-cyan-400" />
          <CardTitle>
            {label('Unified Video Source Catalog (Files, Movies, Playlists, OBS, HLS, RTMP, SRT, RTSP)', 'كتالوج مصادر الفيديو الموحد (ملفات، أفلام، قوائم، OBS، HLS، RTMP، SRT، RTSP)')}
          </CardTitle>
        </div>
        <div className="flex items-center gap-2">
          {canManageVideo && (
            <Button size="sm" onClick={openCreateForm}>
              <Plus className="w-3.5 h-3.5 me-1" />
              {label('Add Video Source', 'إضافة مصدر فيديو')}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={loadCatalog}>
            <RefreshCw className="w-3.5 h-3.5 me-1" />
            {label('Refresh', 'تحديث')}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 text-xs">
        {error && <p role="alert" className="rounded border border-red-800 bg-red-950/40 p-2 text-red-300">{error}</p>}
        {notice && <p role="status" className="rounded border border-emerald-800 bg-emerald-950/40 p-2 text-emerald-300">{notice}</p>}

        {showCreate && canManageVideo && (
          <form onSubmit={handleCreateSource} className="space-y-3 rounded border border-zinc-800 bg-zinc-950 p-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
              <label className="space-y-1">
                <span>{label('Source Name', 'اسم المصدر')}</span>
                <Input required value={formName} onChange={e => setFormName(e.target.value)} maxLength={200} placeholder={label('e.g. Studio Camera 1 / Movie Feed', 'مثال: كاميرا الاستوديو 1')} />
              </label>
              <label className="space-y-1">
                <span>{label('Source Type', 'نوع المصدر')}</span>
                <select className="w-full rounded bg-zinc-900 border border-zinc-700 p-2 text-white" value={formType} onChange={e => setFormType(e.target.value)}>
                  {VIDEO_SOURCE_TYPES.map(t => (
                    <option key={t} value={t}>{SOURCE_TYPE_LABELS[t]?.[ar ? 'ar' : 'en'] || t}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span>{label('Associated Station / Channel', 'المحطة / القناة المرتبطة')}</span>
                <select className="w-full rounded bg-zinc-900 border border-zinc-700 p-2 text-white" value={formStationId} onChange={e => setFormStationId(e.target.value)}>
                  <option value="">{label('All organization stations', 'جميع محطات المؤسسة')}</option>
                  {stations.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
                </select>
              </label>

              {['UPLOADED_FILE', 'MOVIE'].includes(formType) && (
                <label className="space-y-1">
                  <span>{label('Validated Media Asset', 'ملف الفيديو من المكتبة')}</span>
                  <select required className="w-full rounded bg-zinc-900 border border-zinc-700 p-2 text-white" value={formAssetId} onChange={e => setFormAssetId(e.target.value)}>
                    <option value="">{label('Select READY video asset', 'اختر ملف فيديو جاهز')}</option>
                    {mediaAssets.map(a => <option key={a.id} value={a.id}>{a.title} ({a.width}×{a.height})</option>)}
                  </select>
                </label>
              )}

              {formType === 'PLAYLIST' && (
                <label className="space-y-1">
                  <span>{label('Video Playlist', 'قائمة تشغيل الفيديو')}</span>
                  <select required className="w-full rounded bg-zinc-900 border border-zinc-700 p-2 text-white" value={formPlaylistId} onChange={e => setFormPlaylistId(e.target.value)}>
                    <option value="">{label('Select video playlist', 'اختر قائمة تشغيل')}</option>
                    {playlists.map(p => <option key={p.id} value={p.id}>{p.name} ({p.items?.length || 0})</option>)}
                  </select>
                </label>
              )}

              {formType === 'SERVER_FILE' && (
                <label className="space-y-1">
                  <span>{label('Authorized Server File', 'ملف الخادم المصرّح')}</span>
                  <select required className="w-full rounded bg-zinc-900 border border-zinc-700 p-2 text-white" value={formServerFile} onChange={e => setFormServerFile(e.target.value)}>
                    <option value="">{label('Select server file', 'اختر ملفًا')}</option>
                    {serverFiles.map(f => <option key={f.filename} value={f.filename}>{f.filename}</option>)}
                  </select>
                </label>
              )}

              {['HLS_STREAM', 'RTMP_STREAM', 'SRT_STREAM', 'RTSP_STREAM', 'REMOTE_VIDEO_URL'].includes(formType) && (
                <>
                  <label className="space-y-1 sm:col-span-2">
                    <span>{label('Stream / Video URL (SSRF-Validated)', 'رابط البث أو الفيديو (محمي ضد SSRF)')}</span>
                    <Input required value={formStreamUrl} onChange={e => setFormStreamUrl(e.target.value)} placeholder="https://... | rtmp://... | srt://host:port?mode=caller | rtsp://..." />
                  </label>
                  <label className="space-y-1">
                    <span>{label('Passphrase / Token (Encrypted at Rest)', 'كلمة مرور البث / التوكن (تُشفّر)')}</span>
                    <Input type="password" value={formSecret} onChange={e => setFormSecret(e.target.value)} placeholder={label('Optional stream secret', 'اختياري')} />
                  </label>
                </>
              )}

              <label className="space-y-1">
                <span>{label('Max Reconnect Retries', 'أقصى محاولات إعادة الاتصال')}</span>
                <Input type="number" min={1} max={20} value={formMaxRetries} onChange={e => setFormMaxRetries(e.target.value)} />
              </label>
              <label className="space-y-1">
                <span>{label('Backoff Base (ms)', 'مهلة التراجع الأساسية (مللي ثانية)')}</span>
                <Input type="number" min={500} max={60000} value={formBackoffBase} onChange={e => setFormBackoffBase(e.target.value)} />
              </label>
              <label className="space-y-1">
                <span>{label('Fallback Policy', 'سياسة البديل التلقائي (Fallback)')}</span>
                <select className="w-full rounded bg-zinc-900 border border-zinc-700 p-2 text-white" value={formFallbackMode} onChange={e => setFormFallbackMode(e.target.value)}>
                  <option value="SLATE">{label('Safe Broadcast Slate', 'لوحة البث الاحتياطية (Slate)')}</option>
                  <option value="SOURCE">{label('Backup Video Source', 'مصدر فيديو بديل')}</option>
                  <option value="ASSET">{label('Fallback Media Asset', 'ملف فيديو احتياطي')}</option>
                  <option value="HOLD_LAST_FRAME">{label('Hold Last Frame', 'تثبيت آخر إطار')}</option>
                </select>
              </label>
              {formFallbackMode === 'SOURCE' && (
                <label className="space-y-1">
                  <span>{label('Fallback Video Source', 'المصدر البديل')}</span>
                  <select className="w-full rounded bg-zinc-900 border border-zinc-700 p-2 text-white" value={formFallbackSourceId} onChange={e => setFormFallbackSourceId(e.target.value)}>
                    <option value="">{label('Select fallback source', 'اختر مصدرًا بديلًا')}</option>
                    {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              )}
              {formFallbackMode === 'ASSET' && (
                <label className="space-y-1">
                  <span>{label('Fallback Media Asset', 'ملف الوسائط البديل')}</span>
                  <select className="w-full rounded bg-zinc-900 border border-zinc-700 p-2 text-white" value={formFallbackAssetId} onChange={e => setFormFallbackAssetId(e.target.value)}>
                    <option value="">{label('Select fallback asset', 'اختر ملفًا احتياطيًا')}</option>
                    {mediaAssets.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
                  </select>
                </label>
              )}
            </div>

            <div className="flex gap-2">
              <Button disabled={busy}>{label('Save Video Source', 'حفظ مصدر الفيديو')}</Button>
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>{label('Cancel', 'إلغاء')}</Button>
            </div>
          </form>
        )}

        {/* Filter Bar */}
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-[180px] space-y-1">
            <span>{label('Search Sources', 'بحث في المصادر')}</span>
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={label('Search by source name...', 'ابحث باسم المصدر...')} />
          </label>
          <label className="space-y-1">
            <span>{label('Filter by Type', 'تصفية حسب النوع')}</span>
            <select className="block rounded bg-zinc-900 border border-zinc-700 p-2" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              <option value="">{label('All Source Types', 'كل أنواع المصادر')}</option>
              {VIDEO_SOURCE_TYPES.map(t => (
                <option key={t} value={t}>{SOURCE_TYPE_LABELS[t]?.[ar ? 'ar' : 'en'] || t}</option>
              ))}
            </select>
          </label>
        </div>

        {/* Sources Table & Inspector */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          <div className={selectedSource ? 'lg:col-span-8' : 'lg:col-span-12'}>
            {sources.length === 0 ? (
              <p className="py-6 text-center text-zinc-400">
                {label('No video sources configured yet.', 'لم يتم تسجيل مصادر فيديو موحدة بعد.')}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead className="bg-zinc-950 text-zinc-400 uppercase border-b border-zinc-800">
                    <tr>
                      <th className="p-2">{label('Name', 'الاسم')}</th>
                      <th className="p-2">{label('Type', 'النوع')}</th>
                      <th className="p-2">{label('Connection', 'الاتصال')}</th>
                      <th className="p-2">{label('Availability', 'الجاهزية')}</th>
                      <th className="p-2">{label('Format / Resolution', 'الدقة / الترميز')}</th>
                      <th className="p-2">{label('Retries / Fallback', 'إعادة الاتصال / البديل')}</th>
                      <th className="p-2">{label('Actions', 'إجراءات')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {sources.map(src => (
                      <tr
                        key={src.id}
                        onClick={() => setSelectedSource(src)}
                        className={`cursor-pointer hover:bg-zinc-800/40 ${selectedSource?.id === src.id ? 'bg-zinc-800/70' : ''}`}
                      >
                        <td className="p-2 font-bold text-white">{src.name}</td>
                        <td className="p-2 text-zinc-300">{SOURCE_TYPE_LABELS[src.sourceType]?.[ar ? 'ar' : 'en'] || src.sourceType}</td>
                        <td className="p-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                            src.connectionStatus === 'ONLINE'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : src.connectionStatus === 'RECONNECTING'
                                ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                : 'bg-red-950 text-red-300 border border-red-800'
                          }`}>
                            {src.connectionStatus}
                          </span>
                        </td>
                        <td className="p-2 text-cyan-400">{src.availabilityStatus}</td>
                        <td className="p-2 text-zinc-300">
                          {src.width && src.height ? `${src.width}×${src.height}` : '—'}
                          {src.videoCodec ? ` · ${src.videoCodec}` : ''}
                          {src.hasAudio ? ' · Audio' : ''}
                        </td>
                        <td className="p-2 text-zinc-400">
                          {src.retryCount}/{src.maxRetries} · {src.fallbackMode}
                        </td>
                        <td className="p-2">
                          {canManageVideo && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              onClick={e => { e.stopPropagation(); void handleProbeSource(src.id); }}
                            >
                              <Activity className="w-3.5 h-3.5 me-1" />
                              {label('Probe', 'فحص')}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {selectedSource && (
            <div className="lg:col-span-4 rounded border border-zinc-800 bg-zinc-950 p-3 space-y-2.5">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <strong className="text-white">{selectedSource.name}</strong>
                <Button variant="ghost" size="sm" onClick={() => { setSelectedSource(null); setConfirmDeleteId(null); }}>✕</Button>
              </div>

              {selectedSource.mediaAssetId && (
                <div className="overflow-hidden rounded border border-zinc-800 bg-black">
                  <video
                    key={selectedSource.mediaAssetId}
                    controls
                    preload="metadata"
                    className="aspect-video w-full"
                    src={`/api/v1/media/assets/${encodeURIComponent(selectedSource.mediaAssetId)}/preview`}
                  />
                </div>
              )}

              <div className="space-y-1 font-mono text-[11px]">
                <p><span className="text-zinc-400">{label('Type:', 'النوع:')}</span> {SOURCE_TYPE_LABELS[selectedSource.sourceType]?.[ar ? 'ar' : 'en'] || selectedSource.sourceType}</p>
                <p><span className="text-zinc-400">{label('Connection:', 'حالة الاتصال:')}</span> <strong className="text-white">{selectedSource.connectionStatus}</strong></p>
                <p><span className="text-zinc-400">{label('Availability:', 'الجاهزية:')}</span> <strong className="text-cyan-400">{selectedSource.availabilityStatus}</strong></p>
                {selectedSource.streamUrl && <p className="break-all"><span className="text-zinc-400">URL:</span> {selectedSource.streamUrl}</p>}
                {selectedSource.hasSecret && <p className="text-emerald-400">{label('Encrypted credential stored (AES-256-GCM)', 'بيانات الاعتماد مشفرة ومحفوظة')}</p>}
                <p><span className="text-zinc-400">{label('Resolution:', 'الدقة:')}</span> {selectedSource.width && selectedSource.height ? `${selectedSource.width}×${selectedSource.height} @ ${selectedSource.frameRate || '—'} fps` : '—'}</p>
                <p><span className="text-zinc-400">{label('Codecs:', 'الترميز:')}</span> {[selectedSource.videoCodec, selectedSource.audioCodec].filter(Boolean).join(' / ') || '—'}</p>
                <p><span className="text-zinc-400">{label('Reconnect Policy:', 'إعادة الاتصال:')}</span> {selectedSource.reconnectEnabled ? `${selectedSource.retryCount}/${selectedSource.maxRetries} (${selectedSource.backoffBaseMs}–${selectedSource.backoffMaxMs} ms)` : 'Disabled'}</p>
                <p><span className="text-zinc-400">{label('Fallback Mode:', 'البديل التلقائي:')}</span> {selectedSource.fallbackMode}</p>
                {selectedSource.lastConnectedAt && <p><span className="text-zinc-400">{label('Last Connected:', 'آخر اتصال ناجح:')}</span> {new Date(selectedSource.lastConnectedAt).toLocaleString()}</p>}
              </div>

              {selectedSource.lastError && (
                <div className="flex items-start gap-2 rounded border border-amber-800 bg-amber-950/40 p-2 text-amber-300">
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{selectedSource.lastError}</span>
                </div>
              )}

              {canManageVideo && (
                <div className="flex flex-wrap gap-2 pt-2 border-t border-zinc-800">
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => handleProbeSource(selectedSource.id)}>
                    <Eye className="w-3.5 h-3.5 me-1" />
                    {label('Probe Health Now', 'فحص الاتصال الآن')}
                  </Button>
                  {confirmDeleteId === selectedSource.id ? (
                    <>
                      <Button type="button" size="sm" disabled={busy} onClick={() => handleDeleteSource(selectedSource.id)}>
                        {label('Confirm Delete', 'تأكيد الحذف')}
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setConfirmDeleteId(null)}>
                        {label('Cancel', 'إلغاء')}
                      </Button>
                    </>
                  ) : (
                    <Button type="button" variant="outline" size="sm" onClick={() => setConfirmDeleteId(selectedSource.id)}>
                      <Trash2 className="w-3.5 h-3.5 me-1 text-red-400" />
                      {label('Delete', 'حذف')}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
