// Acta de cierre: la capa HTTP. Sanea lo que entra, exige la versión del acta
// al confirmar y al reabrir, y traduce los códigos de Postgres a HTTP.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { callConfirmTenderClosureActa, callReopenTenderClosureActa, callUpsertTenderClosureActa, getTenderClosureActa, MAX_REASONS } from '../tender-closure-acta-rpc.js';

const JUAN = { id: '11111111-1111-4111-8111-111111111111', role: 'gerencia', identity_type: 'human', active: true, permissions: ['licitaciones'] };
const COMERCIAL = { ...JUAN, id: '33333333-3333-4333-8333-333333333333', role: 'comercial' };
const CONSULTA = { ...JUAN, id: '44444444-4444-4444-8444-444444444444', role: 'consulta' };
const OPPORTUNITY = '55555555-5555-4555-8555-555555555555';

function fakeDatabase({ rpcResult = { acta: { id: 'acta-1' } }, rpcError = null, opportunity = { archived_at: null, tender_offer_status: 'cerrada_no_go' } } = {}) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) { calls.push({ name, args }); return { data: rpcError ? null : rpcResult, error: rpcError }; },
    from() {
      return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: opportunity, error: null }; } };
    },
  };
}

test('el GET dice cómo se cerró la licitación, porque la ficha no trae archived_at', async () => {
  const archivada = fakeDatabase({ rpcResult: null, opportunity: { archived_at: '2026-10-18T01:58:03Z', tender_offer_status: 'en_preparacion' } });
  assert.deepEqual(await getTenderClosureActa(archivada, OPPORTUNITY, JUAN), { closure_kind: 'archivada', acta: null });

  const noGo = fakeDatabase({ rpcResult: null, opportunity: { archived_at: null, tender_offer_status: 'cerrada_no_go' } });
  assert.deepEqual(await getTenderClosureActa(noGo, OPPORTUNITY, JUAN), { closure_kind: 'cerrada_no_go', acta: null });

  const abierta = fakeDatabase({ rpcResult: null, opportunity: { archived_at: null, tender_offer_status: 'en_preparacion' } });
  assert.deepEqual(await getTenderClosureActa(abierta, OPPORTUNITY, JUAN), { closure_kind: null, acta: null });
});

test('el acta se lee en consulta pero sólo la redacta quien aprueba el GO', async () => {
  await assert.doesNotReject(() => getTenderClosureActa(fakeDatabase(), OPPORTUNITY, CONSULTA));
  await assert.rejects(() => callUpsertTenderClosureActa(fakeDatabase(), { opportunity_id: OPPORTUNITY }, COMERCIAL), /No tiene autorización/);
  await assert.rejects(() => callUpsertTenderClosureActa(fakeDatabase(), { opportunity_id: OPPORTUNITY }, CONSULTA), /No tiene autorización/);
  await assert.rejects(() => callConfirmTenderClosureActa(fakeDatabase(), { opportunity_id: OPPORTUNITY, expected_updated_at: '2026-10-19T16:00:00Z' }, COMERCIAL), /No tiene autorización/);
});

test('la nota de cierre no se pide otra vez: si no se manda, no se toca', async () => {
  const database = fakeDatabase();
  await callUpsertTenderClosureActa(database, { opportunity_id: OPPORTUNITY, decision_summary: 'Es de tecnología.' }, JUAN);
  const { args } = database.calls[0];
  assert.equal(args.p_payload.closing_note, null, 'null deja la nota como está; la RPC no la sobreescribe');
  assert.equal(args.p_expected_updated_at, null, 'sin versión, es un acta nueva');
  assert.deepEqual(args.p_payload.requirements_unmet, []);
});

test('los motivos se recortan, se quitan los repetidos y se limita cuántos caben', async () => {
  const database = fakeDatabase();
  await callUpsertTenderClosureActa(database, {
    opportunity_id: OPPORTUNITY,
    reasons: ['  Es de tecnología y no de vigilancia  ', 'Es de tecnología y no de vigilancia', '', '   ', 'x'.repeat(200)],
  }, JUAN);
  const reasons = database.calls[0].args.p_payload.reasons;
  assert.deepEqual(reasons, ['Es de tecnología y no de vigilancia', 'x'.repeat(120)]);
  await assert.rejects(
    () => callUpsertTenderClosureActa(fakeDatabase(), { opportunity_id: OPPORTUNITY, reasons: Array.from({ length: MAX_REASONS + 1 }, (_, index) => `motivo ${index}`) }, JUAN),
    /no puede tener más de/,
  );
});

