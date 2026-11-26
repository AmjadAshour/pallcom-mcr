import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useMcrStore } from '../context/useMcrStore.js';
import { stationPath } from '../context/api.js';
import { useProgramStatus } from '../context/useProgramStatus.js';
import { useMonitorFrame } from '../context/useProgramMonitor.js';
import { LocalProgramScene } from '../components/LocalProgramScene.jsx';
import { translations } from '../i18n/translations.js';
import { Card, CardHeader, CardTitle, CardContent } from '@mcr/ui';
import { Layers, Eye, EyeOff, Video } from 'lucide-react';

function IndependentScenes({ stationId, language, canSchedule }) {
  const status = useProgramStatus(stationId);
  const running = status?.state === 'running';
  const path = stationPath(stationId, '/program/input-preview');
  const inputFrame = useMonitorFrame(path, running, 2000);
  const secondInputFrame = useMonitorFrame(path + '?input=secondary', running && Boolean(status.secondPort), 2000);
  if (!status?.configured) return null;
  return <LocalProgramScene stationId={stationId} language={language} running={running}
    inputFrame={inputFrame} inputReady={status.obs === 'ready'} secondInputFrame={secondInputFrame}
    secondInputReady={status.obs2 === 'ready'} secondInputConfigured={Boolean(status.secondPort)} canSchedule={canSchedule} />;
}

export function SourcesScenesPage() {
  const { language, stations, selectedStationId, selectStation } = useMcrStore();
  const t = translations[language] || translations.en;
  const { permissions } = useOutletContext();
  const canControl = permissions.includes('*') || permissions.includes('station:control');

  const currentStation = stations.find((s) => s.id === selectedStationId) || stations[0];
  const [activeSceneName, setActiveSceneName] = useState(
    currentStation ? currentStation.scenes[0]?.name : ''
  );
  const setSceneItem = useMcrStore((state) => state.setSceneItem);

  if (!currentStation) return null;

  const currentScene = currentStation.scenes.find((s) => s.name === activeSceneName) || currentStation.scenes[0];


  return (
    <div className="space-y-4">
      {/* Header and Station Selector */}
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-cyan-400" />
          <h1 className="text-base font-bold font-mono text-white uppercase tracking-wide">
            {t.nav.sourcesScenes}
          </h1>
        </div>

        <select
          value={currentStation.id}
          onChange={(e) => {
            selectStation(e.target.value);
            const nextSt = stations.find((s) => s.id === e.target.value);
            if (nextSt && nextSt.scenes[0]) setActiveSceneName(nextSt.scenes[0].name);
          }}
          className="bg-zinc-900 border border-zinc-700 text-white font-mono text-xs rounded px-3 py-1.5 focus:outline-none"
        >
          {stations.map((st) => (
            <option key={st.id} value={st.id}>
              {st.name} ({st.studioName})
            </option>
          ))}
        </select>
      </div>

      {canControl && <IndependentScenes key={currentStation.id} stationId={currentStation.id} language={language} canSchedule={permissions.includes('*') || permissions.includes('schedule:manage')} />}
      {/* Two Column Layout: Scenes List & Sources Inspector */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Scenes List Column */}
        <div className="md:col-span-5">
          <Card>
            <CardHeader className="flex justify-between items-center">
              <CardTitle>Scenes ({currentStation.scenes.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5">
                {currentStation.scenes.map((sc) => {
                  const isSelected = sc.name === activeSceneName;
                  const isPgm = sc.name === currentStation.currentProgramScene;
                  const isPvw = sc.name === currentStation.currentPreviewScene;

                  return (
                    <button
                      key={sc.name}
                      onClick={() => setActiveSceneName(sc.name)}
                      className={`w-full text-left px-3 py-2.5 rounded border transition-all flex items-center justify-between font-mono text-xs ${
                        isSelected
                          ? 'bg-zinc-800 text-white border-zinc-600 font-bold'
                          : 'bg-zinc-900/60 text-zinc-300 border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <Layers className="w-4 h-4 text-zinc-400" />
                        <span className="truncate">{sc.name}</span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {isPgm && (
                          <span className="bg-red-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                            PGM
                          </span>
                        )}
                        {isPvw && (
                          <span className="bg-emerald-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                            PVW
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Scene Sources Inspector Column */}
        <div className="md:col-span-7">
          <Card>
            <CardHeader className="flex justify-between items-center">
              <div>
                <CardTitle>Source Items for "{currentScene?.name}"</CardTitle>
                <p className="text-xs text-zinc-400">Manage source visibility within the selected scene.</p>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {currentScene?.sources.map((source, idx) => {
                  const srcName = source.sourceName;
                  const isHidden = !source.sceneItemEnabled;

                  return (
                    <div
                      key={source.sceneItemId}
                      className="flex items-center justify-between p-2.5 bg-zinc-950 border border-zinc-800 rounded font-mono text-xs hover:border-zinc-700 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-zinc-600 font-bold w-4">{idx + 1}</span>
                        <Video className="w-4 h-4 text-cyan-400" />
                        <span className={`font-medium ${isHidden ? 'text-zinc-500 line-through' : 'text-zinc-200'}`}>
                          {srcName}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setSceneItem(currentStation.id, currentScene.name, source.sceneItemId, isHidden)}
                          className={`p-1.5 rounded transition-colors ${
                            isHidden
                              ? 'bg-zinc-800 text-zinc-500'
                              : 'bg-zinc-800 text-emerald-400 hover:bg-zinc-700'
                          }`}
                          title="Toggle Visibility"
                        >
                          {isHidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

