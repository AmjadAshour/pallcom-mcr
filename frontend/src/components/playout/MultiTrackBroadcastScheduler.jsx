import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@mcr/ui';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Copy,
  FileText,
  History,
  Layers,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldAlert,
  SkipForward,
  Trash2,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { api } from '../../context/api.js';

const TRACK_DEFINITIONS = [
  { id: 'MAIN_VIDEO', en: '1. Main Video & Movies', ar: '1. الفيديو الرئيسي والأفلام', color: 'border-cyan-500/60 bg-cyan-950/30 text-cyan-200' },
  { id: 'LIVE_CAMERA_ROTATION', en: '2. Live Cameras & Rotation', ar: '2. الكاميرات الحية والتدوير', color: 'border-emerald-500/60 bg-emerald-950/30 text-emerald-200' },
  { id: 'INDEPENDENT_AUDIO', en: '3. Independent Audio & Music', ar: '3. الصوت المستقل والموسيقى', color: 'border-violet-500/60 bg-violet-950/30 text-violet-200' },
  { id: 'ADVERTISEMENTS', en: '4. Advertisements & Breaks', ar: '4. الفواصل والإعلانات التجارية', color: 'border-amber-500/60 bg-amber-950/30 text-amber-200' },
  { id: 'GRAPHICS_OVERLAYS', en: '5. Graphics & Watermarks', ar: '5. الشعارات والطبقات الرسومية', color: 'border-pink-500/60 bg-pink-950/30 text-pink-200' },
  { id: 'NEWS_TICKER', en: '6. News Ticker Strip', ar: '6. شريط الأخبار المتحرك', color: 'border-blue-500/60 bg-blue-950/30 text-blue-200' },
  { id: 'AUTOMATION_CONTROL', en: '7. Automation & Control Events', ar: '7. أوامر التحكم والأتمتة', color: 'border-zinc-500/60 bg-zinc-800/60 text-zinc-200' }
];

const EXECUTION_MODES = [
  'HARD_START',
  'SOFT_START',
  'FOLLOW_PREVIOUS',
  'FIXED_DURATION',
  'MANUAL_TRIGGER',
  'EMERGENCY_OVERRIDE'
];

const ACTIVATION_POLICIES = [
  'APPLY_IMMEDIATELY_SAFE',
  'APPLY_NEXT_BOUNDARY',
  'APPLY_FUTURE_TIME',
  'PRESERVE_CURRENT_ITEM',
  'REPLACE_CURRENT_AUTHORIZED'
];

const GAP_POLICIES = [
  'CONTINUE_CURRENT',
  'FALLBACK_PLAYLIST',
  'FALLBACK_MOVIE',
  'FALLBACK_CAMERA',
  'CHANNEL_IDENT_CLIP',
  'FALLBACK_IMAGE',
  'BLACK_SILENCE'
];

const RECURRENCE_FREQUENCIES = ['ONCE', 'DAILY', 'WEEKLY', 'SELECTED_WEEKDAYS'];

