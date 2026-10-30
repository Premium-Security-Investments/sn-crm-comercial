// AGT-002 — crear a mano un proceso que no está en SECOP (Juan, 2026-10-29). Fija: lo obligatorio y lo opcional; los
// dos espacios de nombres propios (`manual-` y `licitacion_manual:`) que impiden que el Radar y lo manual se pisen; la
// misma llave para el mismo proceso, para que el segundo registro choque en vez de duplicarse; la fecha de cierre como
// fecha de calendario exacta en `raw.deadline`; el enlace saneado; y los argumentos exactos de la RPC de la 165.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TENDER_MANUAL_PROCESS_SECTION,
  isManualTenderExternalSource,
  isManualTenderStableKey,
  manualTenderStableKey,
  normalizeManualTenderProcessInput,
} from '../verticales/licitaciones/tender-manual-process.js';
import { callManualTenderOpportunityCreation } from '../verticales/licitaciones/tender-tracking-rpc.js';

const actorId = '22222222-2222-4222-8222-222222222222';
const ownerId = '33333333-3333-4333-8333-333333333333';

const MINIMAL = { source: 'TVEC', entity: 'Terminal de Transporte', title: 'Vigilancia y seguridad privada' };

function fakeRpcDb(data = { opportunity_id: 'opp-1', tender_id: 'ten-1', stable_key: 'manual-abc' }) {
  const calls = [];
  return { calls, rpc(name, args) { calls.push({ name, args }); return Promise.resolve({ data, error: null }); } };
}

test('la plataforma, la entidad y el objeto son obligatorios; lo demás es opcional', () => {
  for (const field of ['source', 'entity', 'title']) {
    assert.throws(() => normalizeManualTenderProcessInput({ ...MINIMAL, [field]: '  ' }), /Debe indicar/);
  }
  const process = normalizeManualTenderProcessInput(MINIMAL);
  assert.equal(process.ref, null);
  assert.equal(process.url, null);
  assert.equal(process.city, null);
  assert.equal(process.dept, null);
  assert.equal(process.description, null);
  assert.equal(process.value, 0);
  // Sin fecha declarada no hay reloj inventado: ni fecha de cierre, ni vencimiento, ni `raw.deadline`.
  assert.equal(process.closeDate, null);
  assert.equal(process.deadlineAt, null);
  assert.equal(process.raw.deadline, undefined);
  assert.equal(process.section, TENDER_MANUAL_PROCESS_SECTION);
});

test('la llave y el origen externo viven en su propio espacio de nombres', () => {
  const process = normalizeManualTenderProcessInput(MINIMAL);
  assert.ok(isManualTenderStableKey(process.stableKey), process.stableKey);
  assert.ok(isManualTenderExternalSource(process.externalSource), process.externalSource);
  assert.equal(process.externalSource, `licitacion_manual:${process.stableKey}`);
  // Ninguna llave del Radar empieza por `manual-`, así que una corrida no puede pisar la fila.
  assert.ok(!process.stableKey.startsWith('secop_radar:'));
  assert.ok(!process.externalSource.startsWith('secop_radar:'));
});

test('el mismo proceso produce la misma llave, sin importar espacios, tildes ni mayúsculas', () => {
  const first = manualTenderStableKey({ source: 'TVEC', entity: 'Fiscalía General', ref: 'FGN-01', title: 'Vigilancia' });
  const second = manualTenderStableKey({ source: 'tvec', entity: '  FISCALIA   General ', ref: 'fgn-01', title: 'vigilancia' });
  assert.equal(first, second);
  assert.notEqual(first, manualTenderStableKey({ source: 'TVEC', entity: 'Fiscalía General', ref: 'FGN-02', title: 'Vigilancia' }));
});

test('la fecha de cierre viaja como fecha de calendario exacta y como medianoche UTC', () => {
  const process = normalizeManualTenderProcessInput({ ...MINIMAL, close_date: '2026-11-20' });
  assert.equal(process.closeDate, '2026-11-20');
  assert.equal(process.deadlineAt, '2026-11-20T00:00:00.000Z');
  // Es `raw.deadline` quien manda en resolveCanonicalTenderDeadline: sin ella el reloj se corre un día en Bogotá.
  assert.equal(process.raw.deadline, '2026-11-20');
  assert.throws(() => normalizeManualTenderProcessInput({ ...MINIMAL, close_date: '20/11/2026' }), /fecha de calendario/);
  assert.throws(() => normalizeManualTenderProcessInput({ ...MINIMAL, close_date: '2026-02-31' }), /fecha de calendario/);
});

