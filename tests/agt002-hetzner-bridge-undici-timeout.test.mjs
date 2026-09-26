import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sourcePath = fileURLToPath(new URL('../agt002-hetzner-bridge-client.js', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');

test('imports Agent and fetch as undiciFetch from undici', () => {
  assert.match(source, /import\s*\{\s*Agent\s*,\s*fetch\s+as\s+undiciFetch\s*\}\s*from\s*['"]undici['"]/);
});

test('configures a per-call dispatcher with a headersTimeout/bodyTimeout margin over timeoutMs', () => {
  assert.match(source, /headersTimeout:\s*timeoutMs\s*\+\s*30_000/);
  assert.match(source, /bodyTimeout:\s*timeoutMs\s*\+\s*30_000/);
});

test('uses undiciFetch only when fetchImpl is the global fetch, otherwise still calls fetchImpl', () => {
  assert.match(source, /fetchImpl\s*===\s*fetch/);
  assert.match(source, /undiciFetch\s*\(/);
  assert.match(source, /fetchImpl\s*\(\s*url\s*,\s*fetchOptions\s*\)/);
});
