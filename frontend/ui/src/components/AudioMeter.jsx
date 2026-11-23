import React from 'react';
import { cn } from '../utils.js';

export function AudioMeter({
  levelDb = -60, // -60 to 0+ dBFS
  peakDb = -60,
  label = '',
  channels = 2,
  isMuted = false,
  orientation = 'vertical', // 'vertical' or 'horizontal'
  className = ''
}) {
  // Normalize -60dB to 0dB into 0% - 100%
  const getPercentage = (db) => {
    if (db <= -60) return 0;
    if (db >= 0) return 100;
    return Math.min(100, Math.max(0, ((db + 60) / 60) * 100));
  };

  const currentPct = isMuted ? 0 : getPercentage(levelDb);
  const peakPct = isMuted ? 0 : getPercentage(peakDb);

  const isVertical = orientation === 'vertical';

  return (
    <div className={cn('flex flex-col gap-1 select-none font-mono text-[10px]', className)}>
      {label && <span className="text-zinc-400 truncate max-w-[80px]">{label}</span>}
      <div
        className={cn(
          'relative bg-zinc-950 border border-zinc-800 rounded overflow-hidden',
          isVertical ? 'h-36 w-4 flex flex-col justify-end' : 'h-3 w-full'
        )}
      >
        {/* dBFS Gradient Track */}
        <div
          className={cn(
            'transition-all duration-75',
            isVertical ? 'w-full' : 'h-full',
            'bg-gradient-to-t from-emerald-500 via-yellow-400 to-red-600'
          )}
          style={{
            [isVertical ? 'height' : 'width']: `${currentPct}%`
          }}
        />

        {/* Peak indicator tick */}
        {peakPct > 0 && !isMuted && (
          <div
            className={cn(
              'absolute bg-white shadow-[0_0_4px_#fff]',
              isVertical ? 'w-full h-[2px] left-0' : 'h-full w-[2px] top-0'
            )}
            style={{
              [isVertical ? 'bottom' : 'left']: `${peakPct}%`
            }}
          />
        )}

        {/* Muted overlay */}
        {isMuted && (
          <div className="absolute inset-0 bg-red-950/80 flex items-center justify-center text-red-500 font-bold text-[9px]">
            MUTE
          </div>
        )}
      </div>

      <div className="text-[9px] text-zinc-500 text-center font-mono">
        {isMuted ? 'MUTED' : `${Math.round(levelDb)} dB`}
      </div>
    </div>
  );
}
