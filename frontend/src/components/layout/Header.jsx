import React from 'react';
import { useMcrStore } from '../../context/useMcrStore.js';
import { translations } from '../../i18n/translations.js';
import { Button } from '@mcr/ui';
import { Sun, Moon, Tv } from 'lucide-react';

export function Header() {
  const {
    language,
    setLanguage,
    theme,
    toggleTheme
  } = useMcrStore();

  const t = translations[language] || translations.en;

  return (
    <header className="h-14 border-b border-zinc-800 bg-zinc-950 px-4 flex items-center justify-between select-none z-30">
      {/* Brand & Edition */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-2.5 py-1 bg-red-950/40 border border-red-800/60 rounded">
          <Tv className="w-5 h-5 text-red-500" />
          <span className="font-mono font-black text-sm tracking-widest text-red-500">
            {t.app.title}
          </span>
        </div>
        <span className="hidden md:inline text-xs font-mono text-zinc-400 border-s border-zinc-800 ps-3">
          {t.app.tagline}
        </span>
      </div>

      <div className="flex items-center gap-2.5">
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
          aria-label={language === 'ar' ? 'تبديل المظهر' : 'Toggle theme'}
          className="text-zinc-400 hover:text-white"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </Button>
      </div>
    </header>
  );
}
