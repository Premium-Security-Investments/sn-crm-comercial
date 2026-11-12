// La carpeta del proceso de la Mesa (Juan, 2026-11-12: «Mesa y Vig-IA deben ser iguales a usted»): el contrato, el
// cliente de Claude que la escribe y la borra, el puente que la deja pasar, el armador desde la base y la Mesa que la usa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validarAgt002Carpeta, AGT002_CARPETA_MAX_BYTES } from '../agt002-mesa-carpeta-contrato.js';
import { createAgt002ClaudeClient } from '../agt002-claude-client.js';
import { createAgt002BridgeServer } from '../agt002-hetzner-bridge-server.js';
import { sha256Hex, buildCanonicalString, signCanonicalString } from '../agt002-hetzner-bridge-signing.js';
import { armarAgt002CarpetaDelProceso, AGT002_CARPETA_POLICY, AGT002_SIN_HERRAMIENTAS, AGT002_SOLO_LECTURA_DE_LA_CARPETA } from '../verticales/licitaciones/agt002-mesa-carpeta.js';
import { createAgt002WorkbenchResponder } from '../verticales/licitaciones/agt002-workbench-responder.js';
import { AGT002_WORKBENCH_CAPABILITIES } from '../verticales/licitaciones/agt002-workbench-contract.js';

const CARPETA = { archivos: [{ ruta: '00_INDICE.md', texto: 'índice' }, { ruta: '02_respuestas/Respuestas.txt', texto: 'NO SE ACOGE la agencia.' }] };

test('el contrato sólo deja pasar rutas relativas, sin «..», sin repetir y dentro del tamaño', () => {
  assert.equal(validarAgt002Carpeta(CARPETA).length, 2);
  for (const ruta of ['../fuera.txt', '/etc/passwd', '.oculto', 'a/../b.txt', 'a/b/c/d.txt', '01/~x.txt', '']) {
    assert.throws(() => validarAgt002Carpeta({ archivos: [{ ruta, texto: 'x' }] }), /no es válida/, ruta);
  }
  assert.throws(() => validarAgt002Carpeta({ archivos: [{ ruta: 'A.txt', texto: 'x' }, { ruta: 'a.txt', texto: 'y' }] }), /repetida/);
  assert.throws(() => validarAgt002Carpeta({ archivos: [{ ruta: 'a.txt', texto: 'x'.repeat(AGT002_CARPETA_MAX_BYTES + 1) }] }), /tamaño/);
  assert.throws(() => validarAgt002Carpeta({ archivos: [], extra: 1 }), /no es válida/);
});

function fakeChild() {
  const child = new EventEmitter();
  child.stdin = { write() { return true; }, end() {}, on() {}, destroy() {} };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => { child.killed = true; return true; };
  return child;
}

const SCHEMA = { type: 'object', additionalProperties: false, required: ['summary'], properties: { summary: { type: 'string' } } };
const OK = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, structured_output: { summary: 'ok' }, usage: { input_tokens: 1, output_tokens: 1 } });

test('con carpeta, el turno corre dentro de ella con buscar, leer y listar, y la carpeta se borra al terminar', async () => {
  const raiz = mkdtempSync(join(tmpdir(), 'carpetas-'));
  try {
    let visto = null;
    const spawn = (command, args, options) => {
      const child = fakeChild();
      visto = { args, cwd: options.cwd, respuestas: readFileSync(join(options.cwd, '02_respuestas/Respuestas.txt'), 'utf8') };
      setImmediate(() => { child.stdout.emit('data', Buffer.from(OK)); child.emit('exit', 0, null); });
      return child;
    };
    const client = createAgt002ClaudeClient({ spawn, cwd: '/opt/fijo', carpetasRoot: raiz });
    await client.run({ model: 'sonnet', policy: 'p', input: { a: 1 }, outputSchema: SCHEMA, timeoutMs: 5000, carpeta: CARPETA });
    assert.equal(visto.respuestas, 'NO SE ACOGE la agencia.');
    assert.ok(visto.cwd.startsWith(raiz));
    assert.equal(visto.args[visto.args.indexOf('--tools') + 1], 'Read,Grep,Glob');
    assert.equal(existsSync(visto.cwd), false, 'la carpeta se borra al terminar el turno');
  } finally { rmSync(raiz, { recursive: true, force: true }); }
});

