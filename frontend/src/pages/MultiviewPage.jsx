import React from 'react';
import { ProgramPreview } from '../components/ProgramPreview.jsx';
import { useMcrStore } from '../context/useMcrStore.js';
import { translations } from '../i18n/translations.js';
import { TallyIndicator } from '@mcr/ui';
import { Grid } from 'lucide-react';

export function MultiviewPage() {
  const { language, stations, multiviewLayout, setMultiviewLayout } = useMcrStore();
  const t = translations[language] || translations.en;

  const getGridClasses = () => {
    switch (multiviewLayout) {
      case 'grid2x2':
        return 'grid grid-cols-1 md:grid-cols-2 gap-3 h-[calc(100vh-140px)]';
      case 'grid3x3':
        return 'grid grid-cols-2 md:grid-cols-3 gap-2.5 h-[calc(100vh-140px)]';
      case 'grid4x4':
        return 'grid grid-cols-2 md:grid-cols-4 gap-2 h-[calc(100vh-140px)]';
      case 'grid1Plus7':
      default:
        return 'grid grid-cols-1 lg:grid-cols-4 gap-3 h-[calc(100vh-140px)]';
    }
  };

  return (
    <div className="space-y-3 flex flex-col h-full">
      {/* Top Multiview Controls */}
      <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Grid className="w-5 h-5 text-cyan-400" />
          <h1 className="text-base font-bold font-mono text-white tracking-wide uppercase">
            {t.multiview.title}
          </h1>
          <span className="text-xs text-zinc-400">{language === 'ar' ? 'لقطات دورية من OBS' : 'Periodic OBS snapshots'}</span>
        </div>

        {/* Layout Selectors */}
        <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 p-1 rounded font-mono text-xs">
          <button
            onClick={() => setMultiviewLayout('grid2x2')}
            className={`px-3 py-1 rounded transition-colors ${
              multiviewLayout === 'grid2x2' ? 'bg-zinc-800 text-white font-bold' : 'text-zinc-400 hover:text-white'
            }`}
          >
            {t.multiview.grid2x2}
          </button>
          <button
            onClick={() => setMultiviewLayout('grid3x3')}
            className={`px-3 py-1 rounded transition-colors ${
              multiviewLayout === 'grid3x3' ? 'bg-zinc-800 text-white font-bold' : 'text-zinc-400 hover:text-white'
            }`}
          >
            {t.multiview.grid3x3}
          </button>
          <button
            onClick={() => setMultiviewLayout('grid4x4')}
            className={`px-3 py-1 rounded transition-colors ${
              multiviewLayout === 'grid4x4' ? 'bg-zinc-800 text-white font-bold' : 'text-zinc-400 hover:text-white'
            }`}
          >
            {t.multiview.grid4x4}
          </button>
        </div>
      </div>

      {/* Multiview Cells Grid */}
      <div className={getGridClasses()}>
        {stations.map((st, index) => {
          const isStreaming = st.streamStatus === 'STREAMING';
          const isOnline = st.status === 'ONLINE';

          return (
            <div
              key={st.id}
              className={`relative bg-black rounded-lg overflow-hidden flex flex-col border-2 transition-all ${
                isStreaming
                  ? 'border-red-600 shadow-[0_0_15px_rgba(220,38,38,0.3)]'
                  : isOnline
                  ? 'border-zinc-700'
                  : 'border-zinc-900 opacity-60'
              }`}
            >
              {/* Multiview Top Bar with Station Name & Tally */}
              <div
                className={`px-2.5 py-1 flex items-center justify-between text-xs font-mono font-bold select-none ${
                  isStreaming
                    ? 'bg-red-950/90 text-red-400 border-b border-red-800/60'
                    : 'bg-zinc-900/90 text-zinc-300 border-b border-zinc-800'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <TallyIndicator
                    state={isStreaming ? 'program' : isOnline ? 'preview' : 'idle'}
                    pulse={isStreaming}
                    size="sm"
                  />
                  <span className="truncate">CAM {index + 1}: {st.name}</span>
                </div>
                <span className="text-[10px] text-zinc-400">{st.fps.toFixed(1)} FPS</span>
              </div>

              <div className="relative flex-1 bg-zinc-950 flex items-center justify-center overflow-hidden">
                <ProgramPreview key={st.id} station={st} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

