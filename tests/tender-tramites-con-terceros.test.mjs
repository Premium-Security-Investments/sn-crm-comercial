import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { fechaLimiteParaPedir, tramitesConTercerosSeedItems, TRAMITE_ITEM_KEY_PREFIX } from '../verticales/licitaciones/tender-tramites-con-terceros.js';
import { seedTenderDossierRequirements } from '../verticales/licitaciones/tender-dossier-rpc.js';

// Mejora 3 (encargo desde Terminal). TT-SPO-07 cerró el 4-nov; el GO fue el 30-oct. El RUP nuevo, el certificado de
// multas y sanciones de la SuperVigilancia y los certificados de experiencia de Megabús y Matecaña no salieron a tiempo.
const CIERRE = '2026-11-04';
const GO = '2026-10-30';
const matrix = { rows: [
  { status: 'falta', company_support: [{ key: 'rup' }, { key: 'no_fines_sanctions_certificate' }] },
  { status: 'por_confirmar', company_support: [{ key: 'supervigilancia_operating_license' }] },
  { status: 'no_aplica', company_support: [{ key: 'authorized_weapons_list' }] },
  { status: 'cumple', company_support: [{ key: 'chamber_of_commerce' }] },
] };
const bridge = { rows: [
  { key: 'rup', state: 'vencido', expires_at: '2026-10-15' },
  { key: 'no_fines_sanctions_certificate', state: 'vence_antes_del_cierre', expires_at: '2026-11-01' },
  { key: 'supervigilancia_operating_license', state: 'sin_archivo' },
  { key: 'authorized_weapons_list', state: 'vencido' },
  { key: 'chamber_of_commerce', state: 'listo_al_cierre' },
] };
const requirementRows = [
  { title: 'La garantía de seriedad de la oferta debe ser del 10 %', demand: '', status: 'por_confirmar', category: 'INSURANCE' },
  { title: 'Experiencia en vigilancia con entidades de transporte', demand: '', status: 'falta', category: 'EXPERIENCE' },
];

test('caso Terminal: al GO salen los trámites con tercero, con tercero, responsable, fecha límite y tiempo estimado', () => {
  const items = tramitesConTercerosSeedItems({ matrix, bridge, requirementRows, closeDate: CIERRE, today: GO });
  assert.deepEqual(items.map(item => item.item_key.slice(TRAMITE_ITEM_KEY_PREFIX.length)).sort(),
    ['certificados_experiencia', 'garantia_seriedad', 'no_fines_sanctions_certificate', 'rup']);
  const rup = items.find(item => item.item_key.endsWith(':rup'));
  assert.match(rup.title, /^Licitaciones · Trámite con tercero: Registro Único de Proponentes \(RUP\)$/);
  assert.match(rup.instruction, /pedirle a la Cámara de Comercio/);
  assert.match(rup.instruction, /unos 10 días hábiles \(estimado; se ajusta con lo observado\)/);
  assert.match(rup.instruction, /venció el 2026-10-15/);
  // 10 días hábiles no caben entre el 30-oct y el 4-nov: se pide hoy y se dice.
  assert.equal(rup.target_date, GO);
  assert.match(rup.instruction, /Ya no alcanza el tiempo típico antes del cierre: pedirlo hoy/);
  assert.ok(items.every(item => item.item_key.startsWith('agt002_req:')), 'la siembra de requisitos sólo acepta claves agt002_req:');
});

test('un hecho inscrito, lo que no aplica y lo listo al cierre no son trámites', () => {
  const keys = tramitesConTercerosSeedItems({ matrix, bridge, requirementRows: [], closeDate: CIERRE, today: GO }).map(item => item.item_key);
  assert.ok(!keys.some(key => /supervigilancia_operating_license|authorized_weapons_list|chamber_of_commerce/.test(key)));
});

test('la fecha límite para pedirlo es el cierre menos el tiempo típico y un día', () => {
  assert.deepEqual(fechaLimiteParaPedir('2026-11-30', 10, '2026-11-05'), { fecha: '2026-11-15', alcanza: true });
  assert.deepEqual(fechaLimiteParaPedir('2026-11-12', 10, '2026-11-05'), { fecha: '2026-11-05', alcanza: false });
});

test('la siembra del GO crea los trámites en su propia llamada, y si fallan los requisitos quedan igual', async () => {
  const llamadas = [];
  const database = {
    from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { expected_close_date: CIERRE }, error: null }) }; return q; },
    rpc: async (name, args) => { llamadas.push(args.p_items.map(item => item.item_key)); return { data: { inserted: args.p_items.length }, error: null }; },
  };
  const report = { available: true, report: { requirements: [] } };
  const conTramites = await seedTenderDossierRequirements(database, '11111111-1111-4111-8111-111111111111', 'actor', {
    readReport: async () => report, today: GO,
    readTramites: async ({ closeDate, today }) => tramitesConTercerosSeedItems({ matrix, bridge, requirementRows, closeDate, today }),
  });
  assert.equal(conTramites.tramites, 4);
  assert.ok(llamadas.at(-1).every(key => key.startsWith(TRAMITE_ITEM_KEY_PREFIX)));
  const falla = await seedTenderDossierRequirements(database, '11111111-1111-4111-8111-111111111111', 'actor', {
    readReport: async () => report, today: GO, readTramites: async () => { throw Object.assign(new Error('x'), { code: 'BOOM' }); },
  });
  assert.equal(falla.tramites, 0);
  assert.equal(falla.available, true);
});

test('en Preparar los trámites con tercero salen primero y no se repiten como vencidos', () => {
  const workspace = readFileSync(new URL('../src/tenders/workspace/TenderWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /tramites=\{groups\.open\.filter\(item => item\.item_key\.startsWith\(TRAMITE_ITEM_KEY_PREFIX\)\)/);
  const strip = workspace.slice(workspace.indexOf('export function TenderOverdueStrip'));
  assert.ok(strip.indexOf('{tramites.length > 0') < strip.indexOf('{shown.length > 0'), 'los trámites van antes que los vencidos');
});
