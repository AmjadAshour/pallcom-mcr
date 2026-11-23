import { build } from 'vite';

await build({
  configFile: false,
  ssr: { noExternal: true },
  build: {
    ssr: 'backend/agent/src/index.js',
    outDir: process.argv[2],
    rollupOptions: {
      external: ['@ffprobe-installer/ffprobe'],
      output: { entryFileNames: 'agent.mjs' }
    }
  }
});
