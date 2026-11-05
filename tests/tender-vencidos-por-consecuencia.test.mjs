import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { dossierItemConsequence, openNotCurable, overdueByConsequence } from '../src/tenders/dossierChecklistModel.ts';

// Mejora 1 (encargo desde Terminal). TT-SPO-07: trece ítems sembrados el 30-oct llegaron al cierre (4-nov) en
// `pendiente`, con fechas meta del 30-oct, 31-oct y 1-nov, y nadie se enteró. Textos tomados de los ítems reales de
// Supersalud (`select` del 2026-11-05).
const item = (id, title, target_date, extra = {}) => ({
  id, title, target_date, status: 'pendiente', required: true, applicability: 'requerido', item_type: 'pendiente_humano',
  item_key: `agt002_req:${id}`, instruction: null, latest_evidence: null, assignee_name: 'Katherine Valencia Buitrago', ...extra,
});
const ITEMS = [
  item('poliza', 'Financiero · La garantía de seriedad de la oferta debe ser del 10 % del… — CAUSA RECHAZO', '2026-10-31',
    { instruction: 'No presentarla con la oferta no se puede subsanar y causa rechazo; los errores en ella sí se subsanan.' }),
  item('docs', 'Jurídico · Documentos técnicos que van con la oferta — CAUSA RECHAZO', '2026-10-30'),
  item('experiencia', 'Licitaciones · Certificaciones de experiencia', '2026-11-01'),
  item('opcional', 'Comercial · Carta de referencia', '2026-10-30', { required: false }),
  item('futuro', 'Jurídico · Antecedentes del RL', '2026-11-10'),
  item('listo', 'Financiero · RUT — CAUSA RECHAZO', '2026-10-30', { status: 'listo' }),
  item('no_aplica', 'Técnico · Horas extras — CAUSA RECHAZO', '2026-10-30', { applicability: 'no_aplica' }),
];

test('la consecuencia sale del título y de lo que dicen el análisis y las personas', () => {
  assert.equal(dossierItemConsequence(ITEMS[0]), 'no_subsanable');
  assert.equal(dossierItemConsequence(ITEMS[1]), 'causa_rechazo');
  assert.equal(dossierItemConsequence(ITEMS[2]), 'obligatorio');
  assert.equal(dossierItemConsequence(ITEMS[3]), 'otro');
  assert.equal(dossierItemConsequence(item('x', 'Jurídico · Póliza', null, { latest_evidence: { kind: 'texto', text: 'Es insubsanable.', url: null, at: '' } })), 'no_subsanable');
});

test('caso Terminal: el 3-nov los vencidos salen nombrados, primero lo que no se subsana; lo listo, lo que no aplica y lo futuro no', () => {
  const vencidos = overdueByConsequence(ITEMS, '2026-11-03');
  assert.deepEqual(vencidos.map(v => [v.item.id, v.consequence, v.daysLate]), [
    ['poliza', 'no_subsanable', 3],
    ['docs', 'causa_rechazo', 4],
    ['experiencia', 'obligatorio', 2],
    ['opcional', 'otro', 4],
  ]);
});

test('lo que no se subsana y sigue abierto se recuerda aunque no esté vencido', () => {
  const futuro = item('seriedad', 'Financiero · Garantía de seriedad', '2026-11-20', { instruction: 'No se puede subsanar.' });
  assert.deepEqual(openNotCurable([...ITEMS, futuro]).map(i => i.id), ['poliza', 'seriedad']);
});

test('la franja va arriba de Preparar, con la cuenta regresiva y los vencidos nombrados', () => {
  const workspace = readFileSync(new URL('../src/tenders/workspace/TenderWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /return <div className="tw-prepare">\s*\n\s*<TenderOverdueStrip closeDate=\{closeDate\} overdue=\{overdueByConsequence\(workspace\.checklist\.filter\(item => !item\.item_key\.startsWith\(TRAMITE_ITEM_KEY_PREFIX\)\), today\)\} notCurable=\{openNotCurable\(workspace\.checklist\)\}/);
  assert.match(workspace, /const urgent = days <= 2;/, 'en rojo cuando faltan 48 horas o menos');
});