test('las secciones del acta sólo aceptan listas de objetos', async () => {
  await assert.rejects(() => callUpsertTenderClosureActa(fakeDatabase(), { opportunity_id: OPPORTUNITY, requirements_unmet: 'texto' }, JUAN), /debe ser una lista/);
  await assert.rejects(() => callUpsertTenderClosureActa(fakeDatabase(), { opportunity_id: OPPORTUNITY, factors_against: ['texto'] }, JUAN), /debe ser un objeto/);
  await assert.rejects(() => callUpsertTenderClosureActa(fakeDatabase(), { opportunity_id: OPPORTUNITY, reasons: 'uno' }, JUAN), /lista/);
});

test('confirmar y reabrir exigen la versión que la persona está viendo', async () => {
  await assert.rejects(() => callConfirmTenderClosureActa(fakeDatabase(), { opportunity_id: OPPORTUNITY }, JUAN), /Debe indicar la versión/);
  await assert.rejects(() => callReopenTenderClosureActa(fakeDatabase(), { opportunity_id: OPPORTUNITY }, JUAN), /Debe indicar la versión/);
  await assert.rejects(() => callConfirmTenderClosureActa(fakeDatabase(), { opportunity_id: OPPORTUNITY, expected_updated_at: 'ayer' }, JUAN), /no es válida/);
  const database = fakeDatabase();
  await callConfirmTenderClosureActa(database, { opportunity_id: OPPORTUNITY, expected_updated_at: '2026-10-19T16:00:00.000Z' }, JUAN);
  assert.equal(database.calls[0].name, 'psi_confirm_tender_closure_acta');
  assert.equal(database.calls[0].args.p_expected_updated_at, '2026-10-19T16:00:00.000Z');
});

test('los errores de la base llegan con el estado HTTP que les corresponde', async () => {
  const codes = { 42501: 403, 40001: 409, 23514: 409, 23505: 409, P0002: 404 };
  for (const [code, status] of Object.entries(codes)) {
    const error = Object.assign(new Error('fallo'), { code });
    await assert.rejects(
      () => callUpsertTenderClosureActa(fakeDatabase({ rpcError: error }), { opportunity_id: OPPORTUNITY }, JUAN),
      cause => cause.status === status,
      `el código ${code} debe llegar como HTTP ${status}`,
    );
  }
});

test('una oportunidad inválida se rechaza antes de tocar la base', async () => {
  const database = fakeDatabase();
  await assert.rejects(() => callUpsertTenderClosureActa(database, { opportunity_id: 'no-es-uuid' }, JUAN), /Debe indicar una oportunidad válida/);
  assert.equal(database.calls.length, 0);
});

test('las cuatro rutas del acta están montadas y la pantalla vive en Historial', () => {
  const server = fs.readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
  for (const route of [
    "app.get('/api/tender-closure-acta'",
    "app.post('/api/tender-closure-acta'",
    "app.post('/api/tender-closure-acta/confirm'",
    "app.post('/api/tender-closure-acta/reopen'",
  ]) assert.ok(server.includes(route), `falta la ruta ${route}`);
  assert.match(server, /ensureTenderOpportunity\(database, String\(req\.body\?\.opportunity_id \|\| ''\), currentProfile\)/);

  const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  const historial = main.slice(main.indexOf('tw-panel tw-panel-historial'), main.indexOf('tw-change-decision'));
  assert.match(historial, /<TenderClosureActa /, 'el acta va en la pestaña Historial');

  const component = fs.readFileSync(new URL('../src/tenders/workspace/TenderClosureActa.tsx', import.meta.url), 'utf8');
  assert.match(component, /if \(!payload && !closureKind\) return null;/, 'mientras la licitación esté abierta, el acta no ocupa la pantalla');
  assert.match(component, /La nota con la que se cerró/, 'la nota de cierre se muestra como punto de partida');
  assert.ok(!/const CLOSURE_REASONS|CATALOGO|catalogo/.test(component), 'no hay catálogo de motivos en la pantalla: los redacta Vig-IA');
});
