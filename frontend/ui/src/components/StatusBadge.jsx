import React from 'react';
import { cn } from '../utils.js';

export function StatusBadge({ status = 'OFFLINE', className = '' }) {
  const styles = {
    ONLINE: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    STREAMING: 'bg-red-500/10 text-red-400 border-red-500/30',
    RECORDING: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    OFFLINE: 'bg-zinc-800 text-zinc-400 border-zinc-700',
    DEGRADED: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    CONNECTING: 'bg-purple-500/10 text-purple-400 border-purple-500/30'
  };

  const dots = {
    ONLINE: 'bg-emerald-400',
    STREAMING: 'bg-red-500 animate-pulse',
    RECORDING: 'bg-blue-400 animate-pulse',
    OFFLINE: 'bg-zinc-500',
    DEGRADED: 'bg-amber-400',
    CONNECTING: 'bg-purple-400 animate-ping'
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-medium border',
        styles[status] || styles.OFFLINE,
        className
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dots[status] || dots.OFFLINE)} />
      {status}
    </span>
  );
}