test('el enlace sólo puede ser http(s) con host', () => {
  const process = normalizeManualTenderProcessInput({ ...MINIMAL, url: 'https://portal.entidad.gov.co/proceso/1' });
  assert.equal(process.url, 'https://portal.entidad.gov.co/proceso/1');
  assert.throws(() => normalizeManualTenderProcessInput({ ...MINIMAL, url: 'javascript:alert(1)' }), /http/);
  assert.throws(() => normalizeManualTenderProcessInput({ ...MINIMAL, url: '/proceso/1' }), /dirección válida/);
});

test('el valor admite separadores y nunca es negativo', () => {
  assert.equal(normalizeManualTenderProcessInput({ ...MINIMAL, value: '1.200.000.000' }).value, 1200000000);
  assert.equal(normalizeManualTenderProcessInput({ ...MINIMAL, value: '' }).value, 0);
  assert.equal(normalizeManualTenderProcessInput({ ...MINIMAL, value: '1 200 000' }).value, 1200000);
  assert.throws(() => normalizeManualTenderProcessInput({ ...MINIMAL, value: '-5' }), /sólo números/);
  assert.throws(() => normalizeManualTenderProcessInput({ ...MINIMAL, value: 'mil millones' }), /sólo números/);
});

test('las observaciones dejan dicho que el proceso se creó a mano', () => {
  const process = normalizeManualTenderProcessInput({ ...MINIMAL, ref: 'TT-004-2026', city: 'Pereira', close_date: '2026-11-20' });
  assert.match(process.observaciones, /creado a mano en el CRM/);
  assert.match(process.observaciones, /Referencia: TT-004-2026/);
  assert.match(process.observaciones, /Cierre declarado: 2026-11-20/);
  assert.match(normalizeManualTenderProcessInput(MINIMAL).observaciones, /Cierre declarado: sin fecha/);
});

await test('la RPC recibe el actor, el responsable y los campos ya normalizados', async () => {
  const db = fakeRpcDb();
  const created = await callManualTenderOpportunityCreation(db, { ...MINIMAL, owner_id: ownerId, close_date: '2026-11-20', value: '500000' }, { id: actorId });
  assert.deepEqual(created, { opportunity_id: 'opp-1', tender_id: 'ten-1', stable_key: 'manual-abc' });
  assert.equal(db.calls.length, 1);
  const { name, args } = db.calls[0];
  assert.equal(name, 'psi_create_manual_tender_opportunity');
  assert.equal(args.p_actor_id, actorId);
  assert.equal(args.p_owner_id, ownerId);
  assert.equal(args.p_section, TENDER_MANUAL_PROCESS_SECTION);
  assert.equal(args.p_entity, MINIMAL.entity);
  assert.equal(args.p_title, MINIMAL.title);
  assert.equal(args.p_value, 500000);
  assert.equal(args.p_deadline_at, '2026-11-20T00:00:00.000Z');
  assert.equal(args.p_expected_close_date, '2026-11-20');
  assert.ok(args.p_stable_key.startsWith('manual-'));
  assert.equal(args.p_external_source, `licitacion_manual:${args.p_stable_key}`);
  assert.equal(args.p_raw.manual_entry, true);
});

await test('sin responsable declarado el proceso queda a nombre de quien lo registra', async () => {
  const db = fakeRpcDb();
  await callManualTenderOpportunityCreation(db, MINIMAL, { id: actorId });
  assert.equal(db.calls[0].args.p_owner_id, actorId);
});

await test('un actor o un responsable sin identificador válido no llega a la base', async () => {
  const db = fakeRpcDb();
  await assert.rejects(() => callManualTenderOpportunityCreation(db, MINIMAL, { id: 'no-es-uuid' }), /actor válido/);
  await assert.rejects(() => callManualTenderOpportunityCreation(db, { ...MINIMAL, owner_id: 'no-es-uuid' }, { id: actorId }), /responsable válido/);
  assert.equal(db.calls.length, 0);
});
