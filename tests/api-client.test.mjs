import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transformSync } from 'esbuild';

const outDir = mkdtempSync(join(tmpdir(), 'siio-api-client-'));
const outPath = join(outDir, 'apiClient.mjs');
writeFileSync(outPath, transformSync(readFileSync('src/apiClient.ts', 'utf8'), { loader: 'ts', format: 'esm', target: 'es2020' }).code);
const { api, setApiAccessToken } = await import(`file://${outPath}`);

const originalFetch = globalThis.fetch;
try {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  setApiAccessToken('access-token');
  assert.deepEqual(await api('/api/siio/bootstrap'), { ok: true });
  assert.equal(request.url, '/api/siio/bootstrap');
  assert.equal(request.options.headers.Authorization, 'Bearer access-token');
  assert.equal(request.options.headers['Content-Type'], 'application/json');

  setApiAccessToken(null);
  await api('/api/bootstrap', { headers: { 'X-Request-ID': 'trace-1' } });
  assert.equal(request.options.headers.Authorization, undefined);
  assert.equal(request.options.headers['X-Request-ID'], 'trace-1');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('SIIO API client authorization contract OK');
