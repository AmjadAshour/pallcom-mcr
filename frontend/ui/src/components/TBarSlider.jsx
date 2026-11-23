import React from 'react';
import { cn } from '../utils.js';

export function TBarSlider({
  value = 0, // 0 (Preview) to 100 (Program)
  onChange = () => {},
  onComplete = () => {},
  disabled = false,
  className = ''
}) {
  const handleChange = (e) => {
    const val = Number(e.target.value);
    onChange(val);
  };

  return (
    <div className={cn('flex flex-col items-center gap-2 p-3 bg-zinc-900 border border-zinc-800 rounded-lg select-none', className)}>
      <div className="flex justify-between w-full text-[11px] font-mono font-bold text-zinc-400">
        <span className="text-emerald-400">PVW (0%)</span>
        <span className="text-red-400">PGM (100%)</span>
      </div>

      <div className="relative w-full flex items-center h-8">
        <input
          type="range"
          min="0"
          max="100"
          value={value}
          disabled={disabled}
          aria-label="Manual transition position"
          onChange={handleChange}
          onPointerUp={onComplete}
          onKeyUp={(event) => {
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) onComplete();
          }}
          className="w-full h-3 bg-zinc-950 rounded-lg appearance-none cursor-pointer accent-red-600 focus:outline-none border border-zinc-700"
        />
      </div>

      <div className="text-xs font-mono font-bold text-zinc-300">
        T-BAR: {value}%
      </div>
    </div>
  );
}
