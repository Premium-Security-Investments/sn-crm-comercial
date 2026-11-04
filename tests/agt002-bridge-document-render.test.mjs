import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { createAgt002BridgeServer } from '../agt002-hetzner-bridge-server.js';
import { createAgt002HetznerBridgeClient } from '../verticales/licitaciones/agt002-hetzner-bridge-client.js';
import { Agt002DocumentError, renderAgt002Docx } from '../verticales/licitaciones/agt002-document-render.js';

const secret = 'x'.repeat(40);
const codexClient = { run: async () => { throw new Error('no se usa'); } };
const documento = { title: 'Carta', blocks: [{ kind: 'paragraph', text: 'Vigencia de [[90 días]].' }] };

async function withBridge(documentRenderer, fn) {
  const server = createServer(createAgt002BridgeServer({ hmacSecret: secret, codexClient, documentRenderer }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/v1/agt002-preview/run`;
  try { return await fn(base); } finally { await new Promise(resolve => server.close(resolve)); }
}

test('el cliente firmado recibe el Word del puente y comprueba su sha256', async () => {
  await withBridge(document => renderAgt002Docx(document), async base => {
    const client = createAgt002HetznerBridgeClient({ url: base, hmacSecret: secret });
    const { bytes, sha256 } = await client.renderDocument({ document: documento });
    assert.equal(bytes.subarray(0, 2).toString('latin1'), 'PK');
    assert.match(sha256, /^[0-9a-f]{64}$/);
  });
});

test('sin firma o con un documento inválido, el puente no arma nada', async () => {
  let calls = 0;
  const renderer = async document => {
    calls += 1;
    if (document.title === 'malo') throw new Agt002DocumentError('AGT002_DOCUMENT_INVALID', 'x');
    return Buffer.from('PK' + 'x'.repeat(2000));
  };
  await withBridge(renderer, async base => {
    const url = new URL('/v1/agt002/document/render', base).toString();
    const unsigned = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ document: documento }) });
    assert.equal(unsigned.status, 401);
    assert.equal(calls, 0);

    const client = createAgt002HetznerBridgeClient({ url: base, hmacSecret: secret });
    await assert.rejects(client.renderDocument({ document: { title: 'malo', blocks: [] } }), error => error.code === 'AGT002_BRIDGE_DOCUMENT_INVALID');
  });
});

test('un cuerpo firmado con algo más que el documento se rechaza', async () => {
  let calls = 0;
  await withBridge(async () => { calls += 1; return Buffer.from('PK'); }, async base => {
    const { sha256Hex, buildCanonicalString, signCanonicalString } = await import('../agt002-hetzner-bridge-signing.js');
    const body = JSON.stringify({ document: documento, template: '/etc/passwd' });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = 'n-' + Math.random();
    const signature = signCanonicalString(secret, buildCanonicalString({ method: 'POST', path: '/v1/agt002/document/render', bodySha256Hex: sha256Hex(body), timestamp, nonce }));
    const response = await fetch(new URL('/v1/agt002/document/render', base), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AGT002-Timestamp': timestamp, 'X-AGT002-Nonce': nonce, 'X-AGT002-Signature': signature }, body });
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
  });
});

test('sin renderizador configurado, 503 y no un fallo', async () => {
  await withBridge(null, async base => {
    const client = createAgt002HetznerBridgeClient({ url: base, hmacSecret: secret });
    await assert.rejects(client.renderDocument({ document: documento }), error => error.code === 'AGT002_BRIDGE_DOCUMENT_UNAVAILABLE');
  });
});
