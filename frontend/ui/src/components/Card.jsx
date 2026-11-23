import React from 'react';
import { cn } from '../utils.js';

export function Card({ children, className = '', ...props }) {
  return (
    <div
      className={cn('bg-zinc-900/90 border border-zinc-800 rounded-lg p-4 shadow-sm backdrop-blur', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = '' }) {
  return <div className={cn('flex items-center justify-between pb-3 border-b border-zinc-800/80 mb-3', className)}>{children}</div>;
}

export function CardTitle({ children, className = '' }) {
  return <h3 className={cn('text-sm font-semibold tracking-wide text-zinc-100 uppercase', className)}>{children}</h3>;
}

export function CardDescription({ children, className = '' }) {
  return <p className={cn('text-xs text-zinc-400', className)}>{children}</p>;
}

export function CardContent({ children, className = '' }) {
  return <div className={cn('space-y-3', className)}>{children}</div>;
}
