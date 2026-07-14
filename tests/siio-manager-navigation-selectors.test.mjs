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
  mod.toSiioHash({ view: 'inteligencia', filters: { freshness: 'vencida', trust: 'restringida', sourceType: 'archivo' } }),
  '#/siio?view=inteligencia&freshness=vencida&trust=restringida&sourceType=archivo',
);
assert.equal(
  mod.toSiioHash({ view: 'agentes', filters: { status: 'piloto', owner: 'Gerencia General' } }),
  '#/siio?view=agentes&status=piloto&owner=Gerencia+General',
);
const rows = mod.deriveTrackingItems([
  { id: 'REC-1', front_id: 'F2', title: 'Cierre de margen', owner: 'Finanzas', status: 'pendiente', semaforo: 'rojo', next_action: 'Validar costos', decision_required: 'Aprobar plan', source_ids: ['SRC-011'] },
  { id: 'REC-2', front_id: 'F3', title: 'Cobertura', owner: 'Operaciones', status: 'abierto', semaforo: 'amarillo', next_action: 'Revisar turnos', blockers: 'Vacantes', source_ids: ['SRC-012'] },
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
const recommendations = mod.deriveRecommendations({
  managementInsights: [{ id: 'i-1', front: 'F5', tone: 'amber', priority: 'alta', title: 'Validar cifras', finding: 'Falta validación', evidence: 'Métrica sin validador', action: 'Solicitar validación' }],
  financialPeriod: '2026-06-01', payrollPeriod: null,
});
assert.deepEqual(recommendations[0].sourceIds, ['Pendiente de evidencia']);
assert.equal(recommendations[0].period, '2026-06-01');
assert.deepEqual(
  mod.filterSources([
    { id: 'old', name: 'Archivo vencido', next_review_at: '2000-01-01', trust_level: 'restringida', source_type: 'archivo' },
    { id: 'new', name: 'Archivo vigente', next_review_at: '2999-01-01', trust_level: 'confiable', source_type: 'archivo' },
    { id: 'none', name: 'Sin fecha', trust_level: 'confiable', source_type: 'api' },
  ], { freshness: 'vencida', trust: '', sourceType: '' }).map(source => source.id),
  ['old'],
);
assert.deepEqual(mod.uniqueOptions([' Operaciones ', 'Finanzas', 'Operaciones', '', 'Finanzas']), ['Finanzas', 'Operaciones']);
console.log('SIIO managerial navigation selector contracts OK');
