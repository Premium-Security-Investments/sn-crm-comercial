// Aliados: ficha del RUP (Juan, 2026-11-21; migración 233). Los textos de fixtures/aliados-rup/ son los PDF reales del
// 21-nov: la consulta gratuita de ruppro de TAC y de El Progreso, y el certificado del RUP de la Cámara de Bogotá de
// Covisur (venía en su oferta pública al Terminal TT-SPO-07). Las cifras esperadas se cotejaron a mano con cada PDF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { codesIn, detectRupKind, parseColombianNumber, parseRupText, rupPayload, summarizeRup } from '../verticales/licitaciones/aliados-rup.js';
import { saveAllyCapabilities, saveAllyRup } from '../verticales/licitaciones/tender-allies.js';

const fixture = name => readFileSync(new URL(`../fixtures/aliados-rup/${name}.txt`, import.meta.url), 'utf8');

test('números en formato colombiano; «N/D» y vacío son «sin dato», no cero', () => {
  assert.equal(parseColombianNumber('$ 22.553.291.933,0000'), 22553291933);
  assert.equal(parseColombianNumber('$11.697.601.426,00'), 11697601426);
  assert.equal(parseColombianNumber('18,29'), 18.29);
  assert.equal(parseColombianNumber('3.556,84'), 3556.84);
  assert.equal(parseColombianNumber('10.473'), 10473);
  assert.equal(parseColombianNumber('N/D'), null);
  assert.equal(parseColombianNumber(''), null);
});

test('códigos UNSPSC en los tres formatos (corrido, con espacios y en la tabla de la Cámara de Bogotá)', () => {
  assert.deepEqual(codesIn('92121500 92121700'), ['92121500', '92121700']);
  assert.deepEqual(codesIn('92 12 15 00 : SERVICIOS DE GUARDIAS'), ['92121500']);
  assert.deepEqual(codesIn('| 92 | 12 | 15 | 00 | | 92 | 12 | 17 | 00 |'), ['92121500', '92121700']);
});

test('consulta de ruppro (TAC): totales, multas y experiencia; la liquidez queda sin dato', () => {
  const text = fixture('ruppro-tac-900448609');
  assert.equal(detectRupKind(text), 'consulta_ruppro');
  const parsed = parseRupText(text);
  assert.equal(parsed.nit, '900448609');
  assert.equal(parsed.cut_date, '2025-12-31');
  assert.equal(parsed.total_assets, 22553291933);
  assert.equal(parsed.total_liabilities, 8725803308);
  assert.equal(parsed.current_assets, null);
  assert.equal(parsed.operating_income, 4540706763);
  assert.equal(parsed.roe, 0.32);
  assert.equal(parsed.has_fines, false);
  assert.equal(parsed.has_sanctions, false);
  const summary = summarizeRup(parsed);
  assert.equal(summary.liquidity, null);
  assert.equal(summary.working_capital, null);
  assert.equal(summary.debt_ratio, 0.387);
  assert.equal(summary.contracts_total, 43);
  assert.equal(summary.contracts_own, 19);
  assert.equal(summary.smmlv_own, 40100);
  assert.equal(summary.largest_own_smmlv, 10129);
  assert.equal(summary.has_guard_code, true);
});

test('consulta de ruppro (El Progreso): casi toda la experiencia es propia', () => {
  const summary = summarizeRup(parseRupText(fixture('ruppro-progreso-830094607')));
  assert.equal(summary.contracts_total, 47);
  assert.equal(summary.contracts_own, 45);
  assert.equal(summary.smmlv_own, 38779);
  assert.equal(summary.largest_own_smmlv, 4672);
});

test('certificado de la Cámara de Bogotá (Covisur): trae lo corriente, así que hay liquidez', () => {
  const text = fixture('camara-covisur-891502104');
  assert.equal(detectRupKind(text), 'certificado_camara');
  const parsed = parseRupText(text);
  assert.equal(parsed.nit, '891502104');
  assert.equal(parsed.current_assets, 11697601426);
  assert.equal(parsed.current_liabilities, 639490863);
  assert.equal(parsed.interest_expense, 1250450);
  assert.equal(parsed.has_fines, null, 'el certificado no dice «no reporta multas»: sin dato');
  const summary = summarizeRup(parsed);
  assert.equal(summary.liquidity, 18.29);
  assert.equal(summary.debt_ratio, 0.318);
  assert.equal(summary.working_capital, 11058110563);
  assert.equal(summary.contracts_total, 80);
  assert.equal(parsed.contracts[0].own, true);
  assert.equal(parsed.contracts[0].smmlv, 1610.22);
  assert.equal(parsed.contracts[1].own, false, 'el 2 es una unión temporal');
});

test('un PDF que no es del RUP se rechaza con un mensaje para la persona', () => {
  assert.throws(() => parseRupText('Factura electrónica de venta'), /no es una consulta de ruppro ni un certificado/);
});

test('el payload lleva el resumen y los contratos sin el texto completo', () => {
  const payload = rupPayload(parseRupText(fixture('ruppro-tac-900448609')), { fileName: 'tac.pdf', sha256: 'a'.repeat(64) });
  assert.equal(payload.source_kind, 'consulta_ruppro');
  assert.equal(payload.liquidity, null);
  assert.equal(payload.contracts.length, 43);
  assert.deepEqual(Object.keys(payload.contracts[0]).sort(), ['client', 'codes', 'own', 'sequence', 'smmlv']);
});

function fakeDb() {
  const calls = [];
  return { calls, rpc: async (name, args) => { calls.push({ name, args }); return { data: { ...args.p_payload, nit: args.p_nit }, error: null }; } };
}

test('saveAllyRup guarda con el NIT de la empresa y rechaza el RUP de otra', async () => {
  const database = fakeDb();
  const text = fixture('ruppro-tac-900448609');
  const result = await saveAllyRup(database, { actorId: 'u1', nit: '900448609', text, fileName: 'tac.pdf', sha256: 'b'.repeat(64) });
  assert.equal(result.kind, 'consulta_ruppro');
  assert.equal(database.calls[0].name, 'psi_save_vigilance_rup');
  assert.equal(database.calls[0].args.p_nit, '900448609');
  await assert.rejects(() => saveAllyRup(fakeDb(), { actorId: 'u1', nit: '891502104', text }), /es del NIT 900448609, no de esta empresa/);
});

test('saveAllyCapabilities valida el SG-SST y la fecha', async () => {
  const database = fakeDb();
  await saveAllyCapabilities(database, { actorId: 'u1', nit: '891502104', body: { radio_cities: 'Bogotá', radio_source: 'Licencia MinTIC', sgsst_pct: '92,5', sgsst_date: '2026-03-31' } });
  assert.equal(database.calls[0].name, 'psi_save_vigilance_capabilities');
  assert.equal(database.calls[0].args.p_payload.sgsst_pct, 92.5);
  await assert.rejects(() => saveAllyCapabilities(fakeDb(), { actorId: 'u1', nit: '891502104', body: { sgsst_pct: '120' } }), /de 0 a 100/);
  await assert.rejects(() => saveAllyCapabilities(fakeDb(), { actorId: 'u1', nit: '891502104', body: { sgsst_date: '31/03/2026' } }), /fecha/);
});
