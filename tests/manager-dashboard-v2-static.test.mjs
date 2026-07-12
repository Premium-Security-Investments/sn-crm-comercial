import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const requiredMainMarkers = [
  "'dashboard2'",
  "if (page === 'dashboard2') return { page: 'dashboard2' };",
  "if (route.page === 'dashboard2') return 'Dashboard gerencial';",
  "href=\"#/dashboard2\">Dashboard comercial",
  "if (route.page === 'dashboard' || route.page === 'dashboard2') return <ManagerDashboardV2 data={data} />;",
  'function ManagerDashboardV2({ data }: { data: Bootstrap })',
  'dashboard-v2',
  'gerencial-v2-hero',
  'dashboard-v2-six-components',
  'v2ServiceName',
  'v2HeroLabel',
  'Servicio: ${v2ServiceName}',
  'Vista filtrada',
  'hasNonServiceFilters',
  'v2HeroTitle',
  'v2HeroSubtitle',
  'Cumplimiento por debajo de meta',
  'Priorizar cierres de mayor valor esperado, comerciales rezagados y oportunidades sin seguimiento.',
  'v2-hero-actions',
  'v2HeroMetrics',
  'activeV2Metric',
  'v2HeroMetricDetails',
  'v2MetricDetailRows',
  'v2-hero-metric-button',
  'v2-hero-detail-panel',
  'Ver detalle',
  'Detalle visible',
  'Datos de la métrica seleccionada',
  'Cumplimiento comercial',
  'Pipeline / prospección activa',
  'Top oportunidades de cierre',
  'Valor promedio por oferta',
  'rankingRowsV2',
  'pipelineRowsV2',
  'topCloseRowsV2',
  'projectionCardsV2',
  'v2-progress-track',
  'v2-weight-bar',
  'v2-projection-table',
  'v2-sales-table',
  'Seguridad Física',
  'service-context-pill',
  'Prioridades gerenciales de hoy',
  'Normalizar regional',
  'Ordenado por valor esperado',
  'Valor esperado',
  'formatDisplayName',
  'formatRegionalLabel',
  'row.value / Math.max(totalPipeline, 1)',
  'v2-filter-strip',
  'manager-dashboard-filters v2-dashboard-filters',
  'setService(\'seguridad_fisica\')',
  'matchesDashboardPeriod(o, period)',
  'Productos',
  'Comerciales',
  'Regiones',
  'Etapas',
  'Pipeline activo',
  'Limpiar',
  'v2ScopeSummary',
  'sourceRows = scopedOpportunities',
  'performanceRows = useMemo(() => data.opportunities.filter(v2BaseScopeMatches)',
  'approvedRows = performanceRows.filter(isApprovedSale)',
  'PRODUCT_OPERATIONAL_UNITS',
  'productOperationalUnit',
  'Desempeño comercial 2026 por producto',
  'Presupuesto, ventas y prospección 2026',
  'Proyección / presupuesto 2026',
  'Ventas acumuladas por comercial',
  'projectionRowsV2',
  'monthlySalesRowsV2',
  'serviceScopedBudgetRowsV2',
  'Unidad proyectada',
  'Presupuesto anual',
  'Ventas acumuladas',
  'Clientes',
  'Cumplimiento individual',
  'Presupuesto individual cargado en CRM',
  'setService(\'\')',
  'producto seleccionado',
  'Gestión comercial que requiere atención',
  'v2CommercialAlertRows',
  'Valor en riesgo',
  'Vencidas',
  'Sin agenda',
  'Sin seguimiento',
  'Ver perfil',
  'v2RiskSummaryCards',
  'commercial-risk-table',
];

const requiredCssMarkers = [
  '.dashboard-v2',
  '.gerencial-v2-hero',
  '.service-context-pill',
  '.v2-kpi-grid',
  '.v2-kpi-card',
  '.v2-executive-grid',
  '.v2-ranking-list',
  '.v2-ranking-row',
  '.v2-progress-track',
  '.v2-weight-bar',
  '.v2-deal-list',
  '.v2-deal-row',
  '.v2-pipeline-table',
  '.v2-projection-table table',
  '.v2-sales-table table',
];

for (const marker of requiredMainMarkers) {
  assert.ok(main.includes(marker), `main.tsx missing dashboard v2 marker: ${marker}`);
}

