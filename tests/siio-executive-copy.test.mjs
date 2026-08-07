import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

async function loadModule(relativePath) {
  const result = await build({
    entryPoints: [new URL(relativePath, import.meta.url).pathname],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const { deriveSiioExecutiveSnapshot } = await loadModule('../src/siioExecutive.ts');

const buildMetrics = (validated) => [
  { period_month: '2026-06-01', category: 'resultado', concept: 'INGRESOS', value_current: 100, variation_pct: 0.05, validated_by: validated ? 'Finanzas' : null, source_id: 'SRC-011' },
  { period_month: '2026-06-01', category: 'resultado', concept: 'COSTOS', value_current: 90, variation_pct: 0.15, validated_by: validated ? 'Finanzas' : null, source_id: 'SRC-011' },
];

const preliminary = deriveSiioExecutiveSnapshot({ financialMetrics: buildMetrics(false), payrollAggregates: [], sources: [] });
const validated = deriveSiioExecutiveSnapshot({ financialMetrics: buildMetrics(true), payrollAggregates: [], sources: [] });

assert.equal(preliminary.financialValidationStatus, 'pendiente_validacion');
assert.equal(validated.financialValidationStatus, 'validado');

const preliminaryInsight = preliminary.managementInsights.find(i => i.id === 'cost-growth-pressure');
const validatedInsight = validated.managementInsights.find(i => i.id === 'cost-growth-pressure');
assert.ok(preliminaryInsight, 'the preliminary snapshot must still derive the cost pressure insight');
assert.ok(validatedInsight, 'the validated snapshot must still derive the cost pressure insight');

assert.match(preliminaryInsight.title, /preliminar|fuente/i, 'an unvalidated insight title must disclose it is a preliminary reading');
assert.doesNotMatch(preliminaryInsight.finding, /^El crecimiento comercial no se está/, 'an unvalidated finding must not be written in closed-fact voice');
assert.match(validatedInsight.title, /costos crecen/i, 'a validated insight keeps the normal executive title');
assert.doesNotMatch(validatedInsight.title, /preliminar/i, 'a validated insight must not be labeled preliminary');
assert.match(validatedInsight.finding, /^El crecimiento comercial no se está/, 'a validated finding keeps the normal closed-fact voice');

assert.deepEqual(preliminaryInsight.sourceIds, validatedInsight.sourceIds, 'qualifying the copy must not alter the evidence sources');
assert.equal(preliminaryInsight.period, validatedInsight.period, 'qualifying the copy must not alter the origin period');
assert.equal(preliminaryInsight.action, validatedInsight.action, 'qualifying the copy must not alter the recommended action');

const executive = readFileSync(new URL('../src/siio/SiioExecutiveView.tsx', import.meta.url), 'utf8');
assert.match(executive, /siio-preliminary-notice/, 'the executive view must expose a distinct preliminary notice element');
assert.match(executive, /Lectura preliminar/, 'the executive view must disclose the preliminary reading in plain language');
assert.match(executive, /financialValidationStatus !== 'validado'/, 'the preliminary notice must be conditioned on the real validation status');

console.log('SIIO executive preliminary-copy contract OK');
