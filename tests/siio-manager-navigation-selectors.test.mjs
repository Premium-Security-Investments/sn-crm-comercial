import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transformSync } from 'esbuild';

const source = readFileSync('src/siio/selectors.ts', 'utf8');
const outDir = mkdtempSync(join(tmpdir(), 'siio-navigation-'));
const outPath = join(outDir, 'selectors.mjs');
writeFileSync(outPath, transformSync(source, { loader: 'ts', format: 'esm', target: 'es2020' }).code);
const mod = await import(`file://${outPath}`);

assert.deepEqual(mod.parseSiioRouteState('#/siio?view=seguimiento&kind=riesgos&status=pendiente&area=finanzas'), {
  view: 'seguimiento',
  filters: { kind: 'riesgos', status: 'pendiente', semaphore: '', owner: '' },
});
assert.deepEqual(mod.parseSiioRouteState('#/siio?view=invalida&period=2026-06-01'), {
  view: 'resumen',
  filters: { period: '2026-06-01', area: '' },
});
assert.equal(
  mod.toSiioHash({ view: 'inteligencia', filters: { period: '', freshness: 'vencida', trust: 'restringida', sourceType: 'archivo' } }),
  '#/siio?view=inteligencia&freshness=vencida&trust=restringida&sourceType=archivo',
);
assert.equal(
  mod.toSiioHash({ view: 'agentes', filters: { status: 'piloto', owner: 'Gerencia General' } }),
  '#/siio?view=agentes&status=piloto&owner=Gerencia+General',
);
const rows = mod.deriveTrackingItems([
  { id: 'REC-1', front_id: 'F2', title: 'Cierre de margen', owner: 'Finanzas', status: 'pendiente', semaforo: 'rojo', next_action: 'Validar costos', decision_required: 'Aprobar plan', source_ids: ['SRC-011'] },
  { id: 'REC-2', front_id: 'F3', title: 'Cobertura', owner: 'Operaciones', status: 'abierto', semaforo: 'amarillo', next_action: 'Revisar turnos', blockers: 'Vacantes', source_ids: ['SRC-012'], updated_at: '2026-06-01' },
], [
  { id: 'DEC-1', item_type: 'decision', description: 'Aprobar plan', owner: 'Finanzas', status: 'pendiente', related_record_id: 'REC-1' },
  { id: 'RISK-1', item_type: 'riesgo', description: 'Proveedor vencido', owner: 'Compras', status: 'abierto' },
]);
assert.deepEqual(rows.map(row => row.id), ['REC-1:decision', 'REC-2:bloqueos', 'RISK-1']);
assert.equal(rows[0].title, 'Aprobar plan');
assert.deepEqual(
  mod.filterTrackingItems(rows, { kind: 'bloqueos', status: '', semaphore: '', owner: '' }).map(row => row.id),
  ['REC-2:bloqueos'],
);
const duplicateTrackingRows = mod.deriveTrackingItems([
  { id: 'REC-Z', front_id: 'F2', title: 'Control de proveedores', decision_owner: 'Compras', status: 'pendiente', decision_required: 'Renovar contrato', source_ids: ['SRC-011'] },
  { id: 'REC-A', front_id: 'F2', title: 'Control de proveedores', decision_owner: 'Compras', status: 'pendiente', decision_required: 'Renovar contrato', source_ids: ['SRC-011'] },
], [
  { id: 'DEC-Z', item_type: 'decision', description: 'Renovar contrato', owner: 'Compras', status: 'pendiente', related_record_id: 'REC-Z' },
  { id: 'DEC-A', item_type: 'decision', description: ' renovar   contrato ', owner: 'Compras', status: 'pendiente' },
]);
assert.deepEqual(duplicateTrackingRows.map(row => row.id), ['REC-A:decision'], 'equivalent duplicate records and linked or unlinked decisions must collapse to the canonical record');
assert.equal(duplicateTrackingRows[0].nextAction, null, 'the canonical record must retain record fields rather than a decision fallback');
const reorderedDuplicateTrackingRows = mod.deriveTrackingItems([
  { id: 'REC-A', front_id: 'F2', title: 'Control de proveedores', decision_owner: 'Compras', status: 'pendiente', decision_required: 'Renovar contrato', source_ids: ['SRC-011'] },
  { id: 'REC-Z', front_id: 'F2', title: 'Control de proveedores', decision_owner: 'Compras', status: 'pendiente', decision_required: 'Renovar contrato', source_ids: ['SRC-011'] },
], [
  { id: 'DEC-A', item_type: 'decision', description: ' renovar   contrato ', owner: 'Compras', status: 'pendiente' },
  { id: 'DEC-Z', item_type: 'decision', description: 'Renovar contrato', owner: 'Compras', status: 'pendiente', related_record_id: 'REC-Z' },
]);
assert.deepEqual(reorderedDuplicateTrackingRows, duplicateTrackingRows, 'tracking rows must be invariant under input-order permutations');
const materiallyDistinctRows = mod.deriveTrackingItems([
  { id: 'REC-OWNER-A', front_id: 'F2', title: 'Proveedor crítico', decision_owner: 'Compras', status: 'pendiente', risks: 'Proveedor crítico' },
  { id: 'REC-OWNER-B', front_id: 'F2', title: 'Proveedor crítico', decision_owner: 'Jurídica', status: 'pendiente', risks: 'Proveedor crítico' },
], [
  { id: 'DEC-KIND', item_type: 'decision', description: 'Proveedor crítico', owner: 'Compras', status: 'pendiente' },
]);
assert.deepEqual(materiallyDistinctRows.map(row => row.id), ['REC-OWNER-A:riesgos', 'REC-OWNER-B:riesgos', 'DEC-KIND'], 'deduplication must retain rows with a materially distinct owner or kind');
const recommendations = mod.deriveRecommendations({
  managementInsights: [{ id: 'i-1', front: 'F5', tone: 'amber', priority: 'alta', title: 'Validar cifras', finding: 'Falta validación', evidence: 'Métrica sin validador', action: 'Solicitar validación' }],
  financialPeriod: '2026-06-01', payrollPeriod: null,
});
assert.deepEqual(recommendations[0].sourceIds, ['Pendiente de evidencia']);
assert.equal(recommendations[0].period, '2026-06-01');
const missingEvidenceAndPeriod = mod.deriveRecommendations({
  managementInsights: [{ id: 'i-2', front: 'F5', tone: 'amber', priority: 'alta', title: 'Completar trazabilidad', finding: 'No hay periodo disponible', evidence: '', action: 'Solicitar evidencia' }],
  financialPeriod: null,
  payrollPeriod: null,
});
assert.deepEqual(missingEvidenceAndPeriod[0].sourceIds, ['Pendiente de evidencia']);
assert.equal(missingEvidenceAndPeriod[0].period, null, 'a missing origin period must remain null for the view to disclose as pending');
assert.deepEqual(
  mod.filterSources([
    { id: 'old', name: 'Archivo vencido', next_review_at: '2000-01-01', trust_level: 'restringida', source_type: 'archivo' },
    { id: 'new', name: 'Archivo vigente', next_review_at: '2999-01-01', trust_level: 'confiable', source_type: 'archivo' },
    { id: 'none', name: 'Sin fecha', trust_level: 'confiable', source_type: 'api' },
  ], { freshness: 'vencida', trust: '', sourceType: '' }).map(source => source.id),
  ['old'],
);
assert.deepEqual(mod.uniqueOptions([' Operaciones ', 'Finanzas', 'Operaciones', '', 'Finanzas']), ['Finanzas', 'Operaciones']);

