import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { responseRemoteAddress, safeOfficialFetch, validateOfficialHttpsUrl } from '../safe-official-fetch.js';

assert.equal(responseRemoteAddress({ socket: { remoteAddress: '1.1.1.1' } }, { address: '8.8.8.8' }), '1.1.1.1');
assert.equal(responseRemoteAddress({ socket: null }, { address: '8.8.8.8' }), '8.8.8.8', 'closed response sockets must use the DNS-validated pinned target');

const esu = { allowedHosts: ['esucontratacion.com', 'www.esucontratacion.com'], allowedPath: /^\/procesos\/(?:view|descargar)\/\d+/ };
assert.equal(validateOfficialHttpsUrl('https://esucontratacion.com/procesos/view/123', esu).hostname, 'esucontratacion.com');
for (const unsafe of [
  'http://esucontratacion.com/procesos/view/1',
  'https://user:pass@esucontratacion.com/procesos/view/1',
  'https://esucontratacion.com:8443/procesos/view/1',
  'https://evil.test/procesos/descargar/1',
  'https://esucontratacion.com/admin/1',
]) assert.throws(() => validateOfficialHttpsUrl(unsafe, esu));

const publicLookup = async () => [{ address: '1.1.1.1', family: 4 }];
let requests = 0;
await assert.rejects(() => safeOfficialFetch('https://esucontratacion.com/procesos/view/1', esu, {
  lookup: async () => [{ address: '127.0.0.1', family: 4 }],
  request: async () => { requests += 1; return {}; },
}), /direcciones públicas/);
assert.equal(requests, 0, 'DNS privado debe bloquearse antes de abrir socket');

await assert.rejects(() => safeOfficialFetch('https://esucontratacion.com/procesos/view/1', esu, {
  lookup: publicLookup,
  request: async () => ({ status: 302, headers: { location: 'https://127.0.0.1/procesos/descargar/2' }, body: Buffer.alloc(0), remoteAddress: '1.1.1.1' }),
}), /Host oficial no permitido/);

const seen = [];
const response = await safeOfficialFetch('https://esucontratacion.com/procesos/view/1', esu, {
  lookup: publicLookup,
  request: async target => {
    seen.push(target.url.pathname);
    return seen.length === 1
      ? { status: 302, headers: { location: '/procesos/descargar/2' }, body: Buffer.alloc(0), remoteAddress: '1.1.1.1' }
      : { status: 200, headers: {}, body: Buffer.from('ok'), remoteAddress: '1.1.1.1' };
  },
});
assert.deepEqual(seen, ['/procesos/view/1', '/procesos/descargar/2']);
assert.equal(await response.text(), 'ok');

// pinnedHttpsRequest is not exported, so these drive it indirectly through
// safeOfficialFetch by monkey-patching node:https' shared `request` export.
// No network is touched: the fake request/response satisfy the module's own
// pinning checks (a 'socket' event followed by 'secureConnect', and a public
// response.socket.remoteAddress) entirely in-process.
function mockHttpsRequest({ status = 200, headers = {}, body = Buffer.from('ok') } = {}) {
  const calls = [];
  return {
    calls,
    impl(url, opts, callback) {
      const request = new EventEmitter();
      const written = [];
      request.setTimeout = () => request;
      request.destroy = () => {};
      request.write = chunk => { written.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))); return true; };
      request.end = () => {
        calls.push({ url, options: opts, body: Buffer.concat(written) });
        const socket = new EventEmitter();
        socket.remoteAddress = '1.1.1.1';
        request.emit('socket', socket);
        socket.emit('secureConnect');
        const response = new EventEmitter();
        response.statusCode = status;
        response.headers = headers;
        response.socket = socket;
        callback(response);
        response.emit('data', body);
        response.emit('end');
      };
      return request;
    },
  };
}

function findHeader(headers, name) {
  const key = Object.keys(headers || {}).find(k => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : headers[key];
}

async function capturePinnedRequest(requestOptions) {
  const mock = mockHttpsRequest();
  const originalRequest = https.request;
  https.request = mock.impl;
  try {
    await safeOfficialFetch('https://esucontratacion.com/procesos/view/1', esu, {
      lookup: publicLookup,
      ...requestOptions,
    });
  } finally {
    https.request = originalRequest;
  }
  assert.equal(mock.calls.length, 1, 'expected exactly one pinned HTTPS request');
  return mock.calls[0];
}

{
  const body = 'héllo世界';
  const expectedBytes = Buffer.byteLength(body, 'utf8');
  assert.notEqual(expectedBytes, body.length, 'test body must contain multibyte UTF-8 characters');
  const call = await capturePinnedRequest({ method: 'POST', body, headers: {} });
  assert.equal(findHeader(call.options.headers, 'Content-Length'), String(expectedBytes),
    'pinnedHttpsRequest must set Content-Length to the exact byte length written, including multibyte UTF-8 bodies');
}

{
  const call = await capturePinnedRequest({ method: 'POST', body: 'abc', headers: { 'content-length': '999' } });
  assert.equal(findHeader(call.options.headers, 'Content-Length'), '999',
    'a caller-supplied Content-Length must be preserved case-insensitively, not recalculated');
}

{
  const call = await capturePinnedRequest({ method: 'POST', body: 'abc', headers: { 'Content-Length': '999' } });
  assert.equal(findHeader(call.options.headers, 'Content-Length'), '999',
    'a caller-supplied Content-Length must be preserved regardless of header key casing');
}

{
  const call = await capturePinnedRequest({ method: 'POST', body: 'abc', headers: { 'transfer-encoding': 'chunked' } });
  assert.equal(findHeader(call.options.headers, 'Transfer-Encoding'), 'chunked');
  assert.equal(findHeader(call.options.headers, 'Content-Length'), undefined,
    'no Content-Length must be added when the caller supplies Transfer-Encoding');
}

{
  const call = await capturePinnedRequest({ method: 'POST', body: 'abc', headers: { 'Transfer-Encoding': 'chunked' } });
  assert.equal(findHeader(call.options.headers, 'Transfer-Encoding'), 'chunked');
  assert.equal(findHeader(call.options.headers, 'Content-Length'), undefined,
    'no Content-Length must be added when the caller supplies Transfer-Encoding, regardless of header key casing');
}

{
  const call = await capturePinnedRequest({ method: 'GET' });
  assert.equal(findHeader(call.options.headers, 'Content-Length'), undefined,
    'GET requests with no body must not gain a Content-Length header');
}

console.log('pinnedHttpsRequest Content-Length regression coverage passed');

console.log('safe official fetch SSRF policy passed');
