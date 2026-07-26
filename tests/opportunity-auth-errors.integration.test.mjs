import { strict as assert } from 'node:assert';
import http from 'node:http';
import { readFileSync } from 'node:fs';

const OPPORTUNITY_ID = '11111111-1111-4111-8111-111111111111';

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

function requestJson(port, path) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
    });
    request.on('error', reject);
    request.end();
  });
}

const observed = { supabaseRequests: 0 };
const fakeSupabase = http.createServer((_req, res) => {
  observed.supabaseRequests += 1;
  json(res, 500, { message: 'No request should reach Supabase without authentication.' });
});

const originalEnv = Object.fromEntries(
  ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL'].map(key => [key, process.env[key]])
);
const fakePort = await listen(fakeSupabase);
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${fakePort}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.VERCEL = '1';

let appServer;
const originalConsoleError = console.error;
try {
  console.error = () => {};
  const { default: app } = await import('../server/index.js');
  appServer = http.createServer(app);
  const appPort = await listen(appServer);

  for (const path of [
    `/api/opportunities/${OPPORTUNITY_ID}`,
    `/api/opportunity-detail?id=${OPPORTUNITY_ID}`,
  ]) {
    const response = await requestJson(appPort, path);
    assert.equal(response.status, 401, `${path} must return 401 without a session`);
    assert.deepEqual(response.body, { error: 'Debe iniciar sesión.' });
  }

  assert.equal(observed.supabaseRequests, 0, 'authentication must fail before any Supabase request');

  for (const backendPath of ['../server/index.js', '../api/[...path].js']) {
    const source = readFileSync(new URL(backendPath, import.meta.url), 'utf8');
    const nested = source.match(/app\.get\('\/api\/opportunities\/:id'[\s\S]*?\n}\);/);
    const alias = source.match(/app\.get\('\/api\/opportunity-detail'[\s\S]*?\n}\);/);
    assert.ok(nested, `${backendPath} must retain the nested opportunity detail route`);
    assert.ok(alias, `${backendPath} must retain the Vercel-safe opportunity detail alias`);
    assert.match(nested[0], /catch \(error\) \{ sendAuthError\(res, error\); \}/);
    assert.match(alias[0], /catch \(error\) \{ sendAuthError\(res, error\); \}/);
  }
} finally {
  console.error = originalConsoleError;
  if (appServer?.listening) await new Promise(resolve => appServer.close(resolve));
  await new Promise(resolve => fakeSupabase.close(resolve));
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log('opportunity detail authentication errors are controlled and fail before database access');
