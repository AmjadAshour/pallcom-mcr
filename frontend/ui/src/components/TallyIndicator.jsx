import React from 'react';
import { cn } from '../utils.js';

export function TallyIndicator({
  state = 'idle', // 'program' (red), 'preview' (green), 'warning' (amber), 'idle' (gray)
  label = null,
  pulse = false,
  size = 'md',
  className = ''
}) {
  const sizeClasses = {
    sm: 'h-2 w-2 text-xs',
    md: 'h-3 w-3 text-xs',
    lg: 'h-4 w-4 text-sm'
  };

  const stateClasses = {
    program: 'bg-red-600 shadow-[0_0_10px_rgba(239,68,68,0.8)] border-red-500',
    preview: 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)] border-emerald-400',
    warning: 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.8)] border-amber-400',
    idle: 'bg-zinc-600 border-zinc-700'
  };

  return (
    <div className={cn('inline-flex items-center gap-2 font-mono uppercase tracking-wider', className)}>
      <span
        className={cn(
          'rounded-full border transition-all duration-200',
          sizeClasses[size] || sizeClasses.md,
          stateClasses[state] || stateClasses.idle,
          pulse && (state === 'program' ? 'animate-pulse' : '')
        )}
      />
      {label && (
        <span
          className={cn(
            'font-bold',
            state === 'program' ? 'text-red-500' :
            state === 'preview' ? 'text-emerald-400' :
            state === 'warning' ? 'text-amber-400' : 'text-zinc-400'
          )}
        >
          {label}
        </span>
      )}
    </div>
  );
}
