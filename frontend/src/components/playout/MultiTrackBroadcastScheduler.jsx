import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@mcr/ui';
import {
  Calendar,
  CheckCircle2,
  ClipboardPaste,
  Copy,
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
const SNAP_MINUTES_OPTIONS = [1, 5, 15, 30, 60];

function parseEventStartMs(ev, fallbackDate) {
  if (ev.startUtc) {
    const ms = Date.parse(ev.startUtc);
    if (Number.isFinite(ms)) return ms;
  }
  if (ev.localStartDateTime) {
    const ms = Date.parse(`${ev.localStartDateTime}Z`);
    if (Number.isFinite(ms)) return ms;
  }
  return Date.parse(`${fallbackDate}T12:00:00Z`);
}

function snapToGridMs(rawMs, snapMinutes = 15) {
  const stepMs = Math.max(1, Number(snapMinutes || 15)) * 60000;
  return Math.round(rawMs / stepMs) * stepMs;
}

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
  const [snapMinutes, setSnapMinutes] = useState(15);
  const [draftEvents, setDraftEvents] = useState([]);
  const [timezone, setTimezone] = useState('UTC');
  const [activationPolicy, setActivationPolicy] = useState('APPLY_NEXT_BOUNDARY');
  const [gapPolicy, setGapPolicy] = useState('FALLBACK_PLAYLIST');
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [validationResult, setValidationResult] = useState(null);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [selectedEventIds, setSelectedEventIds] = useState([]);
  const [clipboardEvents, setClipboardEvents] = useState([]);
  const [draggedPayload, setDraggedPayload] = useState(null);
  const [manualOverrideSourceId, setManualOverrideSourceId] = useState('');
  const [playheadClock, setPlayheadClock] = useState(() => new Date());
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newExceptionDate, setNewExceptionDate] = useState('');

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

  useEffect(() => {
    const timer = setInterval(() => setPlayheadClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

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
    setSelectedEventIds([id]);
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
    setSelectedEventIds([copyId]);
  };

  const handleCopySelected = () => {
    const ids = selectedEventIds.length ? selectedEventIds : (selectedEventId ? [selectedEventId] : []);
    const toCopy = draftEvents.filter(e => ids.includes(e.id));
    if (!toCopy.length) return;
    setClipboardEvents(toCopy);
    setStatusMessage(isAr ? `تم نسخ ${toCopy.length} عنصر إلى الحافظة` : `Copied ${toCopy.length} event(s) to clipboard`);
  };

  const handlePasteClipboard = (targetTrackId = null) => {
    if (!clipboardEvents.length) return;
    const pasted = clipboardEvents.map((ev, idx) => {
      const baseMs = parseEventStartMs(ev, selectedDate);
      const snappedMs = snapToGridMs(baseMs + (idx + 1) * snapMinutes * 60000, snapMinutes);
      const iso = new Date(snappedMs).toISOString();
      return {
        ...ev,
        id: `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-${idx}`,
        trackType: targetTrackId || ev.trackType,
        title: `${ev.title} (Pasted)`,
        startUtc: iso,
        localStartDateTime: iso.slice(0, 19)
      };
    });
    pushDraftChange([...draftEvents, ...pasted]);
    setSelectedEventId(pasted[0].id);
    setSelectedEventIds(pasted.map(p => p.id));
    setStatusMessage(isAr ? `تم لصق ${pasted.length} عنصر` : `Pasted ${pasted.length} event(s)`);
  };

  const handleDeleteEvent = (eventId) => {
    pushDraftChange(draftEvents.filter(e => e.id !== eventId));
    if (selectedEventId === eventId) setSelectedEventId(null);
    setSelectedEventIds(prev => prev.filter(id => id !== eventId));
  };

  const handleDeleteSelected = () => {
    const ids = new Set(selectedEventIds.length ? selectedEventIds : (selectedEventId ? [selectedEventId] : []));
    if (!ids.size) return;
    pushDraftChange(draftEvents.filter(e => !ids.has(e.id)));
    setSelectedEventId(null);
    setSelectedEventIds([]);
  };

  const handleNudgeEventMinutes = (eventId, deltaMinutes) => {
    const stepMinutes = deltaMinutes === 0 ? snapMinutes : deltaMinutes;
    pushDraftChange(
      draftEvents.map(ev => {
        if (ev.id !== eventId) return ev;
        const baseMs = parseEventStartMs(ev, selectedDate);
        const shiftedMs = snapToGridMs(baseMs + stepMinutes * 60000, snapMinutes);
        const shiftedIso = new Date(shiftedMs).toISOString();
        return {
          ...ev,
          startUtc: shiftedIso,
          localStartDateTime: shiftedIso.slice(0, 19)
        };
      })
    );
  };

  const handleResizeEventMinutes = (eventId, deltaMinutes) => {
    pushDraftChange(
      draftEvents.map(ev => {
        if (ev.id !== eventId) return ev;
        const nextDurMs = Math.max(60000, (Number(ev.durationMs) || 600000) + deltaMinutes * 60000);
        return {
          ...ev,
          durationMs: nextDurMs
        };
      })
    );
  };

  const handleDropOnTrack = (targetTrackId, dropHourOffset = null) => {
    if (!draggedPayload || !canManageSchedule) return;
    if (draggedPayload.kind === 'EXISTING_EVENT') {
      pushDraftChange(
        draftEvents.map(ev => {
          if (ev.id !== draggedPayload.eventId) return ev;
          let nextStartUtc = ev.startUtc;
          let nextLocal = ev.localStartDateTime;
          if (dropHourOffset !== null) {
            const dayStartMs = Date.parse(`${selectedDate}T00:00:00.000Z`);
            const snapped = snapToGridMs(dayStartMs + dropHourOffset * 3600000, snapMinutes);
            nextStartUtc = new Date(snapped).toISOString();
            nextLocal = nextStartUtc.slice(0, 19);
          }
          return {
            ...ev,
            trackType: targetTrackId,
            startUtc: nextStartUtc,
            localStartDateTime: nextLocal
          };
        })
      );
    } else if (draggedPayload.kind === 'PALETTE_ITEM') {
      const id = `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const dayStartMs = Date.parse(`${selectedDate}T00:00:00.000Z`);
      const snapped = snapToGridMs(dayStartMs + (dropHourOffset ?? 12) * 3600000, snapMinutes);
      const iso = new Date(snapped).toISOString();
      const created = {
        id,
        trackType: targetTrackId,
        executionMode: targetTrackId === 'ADVERTISEMENTS' ? 'FIXED_DURATION' : 'HARD_START',
        title: draggedPayload.title,
        startUtc: iso,
        localStartDateTime: iso.slice(0, 19),
        durationMs: draggedPayload.durationMs || 1800000,
        priority: targetTrackId === 'ADVERTISEMENTS' ? 90 : 60,
        mediaAssetId: draggedPayload.mediaAssetId || null,
        videoSourceId: draggedPayload.videoSourceId || null,
        audioSourceId: draggedPayload.audioSourceId || null,
        recurrence: { frequency: 'ONCE', weekdays: [0, 1, 2, 3, 4, 5, 6], exceptionDates: [] },
        enabled: true,
        metadata: {}
      };
      pushDraftChange([...draftEvents, created]);
      setSelectedEventId(id);
      setSelectedEventIds([id]);
    }
    setDraggedPayload(null);
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
  const advertisementAssets = mediaAssets.filter(a => a.category === 'ADVERTISEMENTS' || a.category === 'PROMOS');

  // Compute live playhead percentage across the 24h day ruler
  const playheadMinutes = playheadClock.getUTCHours() * 60 + playheadClock.getUTCMinutes();
  const playheadPercent = Math.min(100, Math.max(0, (playheadMinutes / (24 * 60)) * 100));
  const rulerHours = Array.from({ length: Math.min(24, Math.max(4, zoomHours)) }, (_, i) => i);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.parse(`${selectedDate}T00:00:00Z`) + i * 86400000);
    return d.toISOString().slice(0, 10);
  });

  return (
    <div
      dir={isAr ? 'rtl' : 'ltr'}
      data-testid="multitrack-broadcast-scheduler"
      className="rounded-lg border border-zinc-800 bg-zinc-900/90 p-4 space-y-4"
    >
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2.5">
          <Calendar className="w-5 h-5 text-cyan-400" />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-mono font-bold uppercase text-white">
                {isAr ? 'جدولة البث الاحترافية والخط الزمني متعدد المسارات (7 مسارات)' : 'Professional Multi-Track Broadcast Scheduler & Timeline (7 Tracks)'}
              </h2>
              <span data-testid="draft-revision-badge" className="rounded bg-zinc-800 border border-zinc-700 px-2 py-0.5 text-[10px] font-mono text-cyan-300">
                Draft v{draftRev?.revisionNumber ?? 1} ({draftRev?.lifecycleState || 'DRAFT'})
              </span>
              {publishedRev && (
                <span data-testid="published-revision-badge" className="rounded bg-emerald-950 border border-emerald-700/50 px-2 py-0.5 text-[10px] font-mono text-emerald-300">
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
            aria-label={isAr ? 'تاريخ الجدول' : 'Schedule Date'}
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
              <Button variant="outline" size="sm" onClick={handleCopySelected} disabled={!selectedEventId && !selectedEventIds.length} title="Copy Selected">
                <Copy className="w-3.5 h-3.5 me-1" />
                {isAr ? 'نسخ' : 'Copy'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => handlePasteClipboard()} disabled={!clipboardEvents.length} title="Paste">
                <ClipboardPaste className="w-3.5 h-3.5 me-1" />
                {isAr ? 'لصق' : 'Paste'} ({clipboardEvents.length})
              </Button>
              {selectedEventIds.length > 1 && (
                <Button variant="outline" size="sm" onClick={handleDeleteSelected}>
                  <Trash2 className="w-3.5 h-3.5 me-1 text-red-400" />
                  {isAr ? `حذف المحدد (${selectedEventIds.length})` : `Delete Selected (${selectedEventIds.length})`}
                </Button>
              )}
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
        <div role="alert" className="rounded border border-red-500/40 bg-red-950/30 px-3 py-2 text-xs font-mono text-red-300">
          {errorMessage}
        </div>
      )}
      {statusMessage && (
        <div role="status" className="rounded border border-cyan-500/40 bg-cyan-950/30 px-3 py-2 text-xs font-mono text-cyan-200">
          {statusMessage}
        </div>
      )}

      {/* Validation & Gap Alerts */}
      {validationResult && (
        <div data-testid="validation-result-banner" className="rounded border border-zinc-800 bg-zinc-950 p-3 space-y-2 text-xs font-mono">
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

      {/* Live Execution & Manual / Emergency Override Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono">
        <div className="flex flex-wrap items-center gap-3">
          <span>
            {isAr ? 'المجدول:' : 'Scheduler:'}{' '}
            <strong className={execState.schedulerRunning ? 'text-emerald-400' : 'text-zinc-400'}>
              {execState.schedulerRunning ? 'RUNNING' : 'IDLE'}
            </strong>
          </span>
          {execState.holdActive && <span className="rounded bg-amber-950 px-2 py-0.5 text-amber-300">HOLD ACTIVE</span>}
          {execState.manualOverrideActive && (
            <span className="rounded bg-cyan-950 px-2 py-0.5 text-cyan-300">
              MANUAL OVERRIDE ({execState.overrideSourceId})
            </span>
          )}
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
              <select
                aria-label={isAr ? 'مصدر التجاوز اليدوي' : 'Manual Override Source'}
                value={manualOverrideSourceId}
                onChange={(e) => setManualOverrideSourceId(e.target.value)}
                className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-white"
              >
                <option value="">{isAr ? '-- اختر مصدر تجاوز يدوي --' : '-- Manual Override Source --'}</option>
                {videoSources.map((vs) => (
                  <option key={vs.id} value={vs.id}>[Camera/Source] {vs.name}</option>
                ))}
                {mediaAssets.map((ma) => (
                  <option key={ma.id} value={ma.id}>[Media] {ma.title}</option>
                ))}
              </select>
              <Button
                variant="outline"
                size="sm"
                disabled={!manualOverrideSourceId}
                onClick={() => void handleControlAction('MANUAL_SOURCE_OVERRIDE', { overrideSourceId: manualOverrideSourceId })}
              >
                {isAr ? 'تبديل يدوي مباشر' : 'Manual Override'}
              </Button>
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

      {/* Policy, Timezone, Snap Grid & Zoom Row */}
      {canManageSchedule && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-xs font-mono">
          <div>
            <label className="block text-[10px] text-zinc-400 mb-1">{isAr ? 'المنطقة الزمنية (IANA)' : 'Channel Timezone (IANA)'}</label>
            <select
              aria-label="Channel Timezone"
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
              aria-label="Live Publication Policy"
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
              aria-label="Unscheduled Gap Policy"
              value={gapPolicy}
              onChange={(e) => setGapPolicy(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-white"
            >
              {GAP_POLICIES.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-zinc-400 mb-1">{isAr ? 'المحاذاة للشبكة الزمنية (Snap Grid)' : 'Time-Grid Snapping'}</label>
            <select
              aria-label="Time-Grid Snapping"
              value={snapMinutes}
              onChange={(e) => setSnapMinutes(Number(e.target.value))}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-white"
            >
              {SNAP_MINUTES_OPTIONS.map((m) => (
                <option key={m} value={m}>{m} min</option>
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

      {/* Drag-and-Drop Source Palette */}
      {canManageSchedule && (viewMode === 'DAY' || viewMode === 'WEEK') && (
        <div className="rounded border border-zinc-800 bg-zinc-950 p-2.5 text-xs font-mono">
          <div className="text-[10px] text-zinc-400 mb-1.5">
            {isAr
              ? 'اسحب وأفلت ملفات الوسائط أو الكاميرات أو الإعلانات مباشرة على أي مسار في الخط الزمني:'
              : 'Drag & Drop Media, Live Cameras, Audio Sources, or Advertisements onto any timeline track:'}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {mediaAssets.slice(0, 8).map((ma) => (
              <div
                key={`pal-m-${ma.id}`}
                draggable
                onDragStart={() =>
                  setDraggedPayload({
                    kind: 'PALETTE_ITEM',
                    title: ma.title,
                    mediaAssetId: ma.id,
                    durationMs: Math.max(60000, Number(ma.durationSeconds || 1800) * 1000)
                  })
                }
                className="shrink-0 cursor-grab rounded border border-cyan-700/50 bg-cyan-950/30 px-2 py-1 text-[11px] text-cyan-200"
              >
                🎬 {ma.title}
              </div>
            ))}
            {videoSources.slice(0, 6).map((vs) => (
              <div
                key={`pal-v-${vs.id}`}
                draggable
                onDragStart={() =>
                  setDraggedPayload({
                    kind: 'PALETTE_ITEM',
                    title: vs.name,
                    videoSourceId: vs.id,
                    durationMs: 1800000
                  })
                }
                className="shrink-0 cursor-grab rounded border border-emerald-700/50 bg-emerald-950/30 px-2 py-1 text-[11px] text-emerald-200"
              >
                📹 {vs.name}
              </div>
            ))}
            {audioSources.slice(0, 6).map((as) => (
              <div
                key={`pal-a-${as.id}`}
                draggable
                onDragStart={() =>
                  setDraggedPayload({
                    kind: 'PALETTE_ITEM',
                    title: as.name,
                    audioSourceId: as.id,
                    durationMs: 3600000
                  })
                }
                className="shrink-0 cursor-grab rounded border border-violet-700/50 bg-violet-950/30 px-2 py-1 text-[11px] text-violet-200"
              >
                🎵 {as.name}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main View Body: 24h Time Ruler + Live Playhead + 7-Track Timeline */}
      {(viewMode === 'DAY' || viewMode === 'WEEK') && (
        <div className="space-y-2 relative">
          {/* 24-Hour Broadcast Time Ruler & Current-Time Live Playhead */}
          <div data-testid="timeline-time-ruler" className="relative rounded border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-[10px] text-zinc-400 overflow-x-auto">
            <div className="flex items-center justify-between mb-1">
              <span className="text-cyan-300 font-bold">
                {isAr ? 'مسطرة الوقت الفعلي للبث ومؤشر التشغيل الحي (Live Playhead):' : 'Broadcast Time Scale & Current-Time Live Playhead:'}{' '}
                {playheadClock.toISOString().slice(11, 19)} UTC
              </span>
              <span>
                {viewMode === 'WEEK' ? `7-Day Week Grid (${weekDays[0]} → ${weekDays[6]})` : `24h Zoom Window (${zoomHours}h) · Snap ${snapMinutes}m`}
              </span>
            </div>
            {viewMode === 'WEEK' ? (
              <div data-testid="week-view-grid" className="grid grid-cols-7 gap-1 pt-1 border-t border-zinc-800">
                {weekDays.map((dayStr) => {
                  const count = (schedulerData.expandedOccurrences || []).filter(o => o.localDate === dayStr || (o.plannedStartUtc || '').startsWith(dayStr)).length;
                  return (
                    <button
                      type="button"
                      key={dayStr}
                      onClick={() => { setSelectedDate(dayStr); setViewMode('DAY'); }}
                      className={`rounded border px-2 py-1 text-left ${
                        dayStr === selectedDate ? 'border-cyan-500 bg-cyan-950/40 text-white' : 'border-zinc-800 bg-zinc-900 text-zinc-300'
                      }`}
                    >
                      <div className="font-bold">{dayStr}</div>
                      <div className="text-[9px] text-cyan-300">{count} occurrences</div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="relative flex justify-between border-t border-zinc-800 pt-1">
                {rulerHours.map((h) => (
                  <span key={h} className="shrink-0">
                    {String(h).padStart(2, '0')}:00
                  </span>
                ))}
                <div
                  data-testid="live-playhead-indicator"
                  style={{ left: `${playheadPercent}%` }}
                  className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-red-500"
                  title={`Current Playhead ${playheadClock.toISOString()}`}
                />
              </div>
            )}
          </div>

          {TRACK_DEFINITIONS.map((track) => {
            const trackEvents = draftEvents.filter(e => e.trackType === track.id);
            const activeOnTrack = execState.currentTrackStates?.[track.id];

            return (
              <div
                key={track.id}
                data-testid={`timeline-track-${track.id}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDropOnTrack(track.id)}
                className="rounded border border-zinc-800 bg-zinc-950 p-2.5"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Layers className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="text-xs font-mono font-bold text-white">
                      {isAr ? track.ar : track.en}
                    </span>
                    <span className="text-[10px] font-mono text-zinc-500">({trackEvents.length})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {canManageSchedule && clipboardEvents.length > 0 && (
                      <button
                        type="button"
                        onClick={() => handlePasteClipboard(track.id)}
                        className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] font-mono text-cyan-300 hover:border-cyan-500"
                      >
                        {isAr ? 'لصق هنا' : 'Paste Here'}
                      </button>
                    )}
                    {activeOnTrack && (
                      <span className="rounded bg-emerald-950 border border-emerald-600/40 px-2 py-0.5 text-[10px] font-mono text-emerald-300">
                        ON AIR: {activeOnTrack.title}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 overflow-x-auto pb-1">
                  {trackEvents.length === 0 ? (
                    <span className="text-[11px] font-mono text-zinc-600 py-2">
                      {isAr ? 'لا توجد أحداث مجدولة على هذا المسار (اسحب عنصرًا هنا)' : 'No events scheduled on this track (drag items here)'}
                    </span>
                  ) : (
                    trackEvents.map((ev) => {
                      const isMultiSelected = selectedEventIds.includes(ev.id);
                      const hasConflict = (validationResult?.errors || []).some(err => (err.eventIds || []).includes(ev.id));
                      return (
                        <div
                          key={ev.id}
                          data-testid={`timeline-event-${ev.id}`}
                          draggable={canManageSchedule}
                          onDragStart={() => setDraggedPayload({ kind: 'EXISTING_EVENT', eventId: ev.id })}
                          onClick={(e) => {
                            setSelectedEventId(ev.id);
                            if (e.shiftKey || e.ctrlKey || e.metaKey) {
                              setSelectedEventIds(prev => (prev.includes(ev.id) ? prev.filter(id => id !== ev.id) : [...prev, ev.id]));
                            } else {
                              setSelectedEventIds([ev.id]);
                            }
                          }}
                          className={`min-w-[250px] max-w-[330px] shrink-0 cursor-pointer rounded border p-2 font-mono text-xs transition-all ${
                            track.color
                          } ${selectedEventId === ev.id || isMultiSelected ? 'ring-2 ring-white' : ''} ${
                            hasConflict ? 'border-red-500 ring-2 ring-red-500/70' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between text-[10px] opacity-80 mb-1">
                            <label className="flex items-center gap-1 cursor-pointer" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                aria-label={`Select ${ev.title}`}
                                checked={isMultiSelected}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedEventIds(prev => [...new Set([...prev, ev.id])]);
                                    setSelectedEventId(ev.id);
                                  } else {
                                    setSelectedEventIds(prev => prev.filter(id => id !== ev.id));
                                  }
                                }}
                              />
                              <span>{ev.executionMode}</span>
                            </label>
                            <span>{ev.recurrence?.frequency || 'ONCE'}</span>
                          </div>
                          <div className="font-bold truncate text-white" title={ev.title}>
                            {hasConflict ? '⚠ ' : ''}{ev.title}
                          </div>
                          <div className="text-[10px] opacity-90 mt-1">
                            {ev.localStartDateTime || ev.startUtc || 'Chained'} · {Math.round((ev.durationMs || 0) / 60000)}m
                          </div>
                          {canManageSchedule && (
                            <div className="flex flex-wrap items-center justify-between gap-1 mt-2 pt-1 border-t border-white/10">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleNudgeEventMinutes(ev.id, -snapMinutes); }}
                                className="px-1.5 py-0.5 rounded bg-black/40 hover:bg-black/70 text-[10px]"
                                title={`Move -${snapMinutes}m (Keyboard accessible)`}
                              >
                                -{snapMinutes}m
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleNudgeEventMinutes(ev.id, snapMinutes); }}
                                className="px-1.5 py-0.5 rounded bg-black/40 hover:bg-black/70 text-[10px]"
                                title={`Move +${snapMinutes}m (Keyboard accessible)`}
                              >
                                +{snapMinutes}m
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleResizeEventMinutes(ev.id, -snapMinutes); }}
                                className="px-1.5 py-0.5 rounded bg-black/40 hover:bg-black/70 text-[10px]"
                                title={`Shrink duration -${snapMinutes}m`}
                              >
                                Dur-
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleResizeEventMinutes(ev.id, snapMinutes); }}
                                className="px-1.5 py-0.5 rounded bg-black/40 hover:bg-black/70 text-[10px]"
                                title={`Extend duration +${snapMinutes}m`}
                              >
                                Dur+
                              </button>
                              {ev.executionMode === 'MANUAL_TRIGGER' && canControlStation && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleControlAction('MANUAL_TRIGGER_EVENT', { eventId: ev.id, trackType: ev.trackType });
                                  }}
                                  className="px-1.5 py-0.5 rounded bg-emerald-900/70 hover:bg-emerald-800 text-emerald-100 text-[10px]"
                                  title="Trigger Manual Event Now"
                                >
                                  Trigger
                                </button>
                              )}
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
                      );
                    })
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

      {/* Selected Event Inspector (Direct Start, End Time, Duration, Track, Sources, and Recurrence Editing) */}
      {selectedEvent && canManageSchedule && (
        <div data-testid="selected-event-inspector" className="rounded border border-cyan-500/40 bg-zinc-950 p-3 space-y-3 text-xs font-mono">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5">
            <strong className="text-cyan-300">
              {isAr ? 'خصائص الحدث المحدد:' : 'Selected Event Properties:'} {selectedEvent.title}
            </strong>
            <button type="button" onClick={() => setSelectedEventId(null)} className="text-zinc-400 hover:text-white">
              ✕
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
            <div>
              <label className="block text-[10px] text-zinc-400">Title</label>
              <input
                aria-label="Selected Event Title"
                type="text"
                value={selectedEvent.title}
                onChange={(e) =>
                  pushDraftChange(draftEvents.map(ev => (ev.id === selectedEvent.id ? { ...ev, title: e.target.value } : ev)))
                }
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-white"
              />
            </div>
            <div>
              <label className="block text-[10px] text-zinc-400">Track (Move Track)</label>
              <select
                aria-label="Selected Event Track"
                value={selectedEvent.trackType}
                onChange={(e) =>
                  pushDraftChange(draftEvents.map(ev => (ev.id === selectedEvent.id ? { ...ev, trackType: e.target.value } : ev)))
                }
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-white"
              >
                {TRACK_DEFINITIONS.map((tr) => (
                  <option key={tr.id} value={tr.id}>{tr.id}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-zinc-400">Execution Mode</label>
              <select
                aria-label="Selected Event Execution Mode"
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
              <label className="block text-[10px] text-zinc-400">Start Date/Time</label>
              <input
                aria-label="Selected Event Start Time"
                type="text"
                value={selectedEvent.localStartDateTime || (selectedEvent.startUtc ? selectedEvent.startUtc.slice(0, 19) : '')}
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
              <label className="block text-[10px] text-zinc-400">End Date/Time (Direct)</label>
              <input
                aria-label="Selected Event End Time"
                type="text"
                value={
                  selectedEvent.endUtc
                    ? selectedEvent.endUtc.slice(0, 19)
                    : new Date(parseEventStartMs(selectedEvent, selectedDate) + Number(selectedEvent.durationMs || 600000))
                        .toISOString()
                        .slice(0, 19)
                }
                onChange={(e) => {
                  const endVal = e.target.value;
                  const startMs = parseEventStartMs(selectedEvent, selectedDate);
                  const endMs = Date.parse(`${endVal}Z`);
                  const computedDur = Number.isFinite(endMs) && endMs > startMs ? endMs - startMs : selectedEvent.durationMs;
                  pushDraftChange(
                    draftEvents.map(ev =>
                      ev.id === selectedEvent.id
                        ? { ...ev, endUtc: `${endVal}Z`, durationMs: Math.max(1000, computedDur) }
                        : ev
                    )
                  );
                }}
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-white"
              />
            </div>
            <div>
              <label className="block text-[10px] text-zinc-400">Duration (seconds)</label>
              <input
                aria-label="Selected Event Duration Seconds"
                type="number"
                min="1"
                value={Math.round((selectedEvent.durationMs || 60000) / 1000)}
                onChange={(e) =>
                  pushDraftChange(
                    draftEvents.map(ev =>
                      ev.id === selectedEvent.id ? { ...ev, durationMs: Math.max(1000, Number(e.target.value) * 1000), endUtc: null } : ev
                    )
                  )
                }
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-white"
              />
            </div>
          </div>

          {/* Source & Recurrence Editing Row in Inspector */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 pt-2 border-t border-zinc-800">
            <div>
              <label className="block text-[10px] text-zinc-400">Media / Advertisement Asset</label>
              <select
                aria-label="Selected Event Media Asset"
                value={selectedEvent.mediaAssetId || ''}
                onChange={(e) =>
                  pushDraftChange(
                    draftEvents.map(ev => (ev.id === selectedEvent.id ? { ...ev, mediaAssetId: e.target.value || null } : ev))
                  )
                }
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-white"
              >
                <option value="">-- None --</option>
                {(selectedEvent.trackType === 'ADVERTISEMENTS' && advertisementAssets.length ? advertisementAssets : mediaAssets).map((m) => (
                  <option key={m.id} value={m.id}>{m.title} ({m.category})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-zinc-400">Video / Camera Source</label>
              <select
                aria-label="Selected Event Video Source"
                value={selectedEvent.videoSourceId || ''}
                onChange={(e) =>
                  pushDraftChange(
                    draftEvents.map(ev => (ev.id === selectedEvent.id ? { ...ev, videoSourceId: e.target.value || null } : ev))
                  )
                }
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-white"
              >
                <option value="">-- None --</option>
                {videoSources.map((vs) => (
                  <option key={vs.id} value={vs.id}>{vs.name} ({vs.sourceType})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-zinc-400">Independent Audio Source</label>
              <select
                aria-label="Selected Event Audio Source"
                value={selectedEvent.audioSourceId || ''}
                onChange={(e) =>
                  pushDraftChange(
                    draftEvents.map(ev => (ev.id === selectedEvent.id ? { ...ev, audioSourceId: e.target.value || null } : ev))
                  )
                }
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-white"
              >
                <option value="">-- None --</option>
                {audioSources.map((as) => (
                  <option key={as.id} value={as.id}>{as.name} ({as.sourceType})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-zinc-400">Recurrence Rule & Exceptions</label>
              <div className="flex gap-1">
                <select
                  aria-label="Selected Event Recurrence Frequency"
                  value={selectedEvent.recurrence?.frequency || 'ONCE'}
                  onChange={(e) =>
                    pushDraftChange(
                      draftEvents.map(ev =>
                        ev.id === selectedEvent.id
                          ? { ...ev, recurrence: { ...(ev.recurrence || {}), frequency: e.target.value } }
                          : ev
                      )
                    )
                  }
                  className="w-1/2 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-white"
                >
                  {RECURRENCE_FREQUENCIES.map((rf) => (
                    <option key={rf} value={rf}>{rf}</option>
                  ))}
                </select>
                <input
                  type="date"
                  aria-label="Add Exception Date"
                  value={newExceptionDate}
                  onChange={(e) => setNewExceptionDate(e.target.value)}
                  className="w-1/3 rounded border border-zinc-700 bg-zinc-900 px-1 py-1 text-white text-[10px]"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!newExceptionDate) return;
                    pushDraftChange(
                      draftEvents.map(ev => {
                        if (ev.id !== selectedEvent.id) return ev;
                        const existing = ev.recurrence?.exceptionDates || [];
                        return {
                          ...ev,
                          recurrence: {
                            ...(ev.recurrence || { frequency: 'DAILY' }),
                            exceptionDates: [...new Set([...existing, newExceptionDate])]
                          }
                        };
                      })
                    );
                    setNewExceptionDate('');
                  }}
                  className="rounded border border-zinc-700 bg-zinc-800 px-1.5 text-[10px] text-cyan-300"
                >
                  +Exc
                </button>
              </div>
              {(selectedEvent.recurrence?.exceptionDates || []).length > 0 && (
                <div className="text-[10px] text-amber-300 mt-1">
                  Exceptions: {(selectedEvent.recurrence.exceptionDates || []).join(', ')}
                </div>
              )}
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
                aria-label="New Event Title"
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
                  aria-label="New Event Track"
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
                  aria-label="New Event Execution Mode"
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
                  aria-label="New Event Local Start"
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
                  aria-label="New Event Duration"
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
                  aria-label="New Event Recurrence"
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

            {newEventForm.trackType === 'MAIN_VIDEO' && (
              <div>
                <label className="block text-[10px] text-zinc-400 mb-1">{isAr ? 'ملف الوسائط من المكتبة' : 'Media Library Asset'}</label>
                <select
                  aria-label="New Event Media Asset"
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

            {newEventForm.trackType === 'ADVERTISEMENTS' && (
              <div>
                <label className="block text-[10px] text-zinc-400 mb-1">{isAr ? 'الإعلان التجاري' : 'Advertisement Spot'}</label>
                <select
                  aria-label="New Event Advertisement Asset"
                  value={newEventForm.mediaAssetId}
                  onChange={(e) => setNewEventForm({ ...newEventForm, mediaAssetId: e.target.value })}
                  className="w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5"
                >
                  <option value="">-- Select Advertisement Asset --</option>
                  {(advertisementAssets.length ? advertisementAssets : mediaAssets).map((m) => (
                    <option key={m.id} value={m.id}>{m.title} ({m.category})</option>
                  ))}
                </select>
              </div>
            )}

            {newEventForm.trackType === 'LIVE_CAMERA_ROTATION' && (
              <div>
                <label className="block text-[10px] text-zinc-400 mb-1">{isAr ? 'مصدر الفيديو / الكاميرا' : 'Video Source'}</label>
                <select
                  aria-label="New Event Video Source"
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
                  aria-label="New Event Audio Source"
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
