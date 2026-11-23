import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { ProgramPreview } from '../components/ProgramPreview.jsx';
import { useMcrStore } from '../context/useMcrStore.js';
import { translations } from '../i18n/translations.js';
import { Card, CardHeader, CardTitle, CardContent, Button, TallyIndicator, TBarSlider } from '@mcr/ui';
import { Radio, Film, Activity } from 'lucide-react';

export function LiveControlPage() {
  const {
    language,
    stations,
    selectedStationId,
    selectStation,
    switchProgramScene,
    switchPreviewScene,
    triggerCut,
    triggerAutoTransition,
    tBarPosition,
    setTBarPosition,
    toggleStream,
    toggleRecord, pending, releaseTBar, setStudioMode, setTransitionType, setTransitionDuration
  } = useMcrStore();

  const t = translations[language] || translations.en;
  const currentStation = stations.find((s) => s.id === selectedStationId) || stations[0];

  const user = useOutletContext();
  if (!currentStation) return null;
  const disabled = !currentStation.ready || Boolean(pending[currentStation.id]) ||
    !(user.permissions.includes('*') || user.permissions.includes('station:control'));
  const studioUnavailable = disabled || !currentStation.studioModeEnabled;

  const isStreaming = currentStation.streamStatus === 'STREAMING';
  const isRecording = currentStation.recordStatus === 'RECORDING';

  return (
    <div className="space-y-4">
      {/* Top Station Selector & Critical Guard */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 bg-zinc-900 border border-zinc-800 p-3 rounded-lg shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-red-950/60 border border-red-800 rounded">
            <Radio className="w-5 h-5 text-red-500 animate-pulse" />
          </div>
          <div>
            <label className="text-[10px] font-mono uppercase text-zinc-400 block">
              {t.liveControl?.activeStation || 'Active Control Station'}
            </label>
            <select
              value={currentStation.id}
              onChange={(e) => selectStation(e.target.value)}
              className="bg-zinc-950 border border-zinc-700 text-white font-mono font-bold text-sm rounded px-3 py-1 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              {stations.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name} ({st.studioName}) [{st.status}]
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Live Broadcast Tally Controls */}
        <div className="flex items-center gap-2">
          <Button
            variant={isStreaming ? 'tally-pgm' : 'outline'}
            size="sm"
            onClick={() => toggleStream(currentStation.id)} disabled={disabled}
            className="font-mono text-xs"
          >
            <Activity className="w-3.5 h-3.5 me-1" />
            {isStreaming ? (t.liveControl?.streamOnAir || 'STREAM: ON AIR') : (t.liveControl?.startStream || 'START STREAM')}
          </Button>

          <Button
            variant={isRecording ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => toggleRecord(currentStation.id)} disabled={disabled}
            className="font-mono text-xs"
          >
            <Film className="w-3.5 h-3.5 me-1 text-blue-400" />
            {isRecording ? (t.liveControl?.recActive || 'REC: ACTIVE') : (t.liveControl?.startRec || 'START REC')}
          </Button>
        </div>
      </div>

      {/* Broadcast Dual Deck: Preview & Program */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        {/* PREVIEW DECK (Green Tally) */}
        <div className="lg:col-span-5 flex flex-col">
          <div className="bg-zinc-900 border-2 border-emerald-500/80 rounded-lg overflow-hidden flex flex-col flex-1 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
            <div className="bg-emerald-950/80 px-3 py-2 border-b border-emerald-500/40 flex items-center justify-between">
              <TallyIndicator state="preview" label={t.liveControl?.previewTally || 'PREVIEW DECK'} />
              <span className="font-mono text-xs font-bold text-emerald-400 truncate">
                {currentStation.currentPreviewScene || (t.liveControl?.noPreview || 'NO PREVIEW')}
              </span>
            </div>

            {/* Video Preview Canvas */}
            <div className="relative aspect-video bg-black flex items-center justify-center border-b border-zinc-800">
              <div className="absolute inset-0 bg-gradient-to-tr from-emerald-950/20 to-transparent pointer-events-none" />
              <div className="text-center font-mono">
                <span className="text-4xl font-black text-zinc-800 tracking-widest block">
                  {t.liveControl?.previewTally || 'PREVIEW'}
                </span>
                <ProgramPreview key={currentStation.id} station={currentStation} preview />
              </div>
              <div className="absolute top-2 start-2 bg-zinc-950/80 px-2 py-0.5 rounded text-[10px] font-mono text-zinc-400 border border-zinc-800">
                1080p59.94
              </div>
            </div>

            {/* Quick Preview Bus Scenes */}
            <div className="p-3 bg-zinc-950/80 flex-1">
              <p className="text-[10px] font-mono uppercase text-zinc-400 mb-2 font-bold">
                {t.liveControl?.cuePreview || 'Cue Preview (Next)'}
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {currentStation.scenes.map((sc) => {
                  const isPvw = sc.name === currentStation.currentPreviewScene;
                  return (
                    <button
                      key={sc.name}
                      onClick={() => switchPreviewScene(currentStation.id, sc.name)} disabled={studioUnavailable}
                      className={`px-2.5 py-2 rounded text-left text-xs font-mono font-medium truncate transition-all border ${
                        isPvw
                          ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                          : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      {sc.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* CENTER TRANSITION CONTROL PANEL */}
        <div className="lg:col-span-2 flex flex-col justify-center gap-3 bg-zinc-900 border border-zinc-800 p-3 rounded-lg">
          <div className="text-center pb-2 border-b border-zinc-800">
            <span className="text-[10px] font-mono uppercase text-zinc-400 font-bold block">
              {t.liveControl?.transitionLabel || 'Transition'}
            </span>
            <select
              value={currentStation.transitionName || ''} disabled={disabled}
              onChange={(e) => setTransitionType(currentStation.id, e.target.value)}
              className="mt-1 w-full bg-zinc-950 border border-zinc-700 text-zinc-200 text-xs font-mono rounded px-2 py-1 text-center"
            >
              {(currentStation.transitions || []).map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>

          <Button disabled={disabled} onClick={() => setStudioMode(currentStation.id, !currentStation.studioModeEnabled)}>{currentStation.studioModeEnabled ? 'Disable Studio Mode' : 'Enable Studio Mode'}</Button>
          {/* Hard Cut (TAKE) */}
          <Button
            variant="tally-pgm"
            size="md"
            onClick={triggerCut} disabled={studioUnavailable}
            className="w-full py-4 text-sm font-black tracking-widest"
          >
            {t.liveControl.take}
          </Button>

          {/* Auto Transition */}
          <Button
            variant="secondary"
            size="md"
            onClick={triggerAutoTransition} disabled={studioUnavailable}
            className="w-full py-3 text-xs font-black tracking-widest font-mono"
          >
            {t.liveControl.auto}
          </Button>

          {/* Interactive T-Bar */}
          <TBarSlider
            value={tBarPosition}
            onChange={setTBarPosition}
            onComplete={releaseTBar} disabled={studioUnavailable}
          />

          {/* Transition Rate */}
          <div className="text-center pt-2 border-t border-zinc-800">
            <label className="text-[10px] font-mono text-zinc-500 uppercase block">{t.liveControl?.rateMs || 'Rate (ms)'}</label>
            <input
              type="number"
              key={`${currentStation.id}:${currentStation.transitionDuration}`} defaultValue={currentStation.transitionDuration ?? ''} min={50} max={20000}
              disabled={disabled || currentStation.transitionDuration == null}
              onBlur={(e) => { if (e.target.validity.valid && Number(e.target.value) !== currentStation.transitionDuration) void setTransitionDuration(currentStation.id, Number(e.target.value)); }}
              className="w-full bg-zinc-950 border border-zinc-800 text-center font-mono text-xs text-zinc-200 rounded py-1"
            />
          </div>
        </div>

        {/* PROGRAM DECK (Red Tally) */}
        <div className="lg:col-span-5 flex flex-col">
          <div className="bg-zinc-900 border-2 border-red-600/90 rounded-lg overflow-hidden flex flex-col flex-1 shadow-[0_0_20px_rgba(239,68,68,0.3)]">
            <div className="bg-red-950/80 px-3 py-2 border-b border-red-500/40 flex items-center justify-between">
              <TallyIndicator state="program" pulse label={t.liveControl.programTally} />
              <span className="font-mono text-xs font-bold text-red-400 truncate">
                {currentStation.currentProgramScene || (t.liveControl?.noSignal || 'NO SIGNAL')}
              </span>
            </div>

            {/* Video Program Canvas */}
            <div className="relative aspect-video bg-black flex items-center justify-center border-b border-zinc-800">
              <div className="absolute inset-0 bg-gradient-to-tr from-red-950/30 to-transparent pointer-events-none" />
              <div className="text-center font-mono">
                <span className="text-4xl font-black text-zinc-800 tracking-widest block">
                  {t.liveControl?.programTally || 'PROGRAM'}
                </span>
                <ProgramPreview key={currentStation.id} station={currentStation} />
              </div>
              <div className="absolute top-2 start-2 bg-red-600 px-2 py-0.5 rounded text-[10px] font-mono text-white font-bold animate-pulse">
                {t.tally?.streaming || 'LIVE ON-AIR'}
              </div>
            </div>

            {/* Direct Cut Program Bus Scenes */}
            <div className="p-3 bg-zinc-950/80 flex-1">
              <p className="text-[10px] font-mono uppercase text-red-500 mb-2 font-bold">
                {t.liveControl?.directCutPgm || 'Direct Cut to Program (LIVE)'}
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {currentStation.scenes.map((sc) => {
                  const isPgm = sc.name === currentStation.currentProgramScene;
                  return (
                    <button
                      key={sc.name}
                      onClick={() => switchProgramScene(currentStation.id, sc.name)} disabled={disabled}
                      className={`px-2.5 py-2 rounded text-left text-xs font-mono font-medium truncate transition-all border ${
                        isPgm
                          ? 'bg-red-600/30 text-red-300 border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.4)]'
                          : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      {sc.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


