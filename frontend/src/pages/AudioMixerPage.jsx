import React, { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useMcrStore } from '../context/useMcrStore.js';
import { ProgramAudioControls } from '../components/ProgramAudioControls.jsx';
import { translations } from '../i18n/translations.js';
import { Button, AudioMeter } from '@mcr/ui';
import {
  Volume2,
  VolumeX,
  Mic,
  Radio,
  Music,
  Plus,
  Trash2,
  RefreshCw,
  Headphones,
  ShieldAlert,
  Sliders,
  Activity
} from 'lucide-react';
import { api } from '../context/api.js';

const apiFetch = async (path, options = {}) => {
  const normalizedOptions = { ...options };
  if (typeof normalizedOptions.body === 'string') {
    try {
      normalizedOptions.body = JSON.parse(normalizedOptions.body);
    } catch {
      // keep raw
    }
  }
  const result = await api(path, normalizedOptions);
  return result.data || {};
};

const AUDIO_SOURCE_TYPES = [
  'UPLOADED_AUDIO',
  'MUSIC_PLAYLIST',
  'INTERNET_RADIO',
  'ICECAST_STREAM',
  'SHOUTCAST_STREAM',
  'MICROPHONE_INPUT',
  'VIDEO_EXTRACTED_AUDIO',
  'OBS_AUDIO_INPUT',
  'ADVERTISEMENT_AUDIO',
  'FALLBACK_AUDIO',
  'GENERATED_SILENCE'
];

const AUDIO_ROUTING_MODES = [
  'ORIGINAL_VIDEO_AUDIO_ONLY',
  'EXTERNAL_REPLACES_VIDEO_AUDIO',
  'MIX_VIDEO_AND_EXTERNAL_AUDIO',
  'MIX_MULTIPLE_EXTERNAL_SOURCES',
  'SILENT_VIDEO_WITH_INDEPENDENT_AUDIO',
  'MICROPHONE_COMMENTARY_OVER_PROGRAM'
];

const AUDIO_AD_POLICIES = [
  'REPLACE_MUSIC_PAUSE_PLAYLIST',
  'REPLACE_MUSIC_CONTINUE_PLAYLIST',
  'DUCK_MUSIC_DURING_ADS',
  'IGNORE_AD_AUDIO'
];

