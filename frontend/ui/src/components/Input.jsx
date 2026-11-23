import React from 'react';
import { cn } from '../utils.js';

export function Input({
  className = '',
  type = 'text',
  error = null,
  label = null,
  ...props
}) {
  return (
    <div className="w-full space-y-1">
      {label && <label className="block text-xs font-medium text-zinc-300">{label}</label>}
      <input
        type={type}
        className={cn(
          'flex h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50 transition-colors',
          error ? 'border-red-500 focus:ring-red-500' : '',
          className
        )}
        {...props}
      />
      {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
    </div>
  );
}
