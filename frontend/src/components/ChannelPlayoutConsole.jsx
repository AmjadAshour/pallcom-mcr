import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@mcr/ui';
import {
  Activity,
  Camera,
  Cpu,
  Film,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Square,
  Volume2
} from 'lucide-react';
import { api } from '../context/api.js';

export function ChannelPlayoutConsole({ stationId, language, canControl, canManage, canEmergency }) {
  const isAr = language === 'ar';
  const [snapshot, setSnapshot] = useState(null);
  const [monitorFrame, setMonitorFrame] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  const loadSnapshot = useCallback(async () => {
    if (!stationId) return;
    setLoading(true);
    try {
      const [res, mon] = await Promise.all([
        api(`/channels/${stationId}/playout`),
        api(`/channels/${stationId}/playout/monitor-frame`).catch(() => ({ data: {} }))
      ]);
      setSnapshot(res.data || null);
      setMonitorFrame(mon.data?.frame || null);
    } catch (err) {
      setErrorMessage(err.message || 'Failed to load channel playout state');
    } finally {
      setLoading(false);
    }
  }, [stationId]);

  useEffect(() => {
    void loadSnapshot();
    const timer = setInterval(() => {
      if (!document.hidden) void loadSnapshot();
    }, 3000);
    return () => clearInterval(timer);
  }, [loadSnapshot]);

  if (!snapshot) return null;
  const { config, runtime } = snapshot;
  const ws = runtime?.workerStatus || {};
  const fp = ws.filePlayer || {};
  const resMetrics = runtime?.resources || {};
  const isRunning = config.runtimeState === 'RUNNING' || config.runtimeState === 'FALLBACK_ACTIVE';

  const handleLifecycle = async (action) => {
    try {
      setErrorMessage('');
      const res = await api(`/channels/${stationId}/playout/lifecycle`, {
        method: 'POST',
        body: { action }
      });
      setSnapshot(res.data);
      setStatusMessage(
        isAr
          ? `تم تنفيذ أمر البث (${action}) بنجاح`
          : `Executed channel playout action (${action})`
      );
    } catch (err) {
      setErrorMessage(err.message || `Failed to ${action} channel playout`);
    }
  };

  const handleUpdateMode = async (playoutMode) => {
    try {
      setErrorMessage('');
      const res = await api(`/channels/${stationId}/playout/config`, {
        method: 'PATCH',
        body: { playoutMode }
      });
      setSnapshot(res.data);
    } catch (err) {
      setErrorMessage(err.message || 'Failed to update playout mode');
    }
  };

  const handleEmergency = async (enabled) => {
    try {
      setErrorMessage('');
      const res = await api(`/channels/${stationId}/playout/emergency`, {
        method: 'POST',
        body: { enabled }
      });
      setSnapshot(res.data);
    } catch (err) {
      setErrorMessage(err.message || 'Emergency override failed');
    }
  };

  const handleMoviePauseToggle = async () => {
    try {
      setErrorMessage('');
      const res = await api(`/channels/${stationId}/playout/movie/pause`, {
        method: 'POST',
        body: { paused: !config.paused }
      });
      setSnapshot(res.data);
    } catch (err) {
      setErrorMessage(err.message || 'Failed to toggle movie pause');
    }
  };

  const handleManualCameraSwitch = async (cameraIndex) => {
    try {
      setErrorMessage('');
      const res = await api(`/channels/${stationId}/playout/camera/switch`, {
        method: 'POST',
        body: { cameraIndex }
      });
      setSnapshot(res.data);
    } catch (err) {
      setErrorMessage(err.message || 'Failed to switch camera');
    }
  };

  const handleManualMovieSelect = async (movieIndex) => {
    try {
      setErrorMessage('');
      const res = await api(`/channels/${stationId}/playout/movie/select`, {
        method: 'POST',
        body: { movieIndex, seekMs: 0 }
      });
      setSnapshot(res.data);
    } catch (err) {
      setErrorMessage(err.message || 'Failed to select movie item');
    }
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/90 p-4 space-y-4">
      {/* Header & Lifecycle Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2.5">
          <Activity className={`w-5 h-5 ${isRunning ? 'text-emerald-400 animate-pulse' : 'text-zinc-500'}`} />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-mono font-bold uppercase text-white">
                {isAr ? 'محرك البث التلفزيوني المستقل على الخادم (Full HD 1080p)' : 'Server-Side Multi-Channel Playout Engine (Full HD 1080p)'}
              </h2>
              <span className="rounded bg-zinc-800 border border-zinc-700 px-2 py-0.5 text-[10px] font-mono text-cyan-300">
                {config.width}×{config.height} @ {config.frameRate}fps · {config.activeEncoder}
              </span>
              <span
                className={`rounded px-2 py-0.5 text-[10px] font-mono font-bold ${
                  config.runtimeState === 'RUNNING'
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/50'
                    : config.runtimeState === 'FALLBACK_ACTIVE'
                      ? 'bg-amber-950 text-amber-300 border border-amber-700/50'
                      : config.runtimeState === 'FAILED'
                        ? 'bg-red-950 text-red-300 border border-red-700/50'
                        : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {config.runtimeState} (Desired: {config.desiredState})
              </span>
            </div>
            <p className="text-[11px] font-mono text-zinc-400">
              {isAr
                ? `وضع التشغيل: ${config.playoutMode} | منفذ UDP: ${config.outputUdpPort || 'تلقائي'} | الإعادات: ${config.restartCount}`
                : `Mode: ${config.playoutMode} | UDP Port: ${config.outputUdpPort || 'auto'} | Restarts: ${config.restartCount}`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canManage && (
            <select
              value={config.playoutMode}
              onChange={(e) => void handleUpdateMode(e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs font-mono text-white"
            >
              <option value="CAMERA_ROTATION">{isAr ? 'تدوير الكاميرات الحية (القناة 1)' : 'CAMERA_ROTATION (Ch 1)'}</option>
              <option value="MOVIE_PLAYOUT">{isAr ? 'بث الأفلام والإعلانات المستمر (القناة 2)' : 'MOVIE_PLAYOUT (Ch 2)'}</option>
              <option value="HYBRID_PLAYOUT">{isAr ? 'بث هجين' : 'HYBRID_PLAYOUT'}</option>
            </select>
          )}

          {canControl && (
            <>
              <Button
                variant="primary"
                size="sm"
                disabled={isRunning}
                onClick={() => void handleLifecycle('start')}
              >
                <Play className="w-3.5 h-3.5 me-1" />
                {isAr ? 'بدء البث' : 'Start'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!isRunning}
                onClick={() => void handleLifecycle('stop')}
              >
                <Square className="w-3.5 h-3.5 me-1" />
                {isAr ? 'إيقاف' : 'Stop'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleLifecycle('restart')}
              >
                <RotateCcw className="w-3.5 h-3.5 me-1" />
                {isAr ? 'إعادة تشغيل' : 'Restart'}
              </Button>
            </>
          )}

          {canEmergency && (
            <Button
              variant={config.emergencyActive ? 'danger' : 'outline'}
              size="sm"
              onClick={() => void handleEmergency(!config.emergencyActive)}
            >
              <ShieldAlert className="w-3.5 h-3.5 me-1" />
              {config.emergencyActive
                ? (isAr ? 'إلغاء وضع الطوارئ' : 'Clear Emergency')
                : (isAr ? 'طوارئ البث' : 'Emergency Cut')}
            </Button>
          )}

          <Link
            to="/audio"
            className="inline-flex items-center rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs font-mono text-cyan-300 hover:border-cyan-500"
          >
            <Volume2 className="w-3.5 h-3.5 me-1" />
            {isAr ? 'مازج الصوت' : 'Audio Mixer'}
          </Link>

          <Button variant="outline" size="sm" onClick={() => void loadSnapshot()} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {errorMessage && (
        <div className="rounded border border-red-500/40 bg-red-950/30 px-3 py-2 text-xs font-mono text-red-300">
          {errorMessage}
        </div>
      )}
      {statusMessage && (
        <div className="rounded border border-cyan-500/40 bg-cyan-950/30 px-3 py-2 text-xs font-mono text-cyan-200">
          {statusMessage}
        </div>
      )}

      {/* Telemetry, Preview & Queue Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs font-mono">
        {/* Live Server Monitor Frame */}
        <div className="rounded border border-zinc-800 bg-zinc-950 p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-2">
            <span>{isAr ? 'معاينة مخرج القناة الفعلي' : 'Actual Decoded Channel Output'}</span>
            <span>{ws.measuredBitrateKbps ?? 0} kbps | {ws.programAudioDbfs ?? -90} dBFS</span>
          </div>
          <div className="aspect-video bg-black rounded border border-zinc-800 flex items-center justify-center overflow-hidden">
            {monitorFrame ? (
              <img src={monitorFrame} alt="Channel Output Monitor" className="w-full h-full object-contain" />
            ) : (
              <span className="text-zinc-600 text-[11px]">
                {isRunning
                  ? (isAr ? 'جاري استقبال إطارات البث...' : 'Waiting for monitor frame...')
                  : (isAr ? 'المحرك متوقف' : 'Channel worker stopped')}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between text-[10px] text-zinc-500 mt-2">
            <span>Frames: {ws.videoFramesEncoded ?? 0}</span>
            <span>A/V Drift: {ws.avSyncDriftMs ?? 0} ms</span>
            <span>HLS: {ws.hls || 'disabled'}</span>
          </div>
        </div>

        {/* Active Source / Rotation / Movie Position */}
        <div className="rounded border border-zinc-800 bg-zinc-950 p-3 space-y-2.5">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5">
            <span className="font-bold text-zinc-300">
              {config.playoutMode === 'CAMERA_ROTATION' ? (
                <span className="inline-flex items-center gap-1">
                  <Camera className="w-3.5 h-3.5 text-cyan-400" />
                  {isAr ? 'تدوير الكاميرات الحية' : 'Live Camera Rotation'}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Film className="w-3.5 h-3.5 text-amber-400" />
                  {isAr ? 'قائمة بث الأفلام' : 'Continuous Movie Playout'}
                </span>
              )}
            </span>
            <span className="text-[10px] text-zinc-400">
              {isAr ? 'المصدر الحالي:' : 'Active:'} <strong className="text-white">{config.currentSourceId || 'slate'}</strong>
            </span>
          </div>

          {config.playoutMode === 'CAMERA_ROTATION' ? (
            <div className="space-y-1.5 max-h-36 overflow-y-auto">
              {(config.cameraSequence || []).length === 0 ? (
                <p className="text-zinc-500 text-[11px]">
                  {isAr ? 'لا توجد كاميرات مضافة في تسلسل التدوير بعد.' : 'No cameras configured in rotation sequence yet.'}
                </p>
              ) : (
                config.cameraSequence.map((cam, idx) => (
                  <div
                    key={cam.id || cam.sourceId || idx}
                    className={`flex items-center justify-between rounded px-2 py-1 border ${
                      idx === config.activeCameraIndex
                        ? 'border-cyan-500/60 bg-cyan-950/20 text-white'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-400'
                    }`}
                  >
                    <span className="truncate">
                      #{idx + 1} {cam.name || cam.sourceId} ({cam.durationSeconds || 10}s)
                    </span>
                    {canControl && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleManualCameraSwitch(idx)}
                        className="h-6 px-2 text-[10px]"
                      >
                        TAKE
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-zinc-300">
                <span>
                  {isAr ? 'الموقع:' : 'Position:'} {Math.round((fp.positionMs || config.playbackPositionMs || 0) / 1000)}s
                </span>
                <span>
                  {isAr ? 'المتبقي:' : 'Remaining:'}{' '}
                  {fp.remainingMs != null
                    ? `${Math.round(fp.remainingMs / 1000)}s`
                    : config.remainingDurationMs != null
                      ? `${Math.round(config.remainingDurationMs / 1000)}s`
                      : '--'}
                </span>
                {canControl && isRunning && (
                  <Button variant="outline" size="sm" onClick={() => void handleMoviePauseToggle()} className="h-6 px-2 text-[10px]">
                    <Pause className="w-3 h-3 me-1" />
                    {config.paused ? (isAr ? 'استئناف' : 'Resume') : (isAr ? 'إيقاف مؤقت' : 'Pause')}
                  </Button>
                )}
              </div>
              <div className="space-y-1 max-h-28 overflow-y-auto">
                {(config.movieQueue || []).map((m, idx) => (
                  <div
                    key={m.id || m.assetId || idx}
                    className={`flex items-center justify-between rounded px-2 py-1 border ${
                      idx === config.activeMovieIndex
                        ? 'border-amber-500/60 bg-amber-950/20 text-white'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-400'
                    }`}
                  >
                    <span className="truncate">
                      #{idx + 1} {m.title || m.assetId}
                    </span>
                    {canControl && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleManualMovieSelect(idx)}
                        className="h-6 px-2 text-[10px]"
                      >
                        PLAY
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {runtime?.nextItem && (
            <div className="pt-1 border-t border-zinc-800 text-[10px] text-zinc-400">
              {isAr ? 'التالي في القائمة:' : 'Next Up:'}{' '}
              <strong className="text-zinc-200">
                {runtime.nextItem.name || runtime.nextItem.title || runtime.nextItem.sourceId || runtime.nextItem.assetId}
              </strong>
            </div>
          )}
        </div>

        {/* Resource & Admission Telemetry */}
        <div className="rounded border border-zinc-800 bg-zinc-950 p-3 space-y-2">
          <div className="flex items-center gap-1.5 border-b border-zinc-800 pb-1.5 font-bold text-zinc-300">
            <Cpu className="w-3.5 h-3.5 text-emerald-400" />
            <span>{isAr ? 'موارد الخادم وحالة العزل' : 'Server Resources & Supervisor Health'}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded bg-zinc-900 p-2 border border-zinc-800">
              <span className="text-zinc-500 block text-[10px]">{isAr ? 'القنوات النشطة' : 'Active Channels'}</span>
              <strong className="text-white">
                {resMetrics.activeWorkers ?? 0} / {resMetrics.maxConcurrentChannels ?? 4}
              </strong>
            </div>
            <div className="rounded bg-zinc-900 p-2 border border-zinc-800">
              <span className="text-zinc-500 block text-[10px]">{isAr ? 'ذاكرة الخادم (RSS)' : 'Process RSS RAM'}</span>
              <strong className="text-white">{resMetrics.processRssMb ?? 0} MB</strong>
            </div>
            <div className="rounded bg-zinc-900 p-2 border border-zinc-800">
              <span className="text-zinc-500 block text-[10px]">{isAr ? 'الذاكرة الحرة' : 'Host Free RAM'}</span>
              <strong className="text-emerald-300">{resMetrics.hostFreeMemoryMb ?? 0} MB</strong>
            </div>
            <div className="rounded bg-zinc-900 p-2 border border-zinc-800">
              <span className="text-zinc-500 block text-[10px]">{isAr ? 'زمن التبديل الأخير' : 'Last Switch Time'}</span>
              <strong className="text-cyan-300">{ws.lastTransitionMs ?? 0} ms</strong>
            </div>
          </div>
          {config.lastError && (
            <div className="rounded bg-amber-950/40 border border-amber-700/40 px-2 py-1 text-[10px] text-amber-200 truncate" title={config.lastError}>
              {isAr ? 'آخر حدث/استرداد:' : 'Last Event:'} {config.lastError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
