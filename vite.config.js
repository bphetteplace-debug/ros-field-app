import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import fs from 'node:fs';
import path from 'node:path';

// Skip the Sentry plugin entirely outside production builds (dev / vitest
// / preview). The plugin still attaches in dev mode even with disable:true
// and can interfere with React module identity (Invalid Hook Call).
const isProdBuild = process.env.NODE_ENV === 'production';

// Vite's `define` option only substitutes tokens in JS modules that go
// through the build pipeline. Files in `public/` are copied as-is, so
// `__SW_VERSION__` inside public/sw.js was NEVER replaced — the cache name
// stayed `reliabletrack-dev` across every deploy, never invalidating old
// chunks. This plugin does the substitution on dist/sw.js after build.
const stampServiceWorkerVersion = () => ({
  name: 'stamp-sw-version',
  apply: 'build',
  writeBundle(options) {
    const outDir = options.dir || 'dist';
    const swPath = path.join(outDir, 'sw.js');
    if (!fs.existsSync(swPath)) return;
    const version = Date.now().toString();
    const before = fs.readFileSync(swPath, 'utf-8');
    const after = before.replace(/__SW_VERSION__/g, JSON.stringify(version));
    if (before === after) return; // nothing to stamp
    fs.writeFileSync(swPath, after, 'utf-8');
    // eslint-disable-next-line no-console
    console.log(`[stamp-sw-version] dist/sw.js stamped with ${version}`);
  },
});

export default defineConfig({
  plugins: [
    react(),
    stampServiceWorkerVersion(),
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
  // (sw.js cache-name stamping is handled by stampServiceWorkerVersion()
  // above — define{} doesn't touch files in public/. We keep this empty
  // here so any future build-time tokens get their own dedicated comment.)
});