test('sin carpeta nada cambia: sin herramientas y en el cwd fijo; con carpeta y sin raíz configurada, se rechaza', async () => {
  let visto = null;
  const spawn = (command, args, options) => {
    const child = fakeChild();
    visto = { args, cwd: options.cwd };
    setImmediate(() => { child.stdout.emit('data', Buffer.from(OK)); child.emit('exit', 0, null); });
    return child;
  };
  const client = createAgt002ClaudeClient({ spawn, cwd: '/opt/fijo' });
  await client.run({ model: 'sonnet', policy: 'p', input: { a: 1 }, outputSchema: SCHEMA, timeoutMs: 5000 });
  assert.equal(visto.cwd, '/opt/fijo');
  assert.equal(visto.args[visto.args.indexOf('--tools') + 1], '');
  visto = null;
  await assert.rejects(() => client.run({ model: 'sonnet', policy: 'p', input: { a: 1 }, outputSchema: SCHEMA, timeoutMs: 5000, carpeta: CARPETA }));
  assert.equal(visto, null, 'no se invoca el modelo');
});

const SECRET = 'a'.repeat(32);
function firmado(body) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = `n${Math.random().toString(36).slice(2).padEnd(16, 'x')}`;
  const canonical = buildCanonicalString({ method: 'POST', path: '/v1/agt002-preview/run', bodySha256Hex: sha256Hex(body), timestamp, nonce });
  return { 'content-type': 'application/json', 'x-agt002-timestamp': timestamp, 'x-agt002-nonce': nonce, 'x-agt002-signature': signCanonicalString(SECRET, canonical) };
}