assert.equal(mod.isTerminalSiioStatus('Completado'), true);
assert.equal(mod.isTerminalSiioStatus('en curso'), false);
assert.equal(mod.isNegatedBlocker('No hay bloqueo crítico; continuar monitoreo'), true);
assert.equal(mod.isNegatedBlocker('Sin bloqueos pendientes'), true);
assert.equal(mod.isNegatedBlocker('Bloqueo por vacantes'), false);

const activityRecords = [
  { id: 'REC-CLOSED', front_id: 'F2', title: 'Plataforma decidida', decision_owner: 'Compras', status: 'Cerrado', decision_required: 'Confirmar plataforma', updated_at: '2026-08-01' },
  { id: 'REC-NEG-BLOCK', front_id: 'F2', title: 'Seguimiento proveedor', decision_owner: 'Compras', status: 'Abierto', blockers: 'Sin bloqueos pendientes', updated_at: '2026-08-01' },
  { id: 'REC-REAL-BLOCK', front_id: 'F3', title: 'Cobertura turnos', decision_owner: 'Operaciones', status: 'Abierto', blockers: 'Bloqueo por vacantes', updated_at: '2026-08-01' },
  { id: 'REC-ONLY-CREATED', front_id: 'F2', title: 'Revisión de alcance', decision_owner: 'Finanzas', status: 'Abierto', decision_required: 'Confirmar alcance', created_at: '2026-08-01' },
  { id: 'REC-SAME-TIMESTAMPS', front_id: 'F2', title: 'Ajuste de tarifa', decision_owner: 'Finanzas', status: 'Abierto', decision_required: 'Aprobar tarifa', created_at: '2026-08-01', updated_at: '2026-08-01' },
  { id: 'REC-MATERIAL-UPDATE', front_id: 'F2', title: 'Renovación de contrato', decision_owner: 'Compras', status: 'Abierto', decision_required: 'Firmar renovación', created_at: '2026-07-01', updated_at: '2026-08-01' },
  { id: 'REC-DUE-DATE-ONLY', front_id: 'F2', title: 'Entrega de informe', decision_owner: 'Operaciones', status: 'Abierto', decision_required: 'Enviar informe', due_date: '2026-09-01' },
];
const activityDecisions = [
  { id: 'DEC-NO-DATE', item_type: 'decision', description: 'Aprobar presupuesto', owner: 'Finanzas', status: 'Pendiente' },
];
const activityItems = mod.deriveTrackingItems(activityRecords, activityDecisions);
assert.deepEqual(activityItems.map(item => item.id).sort(), [
  'DEC-NO-DATE', 'REC-CLOSED:decision', 'REC-REAL-BLOCK:bloqueos',
  'REC-ONLY-CREATED:decision', 'REC-SAME-TIMESTAMPS:decision', 'REC-MATERIAL-UPDATE:decision', 'REC-DUE-DATE-ONLY:decision',
].sort(), 'a negated blocker must never produce a tracking item');
assert.equal(activityItems.find(item => item.id === 'REC-CLOSED:decision').activityState, 'history', 'a terminal status must be classified as history');
assert.equal(activityItems.find(item => item.id === 'REC-REAL-BLOCK:bloqueos').activityState, 'active', 'a legacy record carrying only updated_at must be classified as active');
assert.equal(activityItems.find(item => item.id === 'DEC-NO-DATE').activityState, 'unconfirmed', 'a non-terminal item without any timestamp must be classified as unconfirmed');
assert.equal(activityItems.find(item => item.id === 'REC-ONLY-CREATED:decision').activityState, 'unconfirmed', 'created_at alone must never be treated as evidence of current activity');
assert.equal(activityItems.find(item => item.id === 'REC-SAME-TIMESTAMPS:decision').activityState, 'unconfirmed', 'identical created_at and updated_at carry no material update signal');
assert.equal(activityItems.find(item => item.id === 'REC-MATERIAL-UPDATE:decision').activityState, 'active', 'an updated_at materially later than created_at is a real activity signal');
assert.equal(activityItems.find(item => item.id === 'REC-DUE-DATE-ONLY:decision').activityState, 'active', 'a concrete due date is a real activity signal on its own');
const defaultVisibleActivity = mod.filterTrackingItems(activityItems, { kind: 'todos', status: '', semaphore: '', owner: '' });
assert.deepEqual(defaultVisibleActivity.map(item => item.id).sort(), [
  'REC-REAL-BLOCK:bloqueos', 'REC-MATERIAL-UPDATE:decision', 'REC-DUE-DATE-ONLY:decision',
].sort(), 'the default filter without an explicit status must show only active items, never unconfirmed or history ones');
const explicitClosedFilter = mod.filterTrackingItems(activityItems, { kind: 'todos', status: 'cerrado', semaphore: '', owner: '' });
assert.deepEqual(explicitClosedFilter.map(item => item.id), ['REC-CLOSED:decision'], 'an explicit terminal status filter must retrieve history items');
const explicitPendingFilter = mod.filterTrackingItems(activityItems, { kind: 'todos', status: 'pendiente', semaphore: '', owner: '' });
assert.deepEqual(explicitPendingFilter.map(item => item.id), ['DEC-NO-DATE'], 'an explicit status filter must retrieve unconfirmed items too, not only active ones');

const assessment = mod.deriveSourceAssessment({
  status: 'activa', trust_level: 'oficial_requiere_validacion',
  last_reviewed_at: null, next_review_at: '2026-08-01',
}, new Date('2026-08-08T00:00:00Z'));
assert.deepEqual(assessment, {
  availability: 'Disponible', review: 'Sin revisión registrada',
  freshness: 'Revisión vencida', validation: 'Requiere validación',
  applicability: 'No registrada', compliance: 'No evaluado',
});
const undatedAssessment = mod.deriveSourceAssessment({ status: 'activa' }, new Date('2026-08-08T00:00:00Z'));
assert.doesNotMatch(JSON.stringify(undatedAssessment), /Vigente/, 'a source without dates must never be described as vigente');
assert.equal(undatedAssessment.availability, 'Disponible');

assert.equal(
  mod.sourceFreshness({ next_review_at: '2026-08-08T15:00:00Z' }, new Date('2026-08-08T09:00:00Z')),
  'próxima_a_vencer',
  'next_review_at must normalize to start of day so a same-day timestamp is próxima_a_vencer regardless of its time of day',
);

console.log('SIIO managerial navigation selector contracts OK');
