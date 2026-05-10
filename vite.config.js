import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
  },
  // Inject a build-time version string into sw.js so each deploy gets a
  // unique cache name — busting stale assets without any extra dependencies.
  // __SW_VERSION__ is replaced in public/sw.js at build time.
  define: {
    __SW_VERSION__: JSON.stringify(Date.now().toString()),
  },
});
