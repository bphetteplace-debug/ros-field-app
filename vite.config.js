import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';

// Skip the Sentry plugin entirely outside production builds (dev / vitest
// / preview). The plugin still attaches in dev mode even with disable:true
// and can interfere with React module identity (Invalid Hook Call).
const isProdBuild = process.env.NODE_ENV === 'production';

export default defineConfig({
  plugins: [
    react(),
    // Source-maps upload to Sentry. Only runs in CI / Vercel prod builds
    // where SENTRY_AUTH_TOKEN is present AND NODE_ENV is production.
    ...(isProdBuild && process.env.SENTRY_AUTH_TOKEN
      ? [sentryVitePlugin({
          org: 'reliable-oilfield-services',
          project: 'javascript-react',
          authToken: process.env.SENTRY_AUTH_TOKEN,
          silent: true,
          sourcemaps: {
            assets: './dist/**',
            filesToDeleteAfterUpload: ['./dist/**/*.map'],
          },
        })]
      : []),
  ],
  build: {
    // 'hidden' = generate sourcemaps for the Sentry plugin to upload, but
    // do NOT add sourceMappingURL comments to the JS bundles, so source
    // maps are never publicly fetched from /assets/*.map.
    sourcemap: 'hidden',
  },
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
