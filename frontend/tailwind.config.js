import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const normalize = (p) => p.replace(/\\/g, '/');

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    normalize(path.join(__dirname, 'index.html')),
    normalize(path.join(__dirname, 'src/**/*.{js,jsx}')),
    normalize(path.join(__dirname, 'ui/src/**/*.{js,jsx}'))
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        tally: {
          pgm: '#dc2626',
          pvw: '#10b981',
          warn: '#f59e0b',
          idle: '#52525b'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
        arabic: ['Cairo', 'Tahoma', 'sans-serif']
      }
    },
  },
  plugins: [],
};
