import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

const sectionMarkers = [
  'v2-component-block resumen-ejecutivo',
  '1. Resumen ejecutivo',
  'v2-component-block presupuesto-ventas',
  '2. Presupuesto y ventas 2026',
  'v2-component-block cumplimiento-comercial',
  '3. Cumplimiento por comercial',
  'v2-component-block pipeline-prioridades',
  '4. Pipeline y oportunidades prioritarias',
  'v2-component-block diagnostico-alertas',
  '5. Diagnóstico operativo / alertas',
  'v2-component-block tendencia-salud',
  '6. Tendencia y salud comercial',
];

for (const marker of sectionMarkers) {
  assert.ok(main.includes(marker), `Dashboard gerencial missing six-component marker: ${marker}`);
}

assert.ok(main.indexOf('1. Resumen ejecutivo') < main.indexOf('2. Presupuesto y ventas 2026'), 'Resumen must appear before presupuesto');
assert.ok(main.indexOf('2. Presupuesto y ventas 2026') < main.indexOf('3. Cumplimiento por comercial'), 'Presupuesto must appear before cumplimiento');
assert.ok(main.indexOf('3. Cumplimiento por comercial') < main.indexOf('4. Pipeline y oportunidades prioritarias'), 'Cumplimiento must appear before pipeline');
assert.ok(main.indexOf('4. Pipeline y oportunidades prioritarias') < main.indexOf('5. Diagnóstico operativo / alertas'), 'Pipeline must appear before diagnostico');
assert.ok(main.indexOf('5. Diagnóstico operativo / alertas') < main.indexOf('6. Tendencia y salud comercial'), 'Diagnostico must appear before tendencia');

assert.ok(!main.includes('Secciones traídas del Dashboard 1'), 'Final dashboard should not expose internal Dashboard 1 handoff language');
assert.ok(!main.includes('Traído del Dashboard 1'), 'Final dashboard should not label sections as imported from Dashboard 1');

assert.ok(main.includes('ownerBudget = serviceScopedBudgetRowsV2.find(b => b.ownerId === row.ownerId)?.budget'), 'Compliance ranking must use each commercial budget first');
assert.ok(main.includes('monthReferenceDate(o)'), 'Monthly sales should use the normalized month reference date helper');
assert.ok(main.includes('monthlyProjectedUnits'), 'Projected 24H units should be monthly, not annualized');

console.log('dashboard six-component static checks passed');
