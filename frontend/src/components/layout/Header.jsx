import React from 'react';
import { useMcrStore } from '../../context/useMcrStore.js';
import { translations } from '../../i18n/translations.js';
import { Button, TallyIndicator } from '@mcr/ui';
import { AlertTriangle, Sun, Moon, Tv, Languages } from 'lucide-react';

export function Header({ permissions }) {
  const {
    language,
    setLanguage,
    theme,
    toggleTheme,
    selectedStationId,
    pending,
    triggerEmergencyCut,
    stations
  } = useMcrStore();

  const t = translations[language] || translations.en;

  const streamingCount = stations.filter((s) => s.streamStatus === 'STREAMING').length;
  const recordingCount = stations.filter((s) => s.recordStatus === 'RECORDING').length;
  const onlineCount = stations.filter((s) => s.status === 'ONLINE').length;
  const selectedStation = stations.find((station) => station.id === selectedStationId);
  const emergencyScene = 'Emergency Slate / Standby';
  const emergencyCutActive = selectedStation?.ready && selectedStation.currentProgramScene === emergencyScene;
  const canCut = (permissions.includes('*') || permissions.includes('station:control')) &&
    selectedStation?.ready && !pending[selectedStationId] && selectedStation.scenes.some((scene) => scene.name === emergencyScene);

  return (
    <header className="h-14 border-b border-zinc-800 bg-zinc-950 px-4 flex items-center justify-between select-none z-30">
      {/* Brand & Edition */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-2.5 py-1 bg-red-950/40 border border-red-800/60 rounded">
          <Tv className="w-5 h-5 text-red-500 animate-pulse" />
          <span className="font-mono font-black text-sm tracking-widest text-red-500">
            {t.app.title}
          </span>
        </div>
        <span className="hidden md:inline text-xs font-mono text-zinc-400 border-s border-zinc-800 ps-3">
          {t.app.tagline}
        </span>
      </div>

      {/* Real-time Broadcast Status Tallies */}
      <div className="hidden lg:flex items-center gap-4 bg-zinc-900/80 px-3 py-1.5 rounded-md border border-zinc-800">
        <div className="flex items-center gap-2">
          <TallyIndicator state={streamingCount > 0 ? 'program' : 'idle'} pulse={streamingCount > 0} />
          <span className="text-xs font-mono text-zinc-300">
            {t.header?.air || 'AIR'}: <strong className="text-red-500">{streamingCount}</strong>
          </span>
        </div>

        <div className="flex items-center gap-2 border-s border-zinc-700/60 ps-3">
          <TallyIndicator state={recordingCount > 0 ? 'warning' : 'idle'} />
          <span className="text-xs font-mono text-zinc-300">
            {t.header?.rec || 'REC'}: <strong className="text-blue-400">{recordingCount}</strong>
          </span>
        </div>

        <div className="flex items-center gap-2 border-s border-zinc-700/60 ps-3">
          <TallyIndicator state={onlineCount > 0 ? 'preview' : 'idle'} />
          <span className="text-xs font-mono text-zinc-300">
            {t.header?.online || 'ONLINE'}: <strong className="text-emerald-400">{onlineCount}/{stations.length}</strong>
          </span>
        </div>
      </div>

      {/* Actions & Switches */}
      <div className="flex items-center gap-2.5">
        {/* Emergency Master Cut Button */}
        <Button
          variant={emergencyCutActive ? 'tally-pgm' : 'danger'}
          size="sm"
          onClick={triggerEmergencyCut}
          disabled={!canCut}
          title={language === 'ar' ? 'مشهد الطوارئ للمحطة المحددة' : 'Emergency scene for the selected station'}
          className={`font-mono text-xs font-bold tracking-wider ${
            emergencyCutActive ? 'animate-bounce shadow-[0_0_20px_rgba(239,68,68,1)]' : ''
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5 me-1.5" />
          {emergencyCutActive ? t.app.emergencyCutActive : t.app.emergencyCut}
        </Button>

        {/* Side-by-Side Language Switcher: [ EN | العربية ] */}
        <div className="flex items-center bg-zinc-900 border border-zinc-700/80 rounded-md p-0.5 select-none text-xs font-mono">
          <button
            type="button"
            onClick={() => setLanguage('en')}
            className={`px-2.5 py-1 rounded transition-all font-semibold ${
              language === 'en'
                ? 'bg-zinc-800 text-cyan-400 border border-zinc-600 shadow-sm font-bold'
                : 'text-zinc-400 hover:text-zinc-100'
            }`}
          >
            English
          </button>
          <button
            type="button"
            onClick={() => setLanguage('ar')}
            className={`px-2.5 py-1 rounded transition-all font-semibold font-arabic ${
              language === 'ar'
                ? 'bg-zinc-800 text-cyan-400 border border-zinc-600 shadow-sm font-bold'
                : 'text-zinc-400 hover:text-zinc-100'
            }`}
          >
            العربية
          </button>
        </div>

        {/* Theme Toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className="text-zinc-400 hover:text-white"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </Button>
      </div>
    </header>
  );
}
