import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const requiredMainMarkers = [
  "'dashboard2'",
  "if (page === 'dashboard2') return { page: 'dashboard2' };",
  "if (route.page === 'dashboard2') return 'Dashboard gerencial';",
  "['#/dashboard2','Dashboard gerencial']",
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
  'Prioridad gerencial: convertir cierres top, proteger forecast y recuperar cumplimiento.',
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
  'Panel title="Filtros gerenciales"',
  'manager-dashboard-filters v2-dashboard-filters',
  'setService(\'seguridad_fisica\')',
  'matchesDashboardPeriod(o, period)',
  'Todos los servicios',
  'Pipeline activo',
  'Limpiar filtros',
  'Última actualización',
  'sourceRows = scopedOpportunities',
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

assert.ok(main.indexOf("['#/dashboard','Dashboard gerencial']") < main.indexOf("['#/dashboard2','Dashboard gerencial']"), 'Dashboard v2 tab should sit immediately after the current dashboard in nav');
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
assert.ok(!main.includes("href: '#/dashboard2'"), 'Management priority cards should not link back to the same dashboard with no visible action');
assert.ok(main.includes("targetId: 'v2-top-close-opportunities'"), 'Cerrar oportunidades top should scroll to the prioritized close opportunities section');
assert.ok(main.includes("targetId: 'v2-commercial-compliance'"), 'Recuperar bajo cumplimiento should scroll to commercial compliance');
assert.ok(main.includes("targetId: 'v2-management-alerts'"), 'Normalizar regional should scroll to management alerts / data quality');
assert.ok(main.includes("targetId: 'v2-pipeline-priorities'"), 'Proteger forecast should scroll to pipeline priorities');

console.log('manager-dashboard-v2 static checks passed');