test('el puente pasa una carpeta válida al cliente y rechaza una inválida sin invocarlo', async () => {
  const recibidas = [];
  const codexClient = { run: async args => { recibidas.push(args); return { content: '{"summary":"ok"}', usage: { input_tokens: 1, output_tokens: 1 }, rate_limit: null }; } };
  const server = createServer(createAgt002BridgeServer({ hmacSecret: SECRET, codexClient }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/v1/agt002-preview/run`;
  try {
    const base = { model: 'sonnet', policy: 'p', input: { a: 1 }, outputSchema: SCHEMA, timeoutMs: 5000, idempotencyKey: 'k' };
    const bueno = JSON.stringify({ ...base, carpeta: CARPETA });
    assert.equal((await fetch(url, { method: 'POST', headers: firmado(bueno), body: bueno })).status, 200);
    assert.deepEqual(recibidas[0].carpeta, CARPETA);
    const malo = JSON.stringify({ ...base, carpeta: { archivos: [{ ruta: '../x', texto: 'y' }] } });
    assert.equal((await fetch(url, { method: 'POST', headers: firmado(malo), body: malo })).status, 400);
    assert.equal(recibidas.length, 1);
    const sin = JSON.stringify(base);
    assert.equal((await fetch(url, { method: 'POST', headers: firmado(sin), body: sin })).status, 200);
    assert.equal(Object.hasOwn(recibidas[1], 'carpeta'), false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

function baseDeDatos(versiones, extracciones = []) {
  const consulta = filas => {
    const q = { select: () => q, eq: () => q, order: () => q, in: () => Promise.resolve({ data: extracciones, error: null }), then: (ok, ko) => Promise.resolve({ data: filas, error: null }).then(ok, ko) };
    return q;
  };
  return { from: tabla => consulta(tabla === 'psi_tender_document_versions' ? versiones : extracciones) };
}

test('el armador ordena por lo que es cada documento, pone el índice primero y usa la extracción canónica', async () => {
  const versiones = [
    { id: 'v1', name: 'Pliego de Condiciones Definitivo.pdf', document_type: 'pliego', origin: 'entidad', created_at: '2026-11-12T13:12:00Z', extracted_text: 'texto legado' },
    { id: 'v2', name: 'Respuesta Observaciones LP-07-2026.pdf', document_type: 'otro', origin: 'entidad', created_at: '2026-11-12T13:20:00Z', extracted_text: 'NO SE ACOGE' },
    { id: 'v3', name: 'Carta de otro proponente.pdf', document_type: 'otro', origin: 'tercero', created_at: '2026-11-12T13:20:00Z', extracted_text: 'carta' },
    { id: 'v4', name: 'Anexo técnico.pdf', document_type: 'anexo_tecnico', origin: 'entidad', created_at: '2026-11-12T13:20:00Z', extracted_text: '' },
  ];
  const canonico = 'texto canónico';
  const extracciones = [{ id: 'e1', document_version_id: 'v1', extractor_version: 'x', status: 'ok', extracted_text: canonico, text_hash: createHash('sha256').update(canonico, 'utf8').digest('hex'), char_count: [...canonico].length, created_at: '2026-11-12T13:13:00Z' }];
  const carpeta = await armarAgt002CarpetaDelProceso(baseDeDatos(versiones, extracciones), { tenderId: 't1' });
  const rutas = carpeta.archivos.map(archivo => archivo.ruta);
  assert.equal(rutas[0], '00_INDICE.md');
  assert.ok(rutas.includes('01_reglas_pliego_y_adendas/Pliego de Condiciones Definitivo.txt'));
  assert.ok(rutas.includes('02_respuestas_actas_e_informes/Respuesta Observaciones LP-07-2026.txt'));
  assert.ok(rutas.includes('06_terceros/Carta de otro proponente.txt'));
  assert.equal(rutas.some(ruta => ruta.includes('Anexo')), false, 'un documento sin texto no entra');
  assert.match(carpeta.archivos.find(a => a.ruta.startsWith('01_')).texto, /texto canónico/);
  assert.match(carpeta.archivos[0].texto, /Respuesta Observaciones LP-07-2026\.pdf/);
  assert.equal(validarAgt002Carpeta(carpeta).length, 4);
  assert.equal(await armarAgt002CarpetaDelProceso(baseDeDatos([]), { tenderId: 't1' }), null);
});

function responder({ armarCarpeta, llamadas }) {
  return createAgt002WorkbenchResponder({
    client: { run: async args => { llamadas.push(args); return { content: JSON.stringify({ answer: 'ok', source_links: [], missing_information: [] }), usage: { input_tokens: 1, output_tokens: 1 } }; } },
    model: 'sonnet', timeoutMs: 30_000, draftTimeoutMs: 90_000, armarCarpeta,
  });
}

const PREGUNTA = { job_id: 'j1', tender_id: 't1', capability_id: AGT002_WORKBENCH_CAPABILITIES.reply, message: '¿Basta un integrante con sucursal en Bogotá?', context_links: [] };

test('la Mesa manda la carpeta con su política y el tope largo; si la carpeta falla, responde como siempre', async () => {
  const llamadas = [];
  await responder({ armarCarpeta: async () => CARPETA, llamadas }).respond(PREGUNTA).catch(() => {});
  assert.deepEqual(llamadas[0].carpeta, CARPETA);
  assert.ok(llamadas[0].policy.includes(AGT002_CARPETA_POLICY));
  assert.equal(llamadas[0].timeoutMs, 85_000);
  // DEAJ, 12-nov: con la prohibición de herramientas intacta, el modelo no buscó y repitió el fragmento cortado.
  assert.equal(llamadas[0].policy.includes(AGT002_SIN_HERRAMIENTAS), false);
  assert.ok(llamadas[0].policy.includes(AGT002_SOLO_LECTURA_DE_LA_CARPETA));

  const sinCarpeta = [];
  await responder({ armarCarpeta: async () => { throw new Error('base caída'); }, llamadas: sinCarpeta }).respond(PREGUNTA).catch(() => {});
  assert.equal(Object.hasOwn(sinCarpeta[0], 'carpeta'), false);
  assert.equal(sinCarpeta[0].policy.includes(AGT002_CARPETA_POLICY), false);
  assert.ok(sinCarpeta[0].policy.includes(AGT002_SIN_HERRAMIENTAS), 'sin carpeta sigue prohibido usar herramientas');
});
