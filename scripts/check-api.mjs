// scripts/check-api.mjs
//
// Parse-checks every .js / .mjs / .cjs file under api/.
//
// Why this exists: `vite build` only sees src/. Vercel serverless functions
// in api/ never go through the bundler, so a syntax error like the stray "h"
// after `function handler(req, res) {h` ships to production and crashes the
// lambda on cold start with FUNCTION_INVOCATION_FAILED. This script runs
// `node --check` on each file so pre-push catches that class of bug locally.

import { readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'api');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules') continue;
      out.push(...walk(full));
    } else if (['.js', '.mjs', '.cjs'].includes(extname(name))) {
      out.push(full);
    }
  }
  return out;
}

let files;
try {
  files = walk(apiDir);
} catch (e) {
  if (e.code === 'ENOENT') { console.log('No api/ directory — skipping.'); process.exit(0); }
  throw e;
}

let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`\n✗ ${f}`);
    if (r.stderr) process.stderr.write(r.stderr);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} file(s) failed syntax check.`);
  process.exit(1);
}
console.log(`✓ ${files.length} api file(s) parsed cleanly.`);
