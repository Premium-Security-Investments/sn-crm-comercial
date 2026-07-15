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
const { deriveRecommendations, filterSources, parseSiioRouteState, toSiioHash } = await loadModule('../src/siio/selectors.ts');
const { createBoardDraftGovernance } = await loadModule('../src/siio/boardDraftPolicy.ts');
const { SIIO_AGENT_CATALOG } = await loadModule('../src/siioAgents.ts');

const input = {
  financialMetrics: [
    { period_month: '2026-04-01', category: 'resultado', concept: 'INGRESOS', value_current: 100, variation_pct: 0.1, validated_by: 'Finanzas', source_id: 'SRC-011' },
    { period_month: '2026-04-01', category: 'resultado', concept: 'COSTOS', value_current: 80, variation_pct: 0.2, validated_by: 'Finanzas', source_id: 'SRC-011' },
    { period_month: '2026-06-01', category: 'resultado', concept: 'INGRESOS', value_current: 200, variation_pct: 0.3, validated_by: null, source_id: 'SRC-013' },
    { period_month: '2026-06-01', category: 'resultado', concept: 'COSTOS', value_current: 120, variation_pct: 0.1, validated_by: null, source_id: 'SRC-013' },
  ],
  payrollAggregates: [
    { period_month: '2026-06-01', area: 'Operaciones', total_people: 10, total_accrued: 1000, total_deductions: 100, net_total: 900, source_id: 'SRC-012' },
  ],
  sources: [{ id: 'SRC-011', name: 'Finanzas abril' }, { id: 'SRC-012', name: 'Nómina' }, { id: 'SRC-013', name: 'Finanzas junio' }],
};

const latest = deriveSiioExecutiveSnapshot(input);
assert.equal(latest.financialPeriod, '2026-06-01', 'the default snapshot must continue using the latest published financial period');
assert.equal(latest.financialValidationStatus, 'pendiente_validacion');
assert.deepEqual(latest.financialSourceIds, ['SRC-013'], 'the latest snapshot must retain only its real financial evidence source');
const validationPending = deriveRecommendations(latest).find(item => item.id === 'financial-validation-pending');
assert.deepEqual(validationPending?.sourceIds, ['SRC-013'], 'an unvalidated-period warning must retain the source of that financial period');
assert.equal(validationPending?.period, '2026-06-01');
assert.match(validationPending?.evidence || '', /periodo financiero seleccionado/i, 'an unvalidated historical selection must not be described as the latest period');

const april = deriveSiioExecutiveSnapshot(input, '2026-04-01');
assert.equal(april.financialPeriod, '2026-04-01', 'an explicitly selected financial period must drive the snapshot');
assert.deepEqual(april.financialRows.map(row => row.period_month), ['2026-04-01', '2026-04-01']);
assert.equal(april.financialByConcept.INGRESOS.value_current, 100, 'financial indicators must come from the selected period');
assert.equal(april.financialValidationStatus, 'validado', 'validation status must come from the selected period');
assert.deepEqual(april.financialSourceIds, ['SRC-011'], 'the selected snapshot must retain the source IDs from its own financial rows');
assert.deepEqual(april.payrollSourceIds, ['SRC-012'], 'payroll may retain its own explicitly disclosed period and evidence source');
const aprilRecommendations = deriveRecommendations(april);
const costPressure = aprilRecommendations.find(item => item.id === 'cost-growth-pressure');
assert.ok(costPressure, 'the selected period must derive its own recommendations');
assert.equal(costPressure.period, '2026-04-01', 'recommendation evidence must disclose the selected origin period');
assert.match(costPressure.evidence, /Costos 20\.0% vs\. ingresos 10\.0%/, 'recommendation evidence must be calculated from selected-period indicators');
assert.deepEqual(costPressure.sourceIds, ['SRC-011'], 'recommendation evidence must use the selected rows real source IDs, not infer a fixed ID from prose');
assert.ok(!aprilRecommendations.some(item => item.id === 'financial-validation-pending'), 'recommendations from the latest period must not leak into a historical selection');

