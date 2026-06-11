import fs from 'node:fs';
import assert from 'node:assert/strict';

const vite = fs.readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
assert.ok(vite.includes("envPrefix: ['VITE_', 'NEXT_PUBLIC_']"), 'Vite must expose NEXT_PUBLIC_* env vars to the client bundle.');
assert.ok(vite.includes('NEXT_PUBLIC_SUPABASE_URL'), 'Vite config must map Supabase URL.');
assert.ok(vite.includes('NEXT_PUBLIC_SUPABASE_ANON_KEY'), 'Vite config must map Supabase anon key.');

console.log('vite env static checks passed');
