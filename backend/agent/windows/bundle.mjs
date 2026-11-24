import { build } from 'vite';

await build({
  configFile: false,
  ssr: { noExternal: true },
  build: {
    ssr: 'backend/agent/src/index.js',
    outDir: process.argv[2],
    commonjsOptions: {
      // Keep ws's optional native add-ons out of the portable bundle so its JS fallbacks stay active.
      ignore: ['bufferutil', 'utf-8-validate']
    },
    rollupOptions: {
      external: ['@ffprobe-installer/ffprobe'],
      output: { entryFileNames: 'agent.mjs' }
    }
  }
});
