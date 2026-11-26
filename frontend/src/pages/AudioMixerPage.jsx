import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { useMcrStore } from '../context/useMcrStore.js';
import { ProgramAudioControls } from '../components/ProgramAudioControls.jsx';
import { translations } from '../i18n/translations.js';
import { Card, CardHeader, CardTitle, CardContent, Button, AudioMeter } from '@mcr/ui';
import { Volume2, VolumeX, Mic, Music, Radio } from 'lucide-react';

export function AudioMixerPage() {
  const { language, stations, selectedStationId, selectStation, setInputVolume, setInputMute, pending } = useMcrStore();
  const { permissions } = useOutletContext();
  const t = translations[language] || translations.en;

  const currentStation = stations.find((s) => s.id === selectedStationId) || stations[0];

  if (!currentStation) return null;
  const canControl = permissions.includes('*') || permissions.includes('station:control');
  const disabled = !currentStation.ready || Boolean(pending[currentStation.id]) || !canControl;

  return (
    <div className="space-y-4">
      {/* Target Station Selector */}
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <Volume2 className="w-6 h-6 text-cyan-400" />
          <div>
            <h1 className="text-base font-bold font-mono text-white uppercase tracking-wide">
              {t.audio.title}
            </h1>
            <p className="text-xs text-zinc-400">{language === 'ar' ? 'مستويات الصوت والتحكم في مداخل OBS' : 'OBS input levels, faders, and mute'}</p>
          </div>
        </div>

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
      </div>

      <ProgramAudioControls key={currentStation.id} stationId={currentStation.id} language={language} canControl={canControl} />
      {/* Multitrack Mixing Console Strips */}
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
              {/* Channel Header */}
              <div className="text-center w-full pb-2 border-b border-zinc-800">
                <Mic className={`w-4 h-4 mx-auto mb-1 ${isMaster ? 'text-cyan-400' : 'text-zinc-400'}`} />
                <h4 className="text-xs font-mono font-bold text-white truncate px-1" title={input.name}>
                  {input.name}
                </h4>
                <span className="text-[10px] font-mono text-zinc-500">
                  {isMaster ? (t.audio?.busOut || 'BUS OUT') : (t.audio?.input || 'INPUT')}
                </span>
              </div>

              {/* VU Meter & Fader Pair */}
              <div className="flex items-center justify-center gap-3 my-4 h-48">
                {/* Visual dBFS Meter */}
                <AudioMeter
                  levelDb={input.levelDb ?? -60}
                  peakDb={input.peakDb ?? -60}
                  isMuted={input.muted}
                  orientation="vertical"
                />

                {/* Vertical Slider Fader */}
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

              {/* Volume dB Indicator */}
              <div className="w-full bg-zinc-950 border border-zinc-800 rounded py-1 text-center font-mono text-xs font-bold text-zinc-200 mb-3">
                {input.muted ? 'MUTED' : `${input.volumeDb} dB`}
              </div>

              {/* Mute and Solo Controls */}
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
    </div>
  );
}

