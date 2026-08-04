import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const rewrites = config.rewrites ?? [];
const apiIndex = rewrites.findIndex(
  (rewrite) => rewrite.source === '/api/:path*' && rewrite.destination === '/api/[...path]',
);
const spaIndex = rewrites.findIndex((rewrite) => rewrite.destination === '/index.html');

assert.ok(apiIndex >= 0, 'vercel.json must route nested /api/:path* requests to the catch-all function');
assert.ok(spaIndex < 0 || apiIndex < spaIndex, 'nested API rewrite must run before the SPA fallback');
assert.ok(
  Number(config.functions?.['api/[...path].js']?.maxDuration) >= 180,
  'the catch-all function must leave enough wall-clock budget for the 120s AGT-002 model timeout plus DB work',
);

console.log('Vercel nested API routing contract OK');