const empty = deriveSiioExecutiveSnapshot(input, '2026-03-01');
assert.equal(empty.financialPeriod, '2026-03-01');
assert.deepEqual(empty.financialRows, []);
assert.equal(empty.financialValidationStatus, 'sin_datos', 'a requested period without metrics must show an honest empty state');
assert.ok(!deriveRecommendations(empty).some(item => item.sourceIds.includes('SRC-011')), 'a period without metrics must not emit financial recommendations or evidence');

const visibleEvidenceSources = filterSources(input.sources, { period: '2026-04-01', freshness: '', trust: '', sourceType: '' }, april.evidenceSourceIds);
assert.deepEqual(visibleEvidenceSources.map(source => source.id), ['SRC-011', 'SRC-012'], 'the evidence view must exclude sources unrelated to the selected financial and explicit payroll periods');
const governance = createBoardDraftGovernance(SIIO_AGENT_CATALOG, {
  sources: input.sources,
  recommendations: aprilRecommendations,
  trackingItems: [],
});
assert.ok(governance.eligibleRecommendations.some(item => item.id === 'cost-growth-pressure'), 'AGT-001 must retain the selected-period financial recommendation when its real source is loaded and authorized');

const intelligenceRoute = parseSiioRouteState('#/siio?view=inteligencia&period=2026-04-01&freshness=vigente');
assert.deepEqual(intelligenceRoute, {
  view: 'inteligencia',
  filters: { period: '2026-04-01', freshness: 'vigente', trust: '', sourceType: '' },
}, 'the intelligence view must retain the financial period selected in the executive summary');
assert.equal(toSiioHash(intelligenceRoute), '#/siio?view=inteligencia&period=2026-04-01&freshness=vigente');

const executiveSource = readFileSync(new URL('../src/siio/SiioExecutiveView.tsx', import.meta.url), 'utf8');
const dashboardSource = readFileSync(new URL('../src/siio/SiioDashboard.tsx', import.meta.url), 'utf8');
const intelligenceSource = readFileSync(new URL('../src/siio/SiioSourcesIntelligenceView.tsx', import.meta.url), 'utf8');
const officialName = 'SIIO — Sistema Interno de Inteligencia Operativa';
assert.match(dashboardSource, new RegExp(officialName), 'the dashboard must use the official SIIO name');
assert.doesNotMatch(dashboardSource, /Sistema Integrado de Información Operativa/, 'the former institutional name must not remain visible');

const globalFilters = executiveSource.match(/<section className="siio-view-filters"[\s\S]*?<\/section>/)?.[0] || '';
assert.match(globalFilters, />Periodo financiero\s*</, 'the financial selector must be named for its true scope');
assert.doesNotMatch(globalFilters, />Área(?: de nómina)?\s*</, 'the payroll area selector must not appear as a global executive filter');
const payrollPanel = executiveSource.slice(executiveSource.indexOf('<Panel title="Nómina agregada">'));
assert.match(payrollPanel, />Área de nómina\s*</, 'the area selector must live inside the aggregate payroll panel');
assert.match(executiveSource, /navigateSiioView\('inteligencia', \{ period: selectedPeriod \}\)/, 'drilling into evidence must preserve the selected financial period');
assert.match(intelligenceSource, /routeState\.filters\.period/, 'the evidence view must derive recommendations for the carried financial period');
assert.match(intelligenceSource, /snapshot\.evidenceSourceIds/, 'the evidence catalogue must be constrained to sources supporting the periods shown');
assert.match(dashboardSource, /routeState\.filters\.period/, 'the Board draft snapshot must follow the selected financial period');
const executiveLogicSource = readFileSync(new URL('../src/siioExecutive.ts', import.meta.url), 'utf8');
const boardSource = readFileSync(new URL('../src/siio/SiioBoardDraftAction.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(executiveLogicSource, /métricas del último periodo/i, 'historical financial evidence must not be described as the latest period');
assert.doesNotMatch(boardSource, /indicadores cargados para el último periodo/i, 'a historical Board snapshot empty state must refer to the selected period');

console.log('SIIO manager period, payroll area, and institutional-name semantics OK');