for (const marker of requiredCssMarkers) {
  assert.ok(css.includes(marker), `styles.css missing dashboard v2 marker: ${marker}`);
}

assert.ok(main.indexOf('nav-section-title">Gerencia') < main.indexOf('href="#/dashboard2">Dashboard comercial'), 'Dashboard comercial debe quedar dentro del grupo Gerencia del sidebar');
assert.ok(main.indexOf('Panel title="Cumplimiento comercial"') < main.indexOf('Panel title="Pipeline / prospección activa"'), 'Dashboard v2 should prioritize compliance before prospecting detail');
assert.ok(main.indexOf('Panel title="Pipeline / prospección activa"') < main.indexOf('Panel title="Top oportunidades de cierre"'), 'Dashboard v2 should end with prioritized close opportunities');
assert.ok(!main.includes('Proyección 2026 — tabla completa'), 'Dashboard v2 should not copy the full PowerPoint tables into the first level');
assert.ok(main.includes('<th>Comercial</th><th>Regional</th><th>Unidad proyectada</th>'), 'Projection table should not include Cargo in the gerencial 2026 view');
assert.ok(!main.includes('<th>Comercial</th><th>Cargo</th><th>Regional</th><th>Clientes</th>'), 'Monthly sales table should remove redundant Cargo column');
assert.ok(!main.includes('<th>Comercial</th><th>Cargo</th><th>Regional</th><th>Unidad proyectada</th>'), 'Projection table should remove redundant Cargo column');
assert.ok(main.includes('<th>Comercial</th><th>Regional</th><th>Clientes</th>'), 'Monthly sales table should keep Regional directly after Comercial');
assert.ok(!main.includes('Resumen ejecutivo · {v2ServiceName}'), 'Dashboard v2 hero should not repeat the long resumen ejecutivo label');
assert.ok(!main.includes('Datos CRM en vivo'), 'Dashboard v2 hero should not include redundant CRM-live pill');
assert.ok(!main.includes('Corte 2026'), 'Dashboard v2 hero should not include redundant 2026 pill');
assert.ok(!main.includes('Área activa: Seguridad Física'), 'Dashboard v2 hero should use concise Servicio label instead of area wording');
assert.ok(!main.includes("onClick={()=>setService('')}>Ver todos los productos"), 'Dashboard v2 should not keep a separate Ver todos los productos button; all products should be an option in the product dropdown');
assert.ok(main.indexOf('v2-filter-strip') < main.indexOf('gerencial-v2-hero'), 'Dashboard v2 filters should appear above the main executive banner');
assert.ok(main.includes("empty=\"Productos\""), 'Product selector should expose Productos as the compact empty/all option');
const v2FilterStart = main.indexOf('<section className="v2-filter-strip panel"');
const v2FilterEnd = main.indexOf('</section>', v2FilterStart);
const v2FilterMarkup = main.slice(v2FilterStart, v2FilterEnd);
assert.ok(v2FilterMarkup.includes('<input placeholder="Buscar cliente, sede, ciudad o ID…"') && v2FilterMarkup.indexOf('<input placeholder="Buscar cliente, sede, ciudad o ID…"') < v2FilterMarkup.indexOf('empty="Período"') && v2FilterMarkup.indexOf('empty="Período"') < v2FilterMarkup.indexOf('empty="Productos"') && v2FilterMarkup.indexOf('empty="Productos"') < v2FilterMarkup.indexOf('empty="Comerciales"') && v2FilterMarkup.indexOf('empty="Comerciales"') < v2FilterMarkup.indexOf('empty="Regiones"') && v2FilterMarkup.indexOf('empty="Regiones"') < v2FilterMarkup.indexOf('empty="Etapas"'), 'Dashboard v2 filter order should be Buscar, Período, Producto/servicio, Comercial, Regional, Etapa with compact labels');
assert.ok(v2FilterMarkup.indexOf('Pipeline activo') > v2FilterMarkup.indexOf('empty="Etapas"') && v2FilterMarkup.indexOf('>Limpiar<') > v2FilterMarkup.indexOf('Pipeline activo'), 'Pipeline activo and Limpiar should remain visible after the primary filters');
assert.ok(css.includes('.v2-dashboard-filters{grid-template-columns:minmax(260px,1.35fr) minmax(130px,.7fr) minmax(160px,.85fr) minmax(160px,.85fr);'), 'Dashboard v2 filters should intentionally use four columns / two rows so controls do not get squeezed into one line');
assert.ok(css.includes('@media(max-width:900px){.v2-filter-strip{grid-template-columns:1fr}.v2-dashboard-filters{grid-template-columns:repeat(2,minmax(0,1fr))}'), 'Dashboard v2 filters should gracefully wrap to two narrow columns on smaller screens');
assert.ok(css.includes('overflow:visible'), 'Dashboard v2 filter strip should not clip the right-side controls');
assert.ok(main.includes('v2ScopeSummary') && main.includes('${sourceRows.length}/${data.opportunities.length} oportunidades'), 'Opportunity counter should move into the hero scope summary without the extra visibles wording');
assert.ok(main.includes('<div className="command-title-row"><span className="service-context-pill">{v2HeroLabel}</span><span className="v2-hero-scope-summary">{v2ScopeSummary}</span></div>'), 'Dashboard v2 hero scope summary should sit beside the service pill on desktop');
assert.ok(!main.includes('Actualizado ${lastUpdatedLabel(sourceRows)}'), 'Dashboard v2 hero scope summary should not spend banner space on the update date');
assert.ok(main.indexOf('v2HeroTitle') < main.indexOf('v2HeroSubtitle') && main.indexOf('v2HeroSubtitle') < main.indexOf('v2-hero-actions'), 'Dashboard v2 banner should read as diagnosis, submessage, then quick actions');
assert.ok(!main.includes('<div className="filter-summary"><strong>{sourceRows.length}</strong> de {data.opportunities.length} oportunidades visibles'), 'Dashboard v2 filter bar should not carry the thick visible-opportunity footer');
assert.ok(main.includes("targetId: 'v2-top-close-opportunities'"), 'Cerrar oportunidades top should scroll to the prioritized close opportunities section');
assert.ok(main.includes("targetId: 'v2-low-compliance-focus'"), 'Recuperar bajo cumplimiento should scroll to the exact low-compliance explanation');
assert.ok(main.includes("targetId: 'v2-regional-normalization-focus'"), 'Normalizar regional should scroll to the exact data-quality explanation');
assert.ok(main.includes("targetId: 'v2-forecast-focus'"), 'Proteger forecast should scroll to the exact forecast concentration panel');
assert.ok(main.includes('dashboard-focus-hit'), 'Priority cards should visually highlight the destination after scroll');
assert.ok(css.includes('.dashboard-v2 .v2-priority-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;align-items:stretch}'), 'Priority cards should use readable dashboard-specific columns');
assert.ok(main.includes('v2-kpi-button'), 'Desempeño comercial KPI cards should be clickable buttons');
assert.ok(main.includes("targetId: 'v2-sales-accumulated-focus'"), 'Ventas aprobadas KPI should scroll to accumulated sales table');
assert.ok(main.includes("targetId: 'v2-annual-budget-focus'"), 'Presupuesto/unidad KPIs should scroll to budget projection table');
assert.ok(main.includes("targetId: 'v2-active-pipeline-focus'"), 'Pipeline activo KPI should scroll to active pipeline table');
assert.ok(css.includes('.v2-kpi-button:hover'), 'Clickable KPI cards should have visible hover/focus affordance');

assert.ok(main.includes('const scopedOpportunities = useMemo(() => data.opportunities.filter(o =>\n    v2BaseScopeMatches(o) &&\n    (!stage || o.stage_code === stage) &&\n    (!onlyActive || !isTerminalStage(o.stage_code))'), 'Stage and Pipeline activo should only narrow the visible opportunity/pipeline scope');
assert.ok(main.includes('const performanceRows = useMemo(() => data.opportunities.filter(v2BaseScopeMatches), [data.opportunities, period, q, owner, regional, service]);'), 'Performance scope should keep approved sales when stage or Pipeline activo filters are used');
assert.ok(main.includes('const approvedRows = performanceRows.filter(isApprovedSale);'), 'Compliance must be based on performanceRows, not active-only sourceRows');
assert.ok(main.includes('const rankingRowsV2 = Array.from(performanceRows.reduce'), 'Commercial compliance ranking should ignore stage/active-only filters that would remove approved sales');
assert.ok(main.includes('const pipelineRowsV2 = Array.from(activeRows.reduce'), 'Pipeline tables should continue to use active visible rows');

console.log('manager-dashboard-v2 static checks passed');
