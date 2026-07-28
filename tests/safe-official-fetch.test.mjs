import { strict as assert } from 'node:assert';
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

console.log('safe official fetch SSRF policy passed');