export function MultiTrackBroadcastScheduler({
  stationId,
  language,
  canManageSchedule,
  canPublishSchedule,
  canControlStation,
  canEmergency
}) {
  const isAr = language === 'ar';
  const [schedulerData, setSchedulerData] = useState(null);
  const [mediaAssets, setMediaAssets] = useState([]);
  const [videoSources, setVideoSources] = useState([]);
  const [audioSources, setAudioSources] = useState([]);

  const [viewMode, setViewMode] = useState('DAY'); // DAY | WEEK | AS_RUN | REVISIONS
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [zoomHours, setZoomHours] = useState(24);
  const [draftEvents, setDraftEvents] = useState([]);
  const [timezone, setTimezone] = useState('UTC');
  const [activationPolicy, setActivationPolicy] = useState('APPLY_NEXT_BOUNDARY');
  const [gapPolicy, setGapPolicy] = useState('FALLBACK_PLAYLIST');
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [validationResult, setValidationResult] = useState(null);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  const [newEventForm, setNewEventForm] = useState({
    title: '',
    trackType: 'MAIN_VIDEO',
    executionMode: 'HARD_START',
    localStartDateTime: `${new Date().toISOString().slice(0, 10)}T12:00:00`,
    durationSeconds: 1800,
    priority: 50,
    mediaAssetId: '',
    videoSourceId: '',
    audioSourceId: '',
    recurrenceFrequency: 'ONCE',
    weekdays: [0, 1, 2, 3, 4, 5, 6]
  });

  const loadSchedulerState = useCallback(async () => {
    if (!stationId) return;
    setLoading(true);
    setErrorMessage('');
    try {
      const startIso = `${selectedDate}T00:00:00.000Z`;
      const spanMs = (viewMode === 'WEEK' ? 7 : 1) * 24 * 3600000;
      const endIso = new Date(Date.parse(startIso) + spanMs).toISOString();

      const [schedRes, mediaRes, vSrcRes, aSrcRes] = await Promise.all([
        api(`/channels/${stationId}/scheduler?windowStartUtc=${encodeURIComponent(startIso)}&windowEndUtc=${encodeURIComponent(endIso)}`),
        api('/media?limit=100').catch(() => ({ data: { items: [] } })),
        api('/video-sources').catch(() => ({ data: { sources: [] } })),
        api(`/channels/${stationId}/audio/sources`).catch(() => ({ data: [] }))
      ]);

      const data = schedRes.data;
      setSchedulerData(data);
      setDraftEvents(data.draft?.events || []);
      setTimezone(data.draft?.timezone || 'UTC');
      setActivationPolicy(data.draft?.activationPolicy || 'APPLY_NEXT_BOUNDARY');
      setGapPolicy(data.draft?.gapPolicy || 'FALLBACK_PLAYLIST');
      setValidationResult(data.draft?.validationSummary?.errors ? data.draft.validationSummary : null);
      setMediaAssets(mediaRes.data?.items || []);
      setVideoSources(vSrcRes.data?.sources || vSrcRes.data || []);
      setAudioSources(Array.isArray(aSrcRes.data) ? aSrcRes.data : (aSrcRes.data?.sources || []));
    } catch (err) {
      setErrorMessage(err.message || 'Failed to load multi-track broadcast scheduler');
    } finally {
      setLoading(false);
    }
  }, [stationId, selectedDate, viewMode]);

  useEffect(() => {
    void loadSchedulerState();
  }, [loadSchedulerState]);

  const pushDraftChange = (nextEvents) => {
    setUndoStack(prev => [...prev.slice(-19), draftEvents]);
    setRedoStack([]);
    setDraftEvents(nextEvents);
  };

  const handleUndo = () => {
    if (!undoStack.length) return;
    const previous = undoStack[undoStack.length - 1];
    setRedoStack(prev => [...prev, draftEvents]);
    setUndoStack(prev => prev.slice(0, -1));
    setDraftEvents(previous);
  };

  const handleRedo = () => {
    if (!redoStack.length) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack(prev => [...prev, draftEvents]);
    setRedoStack(prev => prev.slice(0, -1));
    setDraftEvents(next);
  };

  const handleSaveDraft = async () => {
    try {
      setErrorMessage('');
      const res = await api(`/channels/${stationId}/scheduler/draft`, {
        method: 'PUT',
        body: {
          expectedRevisionNumber: schedulerData?.draft?.revisionNumber,
          timezone,
          activationPolicy,
          gapPolicy,
          events: draftEvents
        }
      });
      setStatusMessage(isAr ? `تم حفظ مسودة الجدول (الإصدار v${res.data.revisionNumber})` : `Saved draft revision v${res.data.revisionNumber}`);
      await loadSchedulerState();
    } catch (err) {
      setErrorMessage(err.message || 'Failed to save schedule draft');
    }
  };

  const handleValidateDraft = async () => {
    try {
      setErrorMessage('');
      await handleSaveDraft();
      const res = await api(`/channels/${stationId}/scheduler/validate`, {
        method: 'POST',
        body: {}
      });
      setValidationResult(res.data.validation);
      setStatusMessage(
        res.data.validation.valid
          ? (isAr ? 'التحقق من الجدول ناجح وخالٍ من التعارضات الحرجة' : 'Schedule validation passed with zero blocking errors')
          : (isAr ? `فشل التحقق: تم اكتشاف ${res.data.validation.errors.length} خطأ` : `Validation found ${res.data.validation.errors.length} blocking error(s)`)
      );
    } catch (err) {
      setErrorMessage(err.message || 'Failed to validate schedule');
    }
  };

  const handlePublishSchedule = async () => {
    try {
      setErrorMessage('');
      await handleSaveDraft();
      const res = await api(`/channels/${stationId}/scheduler/publish`, {
        method: 'POST',
        body: {
          expectedRevisionNumber: schedulerData?.draft?.revisionNumber,
          activationPolicy
        }
      });
      setValidationResult(res.data.validation);
      setStatusMessage(
        isAr
          ? `تم نشر وتفعيل جدول البث (الإصدار v${res.data.published.revisionNumber}) بنجاح`
          : `Published schedule revision v${res.data.published.revisionNumber} (${activationPolicy})`
      );
      await loadSchedulerState();
    } catch (err) {
      if (err.details) setValidationResult(err.details);
      setErrorMessage(err.message || 'Failed to publish schedule');
    }
  };

  const handleControlAction = async (action, extra = {}) => {
    try {
      setErrorMessage('');
      await api(`/channels/${stationId}/scheduler/control`, {
        method: 'POST',
        body: { action, ...extra }
      });
      setStatusMessage(isAr ? `تم تنفيذ أمر الجدولة (${action})` : `Executed scheduler control (${action})`);
      await loadSchedulerState();
    } catch (err) {
      setErrorMessage(err.message || `Scheduler action ${action} failed`);
    }
  };

  const handleAddEvent = (e) => {
    e.preventDefault();
    const id = `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const newEv = {
      id,
      trackType: newEventForm.trackType,
      executionMode: newEventForm.executionMode,
      title: newEventForm.title,
      localStartDateTime: newEventForm.localStartDateTime,
      durationMs: Math.max(1000, Number(newEventForm.durationSeconds || 60) * 1000),
      priority: Number(newEventForm.priority || 50),
      mediaAssetId: newEventForm.mediaAssetId || null,
      videoSourceId: newEventForm.videoSourceId || null,
      audioSourceId: newEventForm.audioSourceId || null,
      recurrence: {
        frequency: newEventForm.recurrenceFrequency,
        weekdays: newEventForm.weekdays,
        exceptionDates: []
      },
      enabled: true,
      metadata: {}
    };
    pushDraftChange([...draftEvents, newEv]);
    setShowAddModal(false);
    setSelectedEventId(id);
  };

  const handleDuplicateEvent = (ev) => {
    const copyId = `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const duplicated = {
      ...ev,
      id: copyId,
      title: `${ev.title} (Copy)`
    };
    pushDraftChange([...draftEvents, duplicated]);
    setSelectedEventId(copyId);
  };

  const handleDeleteEvent = (eventId) => {
    pushDraftChange(draftEvents.filter(e => e.id !== eventId));
    if (selectedEventId === eventId) setSelectedEventId(null);
  };

  const handleNudgeEventMinutes = (eventId, deltaMinutes) => {
    pushDraftChange(
      draftEvents.map(ev => {
        if (ev.id !== eventId) return ev;
        const baseMs = ev.startUtc ? Date.parse(ev.startUtc) : Date.parse(`${ev.localStartDateTime || `${selectedDate}T12:00:00`}Z`);
        if (!Number.isFinite(baseMs)) return ev;
        const shiftedIso = new Date(baseMs + deltaMinutes * 60000).toISOString();
        return {
          ...ev,
          startUtc: shiftedIso,
          localStartDateTime: shiftedIso.slice(0, 19)
        };
      })
    );
  };

  const handleRestoreRevision = async (revId) => {
    try {
      setErrorMessage('');
      await api(`/channels/${stationId}/scheduler/restore`, {
        method: 'POST',
        body: { sourceRevisionId: revId, publishImmediately: false }
      });
      setStatusMessage(isAr ? 'تم استعادة الإصدار إلى المسودة الحالية' : 'Restored revision into current draft');
      await loadSchedulerState();
    } catch (err) {
      setErrorMessage(err.message || 'Failed to restore revision');
    }
  };

  if (!schedulerData) return null;
  const execState = schedulerData.executionState || {};
  const publishedRev = schedulerData.published;
  const draftRev = schedulerData.draft;
  const selectedEvent = draftEvents.find(e => e.id === selectedEventId) || null;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/90 p-4 space-y-4">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2.5">
          <Calendar className="w-5 h-5 text-cyan-400" />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-mono font-bold uppercase text-white">
                {isAr ? 'جدولة البث الاحترافية والخط الزمني متعدد المسارات (7 مسارات)' : 'Professional Multi-Track Broadcast Scheduler & Timeline (7 Tracks)'}
              </h2>
              <span className="rounded bg-zinc-800 border border-zinc-700 px-2 py-0.5 text-[10px] font-mono text-cyan-300">
                Draft v{draftRev?.revisionNumber ?? 1} ({draftRev?.lifecycleState || 'DRAFT'})
              </span>
              {publishedRev && (
                <span className="rounded bg-emerald-950 border border-emerald-700/50 px-2 py-0.5 text-[10px] font-mono text-emerald-300">
                  Published v{publishedRev.revisionNumber}
                </span>
              )}
            </div>
            <p className="text-[11px] font-mono text-zinc-400">
              {isAr
                ? `المنطقة الزمنية للقناة: ${timezone} | سياسة التفعيل: ${activationPolicy} | سياسة الفراغات: ${gapPolicy}`
                : `Channel Timezone: ${timezone} | Activation: ${activationPolicy} | Gap Policy: ${gapPolicy}`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs font-mono text-white"
          />

          {['DAY', 'WEEK', 'AS_RUN', 'REVISIONS'].map((mode) => (
            <Button
              key={mode}
              variant={viewMode === mode ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setViewMode(mode)}
            >
              {mode}
            </Button>
          ))}

          <Button variant="outline" size="sm" onClick={handleUndo} disabled={!undoStack.length} title="Undo">
            <Undo2 className="w-3.5 h-3.5" />
          </Button>
          <Button variant="outline" size="sm" onClick={handleRedo} disabled={!redoStack.length} title="Redo">
            <Redo2 className="w-3.5 h-3.5" />
          </Button>

          {canManageSchedule && (
            <>
              <Button variant="outline" size="sm" onClick={() => setShowAddModal(true)}>
                <Plus className="w-3.5 h-3.5 me-1" />
                {isAr ? 'إضافة حدث' : 'Add Event'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void handleSaveDraft()}>
                <Save className="w-3.5 h-3.5 me-1" />
                {isAr ? 'حفظ المسودة' : 'Save Draft'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void handleValidateDraft()}>
                <CheckCircle2 className="w-3.5 h-3.5 me-1 text-cyan-400" />
                {isAr ? 'فحص التعارضات' : 'Validate'}
              </Button>
            </>
          )}

          {canPublishSchedule && (
            <Button variant="primary" size="sm" onClick={() => void handlePublishSchedule()}>
              {isAr ? 'نشر الجدول' : 'Publish Schedule'}
            </Button>
          )}

          <Button variant="outline" size="sm" onClick={() => void loadSchedulerState()} disabled={loading}>
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

      {/* Validation & Gap Alerts */}
      {validationResult && (
        <div className="rounded border border-zinc-800 bg-zinc-950 p-3 space-y-2 text-xs font-mono">
          <div className="flex items-center justify-between">
            <span className={validationResult.valid ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
              {validationResult.valid
                ? (isAr ? '✔ الجدول صالح للنشر' : '✔ Schedule Validated Ready for Publication')
                : (isAr ? '✖ توجد أخطاء تمنع نشر الجدول' : '✖ Blocking Schedule Validation Errors')}
            </span>
            <span className="text-zinc-400">
              Errors: {validationResult.errors?.length || 0} | Warnings: {validationResult.warnings?.length || 0} | Gaps:{' '}
              {validationResult.gaps?.length || 0}
            </span>
          </div>
          {validationResult.errors?.map((err, idx) => (
            <div key={idx} className="text-red-300 text-[11px]">
              • [{err.code}] {err.message}
            </div>
          ))}
          {validationResult.warnings?.map((warn, idx) => (
            <div key={idx} className="text-amber-300 text-[11px]">
              • [{warn.code}] {warn.message}
            </div>
          ))}
          {validationResult.gaps?.map((gap, idx) => (
            <div key={idx} className="text-cyan-300 text-[11px]">
              • [GAP] Unscheduled gap ({Math.round(gap.durationMs / 60000)} min) from {gap.startUtc} to {gap.endUtc} (handled by {gapPolicy})
            </div>
          ))}
        </div>
      )}

      {/* Live Execution & Override Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono">
        <div className="flex flex-wrap items-center gap-3">
          <span>
            {isAr ? 'المجدول:' : 'Scheduler:'}{' '}
            <strong className={execState.schedulerRunning ? 'text-emerald-400' : 'text-zinc-400'}>
              {execState.schedulerRunning ? 'RUNNING' : 'IDLE'}
            </strong>
          </span>
          {execState.holdActive && <span className="rounded bg-amber-950 px-2 py-0.5 text-amber-300">HOLD ACTIVE</span>}
          {execState.emergencyOverrideActive && <span className="rounded bg-red-950 px-2 py-0.5 text-red-300">EMERGENCY OVERRIDE</span>}
          <span className="text-zinc-400">
            {isAr ? 'الفيديو النشط:' : 'Active Video:'}{' '}
            <strong className="text-white">
              {execState.currentTrackStates?.MAIN_VIDEO?.title ||
                execState.currentTrackStates?.LIVE_CAMERA_ROTATION?.title ||
                (execState.gapFallbackActive ? `Gap Fallback (${gapPolicy})` : 'None')}
            </strong>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {canControlStation && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleControlAction(execState.schedulerRunning ? 'STOP_SCHEDULER' : 'START_SCHEDULER')}
              >
                {execState.schedulerRunning ? <Pause className="w-3 h-3 me-1" /> : <Play className="w-3 h-3 me-1" />}
                {execState.schedulerRunning ? (isAr ? 'إيقاف المجدول' : 'Pause Sched') : (isAr ? 'تشغيل المجدول' : 'Start Sched')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleControlAction('TAKE_NEXT', { trackType: 'MAIN_VIDEO' })}
              >
                <SkipForward className="w-3 h-3 me-1" />
                {isAr ? 'تشغيل التالي' : 'Take Next'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleControlAction(execState.holdActive ? 'RELEASE_HOLD' : 'HOLD_CURRENT')}
              >
                {execState.holdActive ? (isAr ? 'إلغاء التثبيت' : 'Release Hold') : (isAr ? 'تثبيت الحالي' : 'Hold Current')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleControlAction('RETURN_TO_SCHEDULE')}
              >
                <RotateCcw className="w-3 h-3 me-1" />
                {isAr ? 'العودة للجدول' : 'Return to Schedule'}
              </Button>
            </>
          )}
          {canEmergency && (
            <Button
              variant={execState.emergencyOverrideActive ? 'danger' : 'outline'}
              size="sm"
              onClick={() =>
                void handleControlAction(execState.emergencyOverrideActive ? 'CLEAR_EMERGENCY' : 'EMERGENCY_OVERRIDE')
              }
            >
              <ShieldAlert className="w-3 h-3 me-1" />
              {execState.emergencyOverrideActive ? (isAr ? 'إنهاء الطوارئ' : 'Clear Emergency') : (isAr ? 'طوارئ' : 'Emergency')}
            </Button>
          )}
        </div>
      </div>

      {/* Policy & Timezone Configuration Row */}
      {canManageSchedule && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs font-mono">
          <div>
            <label className="block text-[10px] text-zinc-400 mb-1">{isAr ? 'المنطقة الزمنية (IANA)' : 'Channel Timezone (IANA)'}</label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-white"
            >
              <option value="UTC">UTC</option>
              <option value="Asia/Hebron">Asia/Hebron</option>
              <option value="Asia/Jerusalem">Asia/Jerusalem</option>
              <option value="Asia/Riyadh">Asia/Riyadh</option>
              <option value="Africa/Cairo">Africa/Cairo</option>
              <option value="Europe/London">Europe/London</option>
              <option value="America/New_York">America/New_York</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-zinc-400 mb-1">{isAr ? 'سياسة تفعيل الجدول المنشور' : 'Live Publication Policy'}</label>
            <select
              value={activationPolicy}
              onChange={(e) => setActivationPolicy(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-white"
            >
              {ACTIVATION_POLICIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-zinc-400 mb-1">{isAr ? 'سياسة ملء الفراغات' : 'Unscheduled Gap Policy'}</label>
            <select
              value={gapPolicy}
              onChange={(e) => setGapPolicy(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-white"
            >
              {GAP_POLICIES.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setZoomHours(Math.max(4, zoomHours / 2))}>
              <ZoomIn className="w-3.5 h-3.5 me-1" />
              Zoom In ({zoomHours}h)
            </Button>
            <Button variant="outline" size="sm" onClick={() => setZoomHours(Math.min(72, zoomHours * 2))}>
              <ZoomOut className="w-3.5 h-3.5 me-1" />
              Zoom Out
            </Button>
          </div>
        </div>
      )}

      {/* Main View Body: 7-Track Timeline OR As-Run History OR Revision History */}
      {(viewMode === 'DAY' || viewMode === 'WEEK') && (
        <div className="space-y-2">
          {TRACK_DEFINITIONS.map((track) => {
            const trackEvents = draftEvents.filter(e => e.trackType === track.id);
            const activeOnTrack = execState.currentTrackStates?.[track.id];

            return (
              <div key={track.id} className="rounded border border-zinc-800 bg-zinc-950 p-2.5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Layers className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="text-xs font-mono font-bold text-white">
                      {isAr ? track.ar : track.en}
                    </span>
                    <span className="text-[10px] font-mono text-zinc-500">({trackEvents.length})</span>
                  </div>
                  {activeOnTrack && (
                    <span className="rounded bg-emerald-950 border border-emerald-600/40 px-2 py-0.5 text-[10px] font-mono text-emerald-300">
                      ON AIR: {activeOnTrack.title}
                    </span>
                  )}
                </div>

                <div className="flex gap-2 overflow-x-auto pb-1">
                  {trackEvents.length === 0 ? (
                    <span className="text-[11px] font-mono text-zinc-600 py-2">
                      {isAr ? 'لا توجد أحداث مجدولة على هذا المسار' : 'No events scheduled on this track'}
                    </span>
                  ) : (
                    trackEvents.map((ev) => (
                      <div
                        key={ev.id}
                        onClick={() => setSelectedEventId(ev.id)}
                        className={`min-w-[230px] max-w-[300px] shrink-0 cursor-pointer rounded border p-2 font-mono text-xs transition-all ${
                          track.color
                        } ${selectedEventId === ev.id ? 'ring-2 ring-white' : ''}`}
                      >
                        <div className="flex items-center justify-between text-[10px] opacity-80 mb-1">
                          <span>{ev.executionMode}</span>
                          <span>{ev.recurrence?.frequency || 'ONCE'}</span>
                        </div>
                        <div className="font-bold truncate text-white" title={ev.title}>
                          {ev.title}
                        </div>
                        <div className="text-[10px] opacity-90 mt-1">
                          {ev.localStartDateTime || ev.startUtc || 'Chained'} · {Math.round((ev.durationMs || 0) / 60000)}m
                        </div>
                        {canManageSchedule && (
                          <div className="flex items-center justify-between gap-1 mt-2 pt-1 border-t border-white/10">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleNudgeEventMinutes(ev.id, -15); }}
                              className="px-1.5 py-0.5 rounded bg-black/40 hover:bg-black/70 text-[10px]"
                              title="Move -15 min (Keyboard accessible)"
                            >
                              -15m
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleNudgeEventMinutes(ev.id, 15); }}
                              className="px-1.5 py-0.5 rounded bg-black/40 hover:bg-black/70 text-[10px]"
                              title="Move +15 min (Keyboard accessible)"
                            >
                              +15m
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleDuplicateEvent(ev); }}
                              className="px-1.5 py-0.5 rounded bg-black/40 hover:bg-black/70 text-[10px]"
                              title="Duplicate Event"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleDeleteEvent(ev.id); }}
                              className="px-1.5 py-0.5 rounded bg-red-950/60 hover:bg-red-900 text-red-200 text-[10px]"
                              title="Delete Event"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {viewMode === 'AS_RUN' && (
        <div className="rounded border border-zinc-800 bg-zinc-950 p-3 space-y-2 text-xs font-mono">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
            <span className="font-bold text-white">
              {isAr ? 'سجل التنفيذ الفعلي للبث (As-Run Broadcast Log)' : 'Actual Broadcast As-Run Log'} (
              {schedulerData.asRun?.length || 0})
            </span>
            <a
              href={`/api/v1/channels/${stationId}/scheduler/as-run?format=csv`}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] text-cyan-300 hover:border-cyan-500"
            >
              {isAr ? 'تصدير CSV' : 'Export CSV'}
            </a>
          </div>
          <div className="max-h-72 overflow-y-auto space-y-1">
            {(schedulerData.asRun || []).map((rec) => (
              <div key={rec.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-zinc-900 px-2.5 py-1.5 border border-zinc-800">
                <div>
                  <span className="text-cyan-300 font-bold">[{rec.trackType}]</span>{' '}
                  <strong className="text-white">{rec.title}</strong>{' '}
                  <span className="text-zinc-400">({rec.executionMode})</span>
                </div>
                <div className="text-[11px] text-zinc-400">
                  {rec.actualStartUtc} · <strong className="text-emerald-300">{rec.status}</strong>
                  {rec.resumeOffsetMs > 0 ? ` (Resume +${Math.round(rec.resumeOffsetMs / 1000)}s)` : ''}
                  {rec.interruptionReason ? ` · ${rec.interruptionReason}` : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {viewMode === 'REVISIONS' && (
        <div className="rounded border border-zinc-800 bg-zinc-950 p-3 space-y-2 text-xs font-mono">
          <div className="font-bold text-white border-b border-zinc-800 pb-2">
            {isAr ? 'سجل إصدارات الجدول والنسخ المنشورة' : 'Schedule Revision History'}
          </div>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {(schedulerData.revisions || []).map((rev) => (
              <div key={rev.id} className="flex items-center justify-between rounded bg-zinc-900 px-3 py-2 border border-zinc-800">
                <div>
                  <strong className="text-white">v{rev.revisionNumber} — {rev.name}</strong>{' '}
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-cyan-300">{rev.lifecycleState}</span>
                  <div className="text-[10px] text-zinc-400">
                    Events: {rev.events?.length || 0} | Timezone: {rev.timezone} | Updated: {rev.updatedAt}
                  </div>
                </div>
                {canPublishSchedule && (
                  <Button variant="outline" size="sm" onClick={() => void handleRestoreRevision(rev.id)}>
                    {isAr ? 'استعادة للمسودة' : 'Restore to Draft'}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Selected Event Inspector */}
      {selectedEvent && canManageSchedule && (
        <div className="rounded border border-cyan-500/40 bg-zinc-950 p-3 space-y-2 text-xs font-mono">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5">
            <strong className="text-cyan-300">
              {isAr ? 'خصائص الحدث المحدد:' : 'Selected Event Properties:'} {selectedEvent.title}
            </strong>
            <button type="button" onClick={() => setSelectedEventId(null)} className="text-zinc-400 hover:text-white">
              ✕
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <div>
              <label className="block text-[10px] text-zinc-400">Title</label>
              <input
                type="text"
                value={selectedEvent.title}
                onChange={(e) =>
                  pushDraftChange(draftEvents.map(ev => (ev.id === selectedEvent.id ? { ...ev, title: e.target.value } : ev)))
                }
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-white"
              />
            </div>
            <div>
              <label className="block text-[10px] text-zinc-400">Execution Mode</label>
              <select
                value={selectedEvent.executionMode}
                onChange={(e) =>
                  pushDraftChange(draftEvents.map(ev => (ev.id === selectedEvent.id ? { ...ev, executionMode: e.target.value } : ev)))
                }
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-white"
              >
                {EXECUTION_MODES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-zinc-400">Local Start Date/Time</label>
              <input
                type="text"
                value={selectedEvent.localStartDateTime || ''}
                onChange={(e) =>
                  pushDraftChange(
                    draftEvents.map(ev =>
                      ev.id === selectedEvent.id ? { ...ev, localStartDateTime: e.target.value, startUtc: null } : ev
                    )
                  )
                }
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-white"
              />
            </div>
            <div>
              <label className="block text-[10px] text-zinc-400">Duration (seconds)</label>
              <input
                type="number"
                min="1"
                value={Math.round((selectedEvent.durationMs || 60000) / 1000)}
                onChange={(e) =>
                  pushDraftChange(
                    draftEvents.map(ev =>
                      ev.id === selectedEvent.id ? { ...ev, durationMs: Math.max(1000, Number(e.target.value) * 1000) } : ev
                    )
                  )
                }
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-white"
              />
            </div>
          </div>
        </div>
      )}

      {/* Add Schedule Event Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <form
            onSubmit={handleAddEvent}
            className="w-full max-w-lg rounded-lg border border-zinc-700 bg-zinc-900 p-5 space-y-3 text-xs font-mono text-white"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <h3 className="font-bold text-sm uppercase">
                {isAr ? 'إضافة حدث بث مجدول جديد' : 'Add Scheduled Broadcast Event'}
              </h3>
              <button type="button" onClick={() => setShowAddModal(false)} className="text-zinc-400 hover:text-white">
                ✕
              </button>
            </div>

            <div>
              <label className="block text-[10px] text-zinc-400 mb-1">{isAr ? 'عنوان البرنامج / الحدث' : 'Event Title'}</label>
              <input
                type="text"
                required
                value={newEventForm.title}
                onChange={(e) => setNewEventForm({ ...newEventForm, title: e.target.value })}
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-zinc-400 mb-1">{isAr ? 'المسار (Track)' : 'Timeline Track'}</label>
                <select
                  value={newEventForm.trackType}
                  onChange={(e) => setNewEventForm({ ...newEventForm, trackType: e.target.value })}
                  className="w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5"
                >
                  {TRACK_DEFINITIONS.map((tr) => (
                    <option key={tr.id} value={tr.id}>{isAr ? tr.ar : tr.en}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-zinc-400 mb-1">{isAr ? 'وضع التنفيذ' : 'Execution Mode'}</label>
                <select
                  value={newEventForm.executionMode}
                  onChange={(e) => setNewEventForm({ ...newEventForm, executionMode: e.target.value })}
                  className="w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5"
                >
                  {EXECUTION_MODES.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] text-zinc-400 mb-1">Local Start (YYYY-MM-DDTHH:mm:ss)</label>
                <input
                  type="text"
                  required
                  value={newEventForm.localStartDateTime}
                  onChange={(e) => setNewEventForm({ ...newEventForm, localStartDateTime: e.target.value })}
                  className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5"
                />
              </div>
              <div>
                <label className="block text-[10px] text-zinc-400 mb-1">{isAr ? 'المدة (ثانية)' : 'Duration (sec)'}</label>
                <input
                  type="number"
                  min="1"
                  required
                  value={newEventForm.durationSeconds}
                  onChange={(e) => setNewEventForm({ ...newEventForm, durationSeconds: Number(e.target.value) })}
                  className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5"
                />
              </div>
              <div>
                <label className="block text-[10px] text-zinc-400 mb-1">{isAr ? 'التكرار' : 'Recurrence'}</label>
                <select
                  value={newEventForm.recurrenceFrequency}
                  onChange={(e) => setNewEventForm({ ...newEventForm, recurrenceFrequency: e.target.value })}
                  className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5"
                >
                  {RECURRENCE_FREQUENCIES.map((rf) => (
                    <option key={rf} value={rf}>{rf}</option>
                  ))}
                </select>
              </div>
            </div>

            {['MAIN_VIDEO', 'ADVERTISEMENTS'].includes(newEventForm.trackType) && (
              <div>
                <label className="block text-[10px] text-zinc-400 mb-1">{isAr ? 'ملف الوسائط من المكتبة' : 'Media Library Asset'}</label>
                <select
                  value={newEventForm.mediaAssetId}
                  onChange={(e) => setNewEventForm({ ...newEventForm, mediaAssetId: e.target.value })}
                  className="w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5"
                >
                  <option value="">-- Optional Media Asset --</option>
                  {mediaAssets.map((m) => (
                    <option key={m.id} value={m.id}>{m.title} ({m.category})</option>
                  ))}
                </select>
              </div>
            )}

            {newEventForm.trackType === 'LIVE_CAMERA_ROTATION' && (
              <div>
                <label className="block text-[10px] text-zinc-400 mb-1">{isAr ? 'مصدر الفيديو / الكاميرا' : 'Video Source'}</label>
                <select
                  value={newEventForm.videoSourceId}
                  onChange={(e) => setNewEventForm({ ...newEventForm, videoSourceId: e.target.value })}
                  className="w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5"
                >
                  <option value="">-- Optional Video Source --</option>
                  {videoSources.map((vs) => (
                    <option key={vs.id} value={vs.id}>{vs.name} ({vs.sourceType})</option>
                  ))}
                </select>
              </div>
            )}

            {newEventForm.trackType === 'INDEPENDENT_AUDIO' && (
              <div>
                <label className="block text-[10px] text-zinc-400 mb-1">{isAr ? 'مصدر الصوت المستقل' : 'Independent Audio Source'}</label>
                <select
                  value={newEventForm.audioSourceId}
                  onChange={(e) => setNewEventForm({ ...newEventForm, audioSourceId: e.target.value })}
                  className="w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5"
                >
                  <option value="">-- Optional Audio Source --</option>
                  {audioSources.map((as) => (
                    <option key={as.id} value={as.id}>{as.name} ({as.sourceType})</option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowAddModal(false)}>
                {isAr ? 'إلغاء' : 'Cancel'}
              </Button>
              <Button type="submit" variant="primary" size="sm">
                {isAr ? 'إضافة للخط الزمني' : 'Add to Timeline'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
