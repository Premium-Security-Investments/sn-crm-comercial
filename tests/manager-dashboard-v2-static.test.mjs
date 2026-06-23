import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const requiredMainMarkers = [
  "'dashboard2'",
  "if (page === 'dashboard2') return { page: 'dashboard2' };",
  "if (route.page === 'dashboard2') return 'Dashboard gerencial 2';",
  "['#/dashboard2','Dashboard gerencial 2']",
  "if (route.page === 'dashboard2') return <ManagerDashboardV2 data={data} />;",
  'function ManagerDashboardV2({ data }: { data: Bootstrap })',
  'dashboard-v2',
  'gerencial-v2-hero',
  'Dashboard Gerencial 2',
  'v2ServiceName',
  'Resumen ejecutivo · ',
  'Datos CRM en vivo',
  'v2HeroTitle',
  'v2HeroSubtitle',
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
  'Seguridad Física',
  'Área activa: Seguridad Física',
  'Corte 2026',
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
];

const requiredCssMarkers = [
  '.dashboard-v2',
  '.gerencial-v2-hero',
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
];

for (const marker of requiredMainMarkers) {
  assert.ok(main.includes(marker), `main.tsx missing dashboard v2 marker: ${marker}`);
}

for (const marker of requiredCssMarkers) {
  assert.ok(css.includes(marker), `styles.css missing dashboard v2 marker: ${marker}`);
}

assert.ok(main.indexOf("['#/dashboard','Dashboard gerencial']") < main.indexOf("['#/dashboard2','Dashboard gerencial 2']"), 'Dashboard v2 tab should sit immediately after the current dashboard in nav');
assert.ok(main.indexOf('Panel title="Cumplimiento comercial"') < main.indexOf('Panel title="Pipeline / prospección activa"'), 'Dashboard v2 should prioritize compliance before prospecting detail');
assert.ok(main.indexOf('Panel title="Pipeline / prospección activa"') < main.indexOf('Panel title="Top oportunidades de cierre"'), 'Dashboard v2 should end with prioritized close opportunities');
assert.ok(!main.includes('Proyección 2026 — tabla completa'), 'Dashboard v2 should not copy the full PowerPoint tables into the first level');

console.log('manager-dashboard-v2 static checks passed');