export function AudioMixerPage() {
  const { language, stations, selectedStationId, selectStation, setInputVolume, setInputMute, pending } = useMcrStore();
  const { permissions } = useOutletContext();
  const t = translations[language] || translations.en;
  const isAr = language === 'ar';

  const currentStation = stations.find((s) => s.id === selectedStationId) || stations[0];
  const canControl = permissions.includes('*') || permissions.includes('station:control') || permissions.includes('audio:manage');

  const [audioSources, setAudioSources] = useState([]);
  const [mixerConfig, setMixerConfig] = useState(null);
  const [runtimeState, setRuntimeState] = useState(null);
  const [mediaAssets, setMediaAssets] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  const [newSourceForm, setNewSourceForm] = useState({
    name: '',
    sourceType: 'UPLOADED_AUDIO',
    mediaAssetId: '',
    playlistId: '',
    streamUrl: '',
    secretToken: '',
    priority: 50,
    duckingTrigger: false,
    duckingTarget: true,
    volumeLinear: 1.0,
    gainDb: 0
  });

  const loadChannelAudioState = useCallback(async () => {
    if (!currentStation) return;
    setLoading(true);
    setErrorMessage('');
    try {
      const [audioState, mediaRes, playlistRes] = await Promise.all([
        apiFetch(`/channels/${currentStation.id}/audio`),
        apiFetch('/media?limit=100').catch(() => ({ items: [] })),
        apiFetch('/media/playlists').catch(() => ([]))
      ]);
      setAudioSources(audioState.sources || []);
      setMixerConfig(audioState.mixer || null);
      setMediaAssets(mediaRes.items || []);
      setPlaylists(Array.isArray(playlistRes) ? playlistRes : (playlistRes.playlists || []));
    } catch (err) {
      setErrorMessage(err.message || 'Failed to load channel audio mixer');
    } finally {
      setLoading(false);
    }
  }, [currentStation]);

  useEffect(() => {
    void loadChannelAudioState();
  }, [loadChannelAudioState]);

  if (!currentStation) return null;
  const disabled = !currentStation.ready || Boolean(pending[currentStation.id]) || !canControl;

  const handleUpdateMixerConfig = async (patch) => {
    try {
      setErrorMessage('');
      const updated = await apiFetch(`/channels/${currentStation.id}/audio/mixer`, {
        method: 'PATCH',
        body: JSON.stringify(patch)
      });
      setMixerConfig(updated);
      setStatusMessage(isAr ? 'تم تحديث إعدادات مازج الصوت للقناة' : 'Channel audio mixer configuration updated');
    } catch (err) {
      setErrorMessage(err.message || 'Failed to update mixer configuration');
    }
  };

  const handleCreateAudioSource = async (event) => {
    event.preventDefault();
    try {
      setErrorMessage('');
      const payload = {
        name: newSourceForm.name,
        sourceType: newSourceForm.sourceType,
        mediaAssetId: newSourceForm.mediaAssetId || null,
        playlistId: newSourceForm.playlistId || null,
        streamUrl: newSourceForm.streamUrl || null,
        secret: newSourceForm.secretToken || undefined,
        priority: Number(newSourceForm.priority || 50),
        duckingTrigger: Boolean(newSourceForm.duckingTrigger),
        duckingTarget: Boolean(newSourceForm.duckingTarget),
        volumeLinear: Number(newSourceForm.volumeLinear ?? 1),
        gainDb: Number(newSourceForm.gainDb ?? 0)
      };
      await apiFetch(`/channels/${currentStation.id}/audio/sources`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      setShowAddModal(false);
      setNewSourceForm({
        name: '',
        sourceType: 'UPLOADED_AUDIO',
        mediaAssetId: '',
        playlistId: '',
        streamUrl: '',
        secretToken: '',
        priority: 50,
        duckingTrigger: false,
        duckingTarget: true,
        volumeLinear: 1.0,
        gainDb: 0
      });
      await loadChannelAudioState();
    } catch (err) {
      setErrorMessage(err.message || 'Failed to create audio source');
    }
  };

  const handleUpdateAudioSource = async (sourceId, patch) => {
    try {
      setErrorMessage('');
      await apiFetch(`/channels/${currentStation.id}/audio/sources/${sourceId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch)
      });
      await loadChannelAudioState();
    } catch (err) {
      setErrorMessage(err.message || 'Failed to update audio source');
    }
  };

  const handleDeleteAudioSource = async (sourceId) => {
    try {
      setErrorMessage('');
      await apiFetch(`/channels/${currentStation.id}/audio/sources/${sourceId}?confirm=true`, {
        method: 'DELETE'
      });
      await loadChannelAudioState();
    } catch (err) {
      setErrorMessage(err.message || 'Failed to delete audio source');
    }
  };

  const handleProbeAudioSource = async (sourceId) => {
    try {
      setErrorMessage('');
      const probed = await apiFetch(`/channels/${currentStation.id}/audio/sources/${sourceId}/probe`, {
        method: 'POST'
      });
      setStatusMessage(
        probed?.state === 'PLAYING' || probed?.state === 'ONLINE'
          ? (isAr ? 'فحص مصدر الصوت ناجح وجاهز للبث' : 'Audio source probe healthy and ready')
          : `${isAr ? 'تنبيه فحص الصوت:' : 'Audio probe warning:'} ${probed?.lastError || probed?.state || 'UNAVAILABLE'}`
      );
      await loadChannelAudioState();
    } catch (err) {
      setErrorMessage(err.message || 'Failed to probe audio source');
    }
  };

  const handleToggleMicrophone = async (source) => {
    const isActive = source.state === 'PLAYING';
    try {
      setErrorMessage('');
      await apiFetch(
        `/channels/${currentStation.id}/audio/sources/${source.id}/microphone`,
        {
          method: 'POST',
          body: JSON.stringify({ action: isActive ? 'deactivate' : 'activate' })
        }
      );
      await loadChannelAudioState();
    } catch (err) {
      setErrorMessage(err.message || 'Failed to toggle microphone state');
    }
  };

  const handleTriggerRealPcmMix = async () => {
    try {
      setErrorMessage('');
      const res = await apiFetch(`/channels/${currentStation.id}/audio/step`, {
        method: 'POST',
        body: JSON.stringify({ frames: 1, persistMeters: true })
      });
      setRuntimeState(res);
      setStatusMessage(
        isAr
          ? `تم مزج إطار PCM حقيقي (RMS: ${res.masterRmsDbfs ?? -90} dBFS | Peak: ${res.masterPeakDbfs ?? -90} dBFS)`
          : `Mixed real 48 kHz PCM frame (RMS: ${res.masterRmsDbfs ?? -90} dBFS | Peak: ${res.masterPeakDbfs ?? -90} dBFS)`
      );
      await loadChannelAudioState();
    } catch (err) {
      setErrorMessage(err.message || 'Failed to execute real PCM mix frame');
    }
  };

  return (
    <div className="space-y-5">
      {/* Target Station Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <Volume2 className="w-6 h-6 text-cyan-400" />
          <div>
            <h1 className="text-base font-bold font-mono text-white uppercase tracking-wide">
              {t.audio.title}
            </h1>
            <p className="text-xs text-zinc-400">
              {isAr
                ? 'مازج الصوت الاحترافي متعدد المسارات ومصادر الصوت المستقلة (48 kHz Stereo PCM)'
                : 'Independent Multi-Track Audio Sources & Professional 48 kHz Stereo Broadcast Mixer'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={currentStation.id}
            onChange={(e) => selectStation(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 text-white font-mono text-xs rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-cyan-500"
          >
            {stations.map((st) => (
              <option key={st.id} value={st.id}>
                {st.name} ({st.studioName})
              </option>
            ))}
          </select>

          <Button variant="outline" size="sm" onClick={() => void loadChannelAudioState()} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 me-1 ${loading ? 'animate-spin' : ''}`} />
            {isAr ? 'تحديث' : 'Refresh'}
          </Button>

          {canControl && (
            <Button variant="primary" size="sm" onClick={() => setShowAddModal(true)}>
              <Plus className="w-3.5 h-3.5 me-1" />
              {isAr ? 'إضافة مصدر صوت' : 'Add Audio Source'}
            </Button>
          )}
        </div>
      </div>

      {errorMessage && (
        <div className="rounded border border-red-500/40 bg-red-950/30 px-3 py-2 text-xs text-red-300 font-mono">
          {errorMessage}
        </div>
      )}
      {statusMessage && (
        <div className="rounded border border-cyan-500/40 bg-cyan-950/30 px-3 py-2 text-xs text-cyan-200 font-mono">
          {statusMessage}
        </div>
      )}

      {/* Master Audio Routing, Ducking, Crossfade & Limiter Console */}
      {mixerConfig && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-cyan-400" />
              <h2 className="text-xs font-mono font-bold uppercase text-white">
                {isAr ? 'وحدة التوجيه والمزج الرئيسي للقناة' : 'Channel Master Audio Routing & DSP Bus'}
              </h2>
              <span className="rounded bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 text-[10px] font-mono text-cyan-300">
                48000 Hz / 16-bit Stereo
              </span>
              {mixerConfig.clippingPrevented && (
                <span className="rounded bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-[10px] font-mono text-amber-300">
                  {isAr ? 'محدد الذروة نشط (منع التشوه)' : 'PEAK LIMITER ACTIVE'}
                </span>
              )}
              {runtimeState?.fallbackActive && (
                <span className="rounded bg-red-500/20 border border-red-500/40 px-2 py-0.5 text-[10px] font-mono text-red-300">
                  {isAr ? 'الصوت الاحتياطي نشط' : 'FALLBACK AUDIO ACTIVE'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-zinc-400">
                RMS: <strong className="text-white">{mixerConfig.measuredMasterRmsDbfs ?? -90} dBFS</strong> | Peak:{' '}
                <strong className="text-cyan-300">{mixerConfig.measuredMasterPeakDbfs ?? -90} dBFS</strong>
              </span>
              {canControl && (
                <Button variant="outline" size="sm" onClick={() => void handleTriggerRealPcmMix()}>
                  <Activity className="w-3.5 h-3.5 me-1 text-cyan-400" />
                  {isAr ? 'فحص ومزج PCM' : 'Mix & Measure PCM'}
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
            {/* Routing Mode */}
            <div>
              <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                {isAr ? 'وضع توجيه الصوت' : 'Audio Routing Mode'}
              </label>
              <select
                disabled={!canControl}
                value={mixerConfig.routingMode}
                onChange={(e) => void handleUpdateMixerConfig({ routingMode: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 font-mono text-xs text-white"
              >
                {AUDIO_ROUTING_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </div>

            {/* Advertisement Audio Policy */}
            <div>
              <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                {isAr ? 'سياسة صوت الإعلانات والفواصل' : 'Advertisement Audio Policy'}
              </label>
              <select
                disabled={!canControl}
                value={mixerConfig.adAudioPolicy}
                onChange={(e) => void handleUpdateMixerConfig({ adAudioPolicy: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 font-mono text-xs text-white"
              >
                {AUDIO_AD_POLICIES.map((policy) => (
                  <option key={policy} value={policy}>
                    {policy}
                  </option>
                ))}
              </select>
            </div>

            {/* Master Volume & Gain */}
            <div>
              <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                {isAr ? 'مستوى الصوت الرئيسي' : 'Master Volume'} ({Math.round((mixerConfig.masterVolumeLinear ?? 1) * 100)}% /{' '}
                {mixerConfig.masterGainDb ?? 0} dB)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="1.5"
                  step="0.05"
                  disabled={!canControl}
                  value={mixerConfig.masterVolumeLinear ?? 1}
                  onChange={(e) => void handleUpdateMixerConfig({ masterVolumeLinear: Number(e.target.value) })}
                  className="flex-1 accent-cyan-400"
                />
                <Button
                  variant={mixerConfig.masterMuted ? 'danger' : 'outline'}
                  size="sm"
                  disabled={!canControl}
                  onClick={() => void handleUpdateMixerConfig({ masterMuted: !mixerConfig.masterMuted })}
                >
                  {mixerConfig.masterMuted ? 'MUTED' : 'MUTE'}
                </Button>
              </div>
            </div>

            {/* Ducking & Camera Audio Mute */}
            <div className="flex flex-col justify-between gap-1.5">
              <label className="flex items-center gap-2 cursor-pointer text-[11px] font-mono text-zinc-300">
                <input
                  type="checkbox"
                  disabled={!canControl}
                  checked={Boolean(mixerConfig.duckingEnabled)}
                  onChange={(e) => void handleUpdateMixerConfig({ duckingEnabled: e.target.checked })}
                />
                {isAr ? `خفض تلقائي للموسيقى (${mixerConfig.duckingReductionDb} dB)` : `Auto Ducking (${mixerConfig.duckingReductionDb} dB)`}
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-[11px] font-mono text-zinc-300">
                <input
                  type="checkbox"
                  disabled={!canControl}
                  checked={Boolean(mixerConfig.cameraAudioMuted)}
                  onChange={(e) => void handleUpdateMixerConfig({ cameraAudioMuted: e.target.checked })}
                />
                {isAr ? 'كتم صوت الكاميرا/الفيديو واستخدام الصوت المستقل' : 'Mute Camera/Video Embedded Audio'}
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Multi-Track Independent Audio Channel Strips */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-mono font-bold uppercase text-zinc-300">
            {isAr ? 'مسارات ومصادر الصوت المستقلة للقناة' : 'Independent Channel Audio Tracks & Sources'} ({audioSources.length})
          </h3>
          <span className="text-[11px] font-mono text-zinc-400">
            {isAr ? 'زر SOLO للمراقبة فقط ولا يكتم البث المباشر' : 'SOLO MON affects monitoring bus only — never mutes live Program output'}
          </span>
        </div>

        <div className="flex gap-4 overflow-x-auto pb-4 pt-1">
          {audioSources.map((src) => {
            const isMic = src.sourceType === 'MICROPHONE_INPUT';
            const isRadio = ['INTERNET_RADIO', 'ICECAST_STREAM', 'SHOUTCAST_STREAM'].includes(src.sourceType);
            const isMicActive = isMic && src.state === 'PLAYING';

            return (
              <div
                key={src.id}
                className={`w-48 shrink-0 bg-zinc-900 border rounded-lg p-3 flex flex-col justify-between shadow-md select-none ${
                  src.soloMonitoring
                    ? 'border-amber-500/70 ring-1 ring-amber-500/30'
                    : src.state === 'PLAYING'
                      ? 'border-cyan-500/60'
                      : 'border-zinc-800'
                }`}
              >
                {/* Header */}
                <div className="w-full pb-2 border-b border-zinc-800">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-cyan-300 truncate max-w-[115px]">
                      {src.sourceType}
                    </span>
                    <span
                      className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                        src.state === 'PLAYING' || src.state === 'READY'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/40'
                          : src.state === 'FAILED'
                            ? 'bg-red-950 text-red-300 border border-red-700/40'
                            : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      {src.state}
                    </span>
                  </div>
                  <h4 className="text-xs font-mono font-bold text-white truncate" title={src.name}>
                    {src.name}
                  </h4>
                  <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 mt-0.5">
                    <span>Prio: {src.priority}</span>
                    <span>
                      {src.duckingTrigger ? 'DUCK-TRIG' : src.duckingTarget ? 'DUCK-TGT' : 'NO-DUCK'}
                    </span>
                  </div>
                </div>

                {/* Meter & Fader */}
                <div className="flex items-center justify-center gap-3 my-3 h-40">
                  <AudioMeter
                    levelDb={src.measuredRmsDbfs ?? -90}
                    peakDb={src.measuredPeakDbfs ?? -90}
                    isMuted={src.muted || !src.enabled}
                    orientation="vertical"
                  />

                  <div className="flex flex-col items-center h-full justify-between py-1">
                    <span className="text-[9px] font-mono text-zinc-500">+6 dB</span>
                    <input
                      type="range"
                      min="0"
                      max="1.5"
                      step="0.05"
                      disabled={!canControl}
                      aria-label={src.name + ' volume'}
                      value={src.volumeLinear ?? 1}
                      onChange={(e) =>
                        void handleUpdateAudioSource(src.id, { volumeLinear: Number(e.target.value) })
                      }
                      className="h-28 -rotate-90 origin-center accent-cyan-400 cursor-pointer"
                    />
                    <span className="text-[9px] font-mono text-zinc-500">-inf</span>
                  </div>
                </div>

                {/* Measured dBFS Readout */}
                <div className="w-full bg-zinc-950 border border-zinc-800 rounded py-1 px-2 text-center font-mono text-[10px] text-zinc-200 mb-2">
                  {src.muted ? 'MUTED' : `${Math.round((src.volumeLinear ?? 1) * 100)}% (${src.gainDb ?? 0} dB)`}
                  <div className="text-[9px] text-zinc-400">
                    RMS {src.measuredRmsDbfs ?? -90} / PK {src.measuredPeakDbfs ?? -90} dBFS
                  </div>
                </div>

                {/* Controls */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1">
                    <Button
                      variant={src.muted ? 'danger' : 'outline'}
                      size="sm"
                      disabled={!canControl}
                      onClick={() => void handleUpdateAudioSource(src.id, { muted: !src.muted })}
                      className="flex-1 text-[10px] font-mono py-1 h-7"
                    >
                      {src.muted ? <VolumeX className="w-3 h-3 me-1" /> : <Volume2 className="w-3 h-3 me-1" />}
                      MUTE
                    </Button>
                    <Button
                      variant={src.soloMonitoring ? 'primary' : 'outline'}
                      size="sm"
                      disabled={!canControl}
                      onClick={() => void handleUpdateAudioSource(src.id, { soloMonitoring: !src.soloMonitoring })}
                      className="flex-1 text-[10px] font-mono py-1 h-7"
                      title="Monitoring-only Solo (does not mute live Program broadcast)"
                    >
                      <Headphones className="w-3 h-3 me-1" />
                      SOLO
                    </Button>
                  </div>

                  {isMic && (
                    <Button
                      variant={isMicActive ? 'danger' : 'outline'}
                      size="sm"
                      disabled={!canControl}
                      onClick={() => void handleToggleMicrophone(src)}
                      className="w-full text-[10px] font-mono py-1 h-7"
                    >
                      <Mic className="w-3 h-3 me-1" />
                      {isMicActive
                        ? (isAr ? 'إيقاف الميكروفون' : 'Deactivate Mic')
                        : (isAr ? 'تفعيل الميكروفون' : 'Activate Mic')}
                    </Button>
                  )}

                  <div className="flex items-center gap-1">
                    {isRadio && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!canControl}
                        onClick={() => void handleProbeAudioSource(src.id)}
                        className="flex-1 text-[10px] font-mono py-1 h-7"
                      >
                        <Radio className="w-3 h-3 me-1" />
                        Probe
                      </Button>
                    )}
                    {canControl && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleDeleteAudioSource(src.id)}
                        className="text-[10px] font-mono py-1 h-7 text-red-400"
                        title="Delete Audio Source"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Add Audio Source Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <form
            onSubmit={handleCreateAudioSource}
            className="w-full max-w-lg rounded-lg border border-zinc-700 bg-zinc-900 p-5 space-y-3 text-xs text-white"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <h3 className="font-mono font-bold text-sm uppercase">
                {isAr ? 'إضافة مصدر صوت مستقل جديد' : 'Add Independent Audio Source'}
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-zinc-400 hover:text-white font-mono"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                {isAr ? 'اسم المصدر' : 'Source Name'}
              </label>
              <input
                type="text"
                required
                value={newSourceForm.name}
                onChange={(e) => setNewSourceForm({ ...newSourceForm, name: e.target.value })}
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                  {isAr ? 'نوع مصدر الصوت' : 'Source Type'}
                </label>
                <select
                  value={newSourceForm.sourceType}
                  onChange={(e) => setNewSourceForm({ ...newSourceForm, sourceType: e.target.value })}
                  className="w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 font-mono"
                >
                  {AUDIO_SOURCE_TYPES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                  {isAr ? 'الأولوية (0 - 100)' : 'Priority (0 - 100)'}
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={newSourceForm.priority}
                  onChange={(e) => setNewSourceForm({ ...newSourceForm, priority: Number(e.target.value) })}
                  className="w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 font-mono"
                />
              </div>
            </div>

            {['UPLOADED_AUDIO', 'ADVERTISEMENT_AUDIO', 'FALLBACK_AUDIO'].includes(newSourceForm.sourceType) && (
              <div>
                <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                  {isAr ? 'ملف الصوت من مكتبة الوسائط' : 'Media Library Audio Asset'}
                </label>
                <select
                  value={newSourceForm.mediaAssetId}
                  onChange={(e) => setNewSourceForm({ ...newSourceForm, mediaAssetId: e.target.value })}
                  className="w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 font-mono"
                >
                  <option value="">{isAr ? '-- اختر ملفاً صوتياً --' : '-- Select Media Asset --'}</option>
                  {mediaAssets
                    .filter((m) => m.hasAudio)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title} ({m.category})
                      </option>
                    ))}
                </select>
              </div>
            )}

            {newSourceForm.sourceType === 'MUSIC_PLAYLIST' && (
              <div>
                <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                  {isAr ? 'قائمة التشغيل الموسيقية' : 'Music Playlist'}
                </label>
                <select
                  value={newSourceForm.playlistId}
                  onChange={(e) => setNewSourceForm({ ...newSourceForm, playlistId: e.target.value })}
                  className="w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 font-mono"
                >
                  <option value="">{isAr ? '-- اختر قائمة تشغيل --' : '-- Select Playlist --'}</option>
                  {playlists.map((pl) => (
                    <option key={pl.id} value={pl.id}>
                      {pl.name} ({pl.items?.length || 0} tracks)
                    </option>
                  ))}
                </select>
              </div>
            )}

            {['INTERNET_RADIO', 'ICECAST_STREAM', 'SHOUTCAST_STREAM'].includes(newSourceForm.sourceType) && (
              <>
                <div>
                  <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                    {isAr ? 'رابط بث الراديو (HTTP / HTTPS)' : 'Radio Stream URL (HTTP / HTTPS)'}
                  </label>
                  <input
                    type="url"
                    required
                    placeholder="https://stream.example.com/live.mp3"
                    value={newSourceForm.streamUrl}
                    onChange={(e) => setNewSourceForm({ ...newSourceForm, streamUrl: e.target.value })}
                    className="w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                    {isAr ? 'رمز المصادقة السري (يشفر بـ AES-256-GCM)' : 'Optional Stream Token (Encrypted via AES-256-GCM)'}
                  </label>
                  <input
                    type="password"
                    value={newSourceForm.secretToken}
                    onChange={(e) => setNewSourceForm({ ...newSourceForm, secretToken: e.target.value })}
                    className="w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 font-mono"
                  />
                </div>
              </>
            )}

            <div className="flex items-center gap-4 pt-1">
              <label className="flex items-center gap-2 cursor-pointer font-mono text-[11px]">
                <input
                  type="checkbox"
                  checked={newSourceForm.duckingTrigger}
                  onChange={(e) => setNewSourceForm({ ...newSourceForm, duckingTrigger: e.target.checked })}
                />
                {isAr ? 'محفز خفض الصوت (ميكروفون/تعليق)' : 'Ducking Trigger (Mic/Voiceover)'}
              </label>
              <label className="flex items-center gap-2 cursor-pointer font-mono text-[11px]">
                <input
                  type="checkbox"
                  checked={newSourceForm.duckingTarget}
                  onChange={(e) => setNewSourceForm({ ...newSourceForm, duckingTarget: e.target.checked })}
                />
                {isAr ? 'يُخفض تلقائياً عند التحدث' : 'Ducking Target (Background Music)'}
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowAddModal(false)}>
                {isAr ? 'إلغاء' : 'Cancel'}
              </Button>
              <Button type="submit" variant="primary" size="sm">
                {isAr ? 'حفظ المصدر' : 'Create Audio Source'}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Existing Program Audio Engine Controls */}
      <ProgramAudioControls key={currentStation.id} stationId={currentStation.id} language={language} canControl={canControl} />

      {/* Existing OBS Audio Inputs */}
      {currentStation.ready && currentStation.audioInputs.length > 0 && (
        <details className="rounded border border-zinc-800 p-3">
          <summary className="cursor-pointer font-semibold">
            {isAr ? 'مداخل صوت OBS' : 'OBS audio inputs'}
          </summary>
          <div className="flex gap-4 overflow-x-auto pb-4 pt-2">
            {currentStation.audioInputs.map((input) => {
              const isMaster = input.name.toLowerCase().includes('master');
              const commitVolume = (event) => {
                const mul = Number(event.currentTarget.value);
                if (mul !== input.volumeMul) void setInputVolume(currentStation.id, input.name, mul);
              };

              return (
                <div
                  key={input.name}
                  className={`w-36 shrink-0 bg-zinc-900 border rounded-lg p-3 flex flex-col justify-between items-center shadow-md select-none ${
                    isMaster ? 'border-cyan-500/60 bg-zinc-900/95 ring-1 ring-cyan-500/30' : 'border-zinc-800'
                  }`}
                >
                  <div className="text-center w-full pb-2 border-b border-zinc-800">
                    <Mic className={`w-4 h-4 mx-auto mb-1 ${isMaster ? 'text-cyan-400' : 'text-zinc-400'}`} />
                    <h4 className="text-xs font-mono font-bold text-white truncate px-1" title={input.name}>
                      {input.name}
                    </h4>
                    <span className="text-[10px] font-mono text-zinc-500">
                      {isMaster ? (t.audio?.busOut || 'BUS OUT') : (t.audio?.input || 'INPUT')}
                    </span>
                  </div>

                  <div className="flex items-center justify-center gap-3 my-4 h-48">
                    <AudioMeter
                      levelDb={input.levelDb ?? -60}
                      peakDb={input.peakDb ?? -60}
                      isMuted={input.muted}
                      orientation="vertical"
                    />

                    <div className="flex flex-col items-center h-full justify-between py-1">
                      <span className="text-[9px] font-mono text-zinc-500">0 dB</span>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        key={input.volumeMul}
                        disabled={disabled}
                        aria-label={input.name + ' volume'}
                        defaultValue={input.volumeMul}
                        onPointerUp={commitVolume}
                        onBlur={commitVolume}
                        className="h-32 -rotate-90 origin-center accent-cyan-400 cursor-pointer"
                      />
                      <span className="text-[9px] font-mono text-zinc-500">-inf</span>
                    </div>
                  </div>

                  <div className="w-full bg-zinc-950 border border-zinc-800 rounded py-1 text-center font-mono text-xs font-bold text-zinc-200 mb-3">
                    {input.muted ? 'MUTED' : `${input.volumeDb} dB`}
                  </div>

                  <div className="w-full flex items-center gap-1.5">
                    <Button
                      variant={input.muted ? 'danger' : 'outline'}
                      size="sm"
                      disabled={disabled}
                      onClick={() => setInputMute(currentStation.id, input.name, !input.muted)}
                      className="flex-1 text-[11px] font-mono font-bold py-1 h-7"
                    >
                      {input.muted ? <VolumeX className="w-3.5 h-3.5 me-1" /> : <Volume2 className="w-3.5 h-3.5 me-1" />}
                      {t.audio.mute}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}
