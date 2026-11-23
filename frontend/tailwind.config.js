/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
    "./ui/src/**/*.{js,jsx}"
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
}
