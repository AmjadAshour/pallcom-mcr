import React from 'react';
import { cn } from '../utils.js';

export function Button({
  children,
  variant = 'primary', // 'primary', 'secondary', 'tally-pgm', 'tally-pvw', 'danger', 'ghost', 'outline'
  size = 'md', // 'sm', 'md', 'lg', 'icon'
  disabled = false,
  className = '',
  onClick,
  type = 'button',
  ...props
}) {
  const baseClasses = 'inline-flex items-center justify-center font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-zinc-950 disabled:opacity-50 disabled:pointer-events-none select-none';

  const sizeClasses = {
    sm: 'text-xs px-2.5 py-1.5 h-8 gap-1.5',
    md: 'text-sm px-4 py-2 h-10 gap-2',
    lg: 'text-base px-6 py-2.5 h-12 gap-2.5',
    icon: 'h-9 w-9 p-0'
  };

  const variantClasses = {
    primary: 'bg-zinc-100 text-zinc-900 hover:bg-white focus:ring-zinc-400 font-semibold',
    secondary: 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border border-zinc-700 focus:ring-zinc-600',
    'tally-pgm': 'bg-red-600 text-white hover:bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.5)] focus:ring-red-500 font-bold uppercase tracking-wider',
    'tally-pvw': 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)] focus:ring-emerald-500 font-bold uppercase tracking-wider',
    danger: 'bg-red-700/80 text-white hover:bg-red-600 border border-red-600/50 focus:ring-red-500',
    outline: 'bg-transparent border border-zinc-700 text-zinc-200 hover:bg-zinc-800/80 focus:ring-zinc-600',
    ghost: 'bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-white'
  };

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cn(baseClasses, sizeClasses[size] || sizeClasses.md, variantClasses[variant] || variantClasses.secondary, className)}
      {...props}
    >
      {children}
    </button>
  );
}
