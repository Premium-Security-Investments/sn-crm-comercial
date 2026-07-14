import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transformSync } from 'esbuild';

const sourcePath = new URL('../src/siioExecutive.ts', import.meta.url);
assert.ok(existsSync(sourcePath), 'src/siioExecutive.ts must exist');
const source = readFileSync(sourcePath, 'utf8');
const compiled = transformSync(source, { loader: 'ts', format: 'esm', target: 'es2020', sourcefile: 'siioExecutive.ts' });
const tempDir = mkdtempSync(join(tmpdir(), 'siio-executive-'));
const outPath = join(tempDir, 'siioExecutive.mjs');
writeFileSync(outPath, compiled.code);
const mod = await import(`file://${outPath}`);

const snapshot = mod.deriveSiioExecutiveSnapshot({
  financialMetrics: [
    { period_month: '2026-03-01', concept: 'INGRESOS', value_current: 90, variation_pct: 0.1, validated_by: 'Finanzas' },
    { period_month: '2026-04-01', concept: 'INGRESOS', value_current: 100, variation_pct: 0.2, validated_by: null },
    { period_month: '2026-04-01', concept: 'UTILIDAD NETA', value_current: 10, variation_pct: 0.5, validated_by: null },
    { period_month: '2026-04-01', concept: 'MARGEN NETO', value_current: 0.1, variation_pct: 0, validated_by: null },
  ],
  payrollAggregates: [
    { period_month: '2026-05-01', area: 'Anterior', total_people: 99, total_accrued: 999, total_deductions: 99, net_total: 900 },
    { period_month: '2026-06-01', area: 'Finanzas', total_people: 2, total_accrued: 300, total_deductions: 30, net_total: 270 },
    { period_month: '2026-06-01', area: 'Operaciones', total_people: 3, total_accrued: 450, total_deductions: 45, net_total: 405, alert: 'Validar fuente' },
  ],
  sources: [
    { id: 'SRC-011', name: 'PYG', status: 'activa', trust_level: 'oficial_requiere_validacion', last_reviewed_at: '2026-04-30' },
    { id: 'SRC-012', name: 'Nómina', status: 'activa', trust_level: 'restringida', last_reviewed_at: '2026-06-26' },
  ],
});

assert.equal(snapshot.financialPeriod, '2026-04-01');
assert.equal(snapshot.payrollPeriod, '2026-06-01');
assert.equal(snapshot.financialByConcept.INGRESOS.value_current, 100);
assert.equal(snapshot.financialByConcept['UTILIDAD NETA'].value_current, 10);
assert.equal(snapshot.payrollTotals.totalPeople, 5);
assert.equal(snapshot.payrollTotals.totalAccrued, 750);
assert.equal(snapshot.payrollTotals.totalDeductions, 75);
assert.equal(snapshot.payrollTotals.netTotal, 675);
assert.equal(snapshot.payrollTotals.alerts, 1);
assert.deepEqual(snapshot.payrollRows.map(row => row.area), ['Operaciones', 'Finanzas']);
assert.equal(snapshot.financialValidationStatus, 'pendiente_validacion');
assert.equal(snapshot.sourceFreshness.length, 2);
assert.ok(!JSON.stringify(snapshot).toLowerCase().includes('cedula'));

const empty = mod.deriveSiioExecutiveSnapshot({ financialMetrics: [], payrollAggregates: [], sources: [] });
assert.equal(empty.financialPeriod, null);
assert.equal(empty.payrollPeriod, null);
assert.equal(empty.payrollTotals.totalPeople, 0);

console.log('SIIO executive snapshot derivation OK');
