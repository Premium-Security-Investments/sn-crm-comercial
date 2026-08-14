import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wrapperUrl = new URL('../api/internal/agt002-fixed-snapshot-reanalysis.js', import.meta.url);
let wrapper = '';
try { wrapper = readFileSync(wrapperUrl, 'utf8'); } catch {}
assert.match(wrapper, /export\s*\{\s*default\s*\}\s*from\s*['"]\.\.\/\[\.\.\.path\]\.js['"]/,
  'the exact nested Vercel function must delegate to the parity-reviewed catch-all backend');

const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
assert.equal(vercel.functions?.['api/internal/agt002-fixed-snapshot-reanalysis.js']?.maxDuration, 180,
  'the isolated canary wrapper must retain the operator maximum duration');

console.log('agt002 fixed-canary exact Vercel route passed');
