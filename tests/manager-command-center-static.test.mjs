import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const requiredMainMarkers = [
  'command-center-hero',
  'stage-action-table',
  'Concentración y avance del pipeline',
  'Lectura ejecutiva',
  'Riesgo / lectura',
  'Ver etapa',
  'commercial-scorecards',
  'manager-action-panel',
  'monthly-bars',
  'executive-signals',
  'status-legend',
  'pulse-header',
  'Sala de control comercial',
  'Acción gerencial sugerida',
  'Ver detalle →',
  'Pipeline por tipo de servicio',
  'ServicePipelineBreakdown',
  'pipeline activo por servicio',
  'Filtros gerenciales',
  'manager-dashboard-filters',
  'DashboardPeriodFilter',
  'Última actualización',
  'numeric-value',
  'Comando gerencial del día',
  'Prioridad gerencial de hoy',
  'operational-command-grid',
  'Sin próxima acción',
  'Gestión vencida',
  'Cierre próximo',
  'Alto valor estancado',
  'managerAlertRoute',
  "managerAlertRoute('missing')",
  "managerAlertRoute('overdue')",
  "managerAlertRoute('closing_soon')",
  "managerAlertRoute('high_value_stalled')",
  'Disciplina de agenda',
  'Forecast ponderado',
  'Cumplimiento meta mes',
  'Pipeline total',
  'Pipeline gestionado',
  'Pipeline en riesgo',
  'Top 10 oportunidades que requieren decisión',
  'Registrar seguimiento',
  'criticalOpportunityRows',
  'SortableTh',
  'sortConfig',
  'sortedCriticalOpportunityRows',
  'actionTitle',
  'actionInstruction',
  'command-priority-title',
  'manager-action-context',
];

for (const marker of requiredMainMarkers) {
  assert.ok(main.includes(marker), `main.tsx missing marker: ${marker}`);
}

const requiredCssMarkers = [
  '.command-center-hero',
  '.stage-action-summary',
  '.stage-action-table',
  '.stage-risk-pill',
  '.commercial-scorecards',
  '.commercial-scorecard',
  '.manager-action-panel',
  '.monthly-bars',
  '.executive-signals',
  '.signal-card',
  '.status-legend',
  '.pulse-header',
  '.status-pill',
  '.service-pipeline-list',
  '.service-pipeline-row',
  '.service-pipeline-meta',
  '.manager-dashboard-filters',
  '.filter-summary',
  '.numeric-value',
  'font-variant-numeric:tabular-nums',
  '.operational-command-grid',
  '.operational-card',
  '.pipeline-discipline-grid',
  '.critical-opportunities-table',
  '.health-score',
  '.command-priority-title',
  '.manager-action-context',
];

for (const marker of requiredCssMarkers) {
  assert.ok(css.includes(marker), `styles.css missing marker: ${marker}`);
}

assert.ok(!main.includes('Tabla ejecutiva por comercial'), 'Old Excel-like executive table title should not remain');
assert.ok(!main.includes('KPIs mensuales recientes'), 'Old monthly KPI table title should not remain');
assert.ok(main.includes('fmtMoneyCompact'), 'COP compact money formatting must remain');
assert.ok(main.includes('ownerRoute(o.ownerId)'), 'Commercial scorecards must preserve consultant navigation');
assert.ok(!main.includes('label="Pipeline total"'), 'Manager dashboard should not duplicate hero KPIs in a separate KPI row');
assert.ok(!main.includes('<BusinessRulesDashboard data={data} />'), 'Manager dashboard should not show business rules by area in the command center');
assert.ok(!main.includes('Panel title="Reglas comerciales por área"'), 'Business rules panel should be removed from dashboard source');
assert.ok(!main.includes('Panel title="Embudo visual de valor por etapa"'), 'Dashboard should replace the unclear visual funnel with an actionable executive table');
assert.ok(!main.includes('Math.max(58, Math.min(100, 46 + pct * 0.8))'), 'Dashboard should not rely on pseudo-funnel bar widths for executive interpretation');
assert.ok(!main.includes('Ranking por salud comercial'), 'Dashboard must not include the discarded commercial health ranking');
assert.ok(main.includes('stageActionRows'), 'Dashboard should compute actionable stage rows with diagnostic text');
assert.ok(main.includes('sortKey="value"'), 'Dashboard critical opportunities must allow sorting by value');
assert.ok(main.includes('sortKey="owner"'), 'Dashboard critical opportunities must allow sorting by commercial owner');
assert.ok(main.includes('sales-meter'), 'Monthly pulse should include a visual sales meter');
assert.ok(!main.includes('<h2>{actionText}</h2>'), 'Hero should not render the full action sentence as an oversized headline');
assert.ok(!main.includes('<strong>{actionText}</strong>'), 'Right action panel should not duplicate the hero priority sentence');
assert.ok(!main.includes('<small>Gestiones vencidas</small><strong className="numeric-value">{overdueRows.length}</strong>'), 'Executive signals should not repeat overdue count already shown in priority cards');
assert.ok(!main.includes('<small>Oportunidades sin agenda</small><strong className="numeric-value">{missingAgendaRows.length}</strong>'), 'Executive signals should not repeat missing agenda count already shown in priority cards');
assert.ok(css.includes('clamp(26px,2.4vw,38px)'), 'Command hero headline must use a readable bounded size, not billboard typography');

const heroIndex = main.indexOf('<section className="command-center-hero">');
const filtersIndex = main.indexOf('<Panel title="Filtros gerenciales">');
const priorityIndex = main.indexOf('<Panel title="Prioridad gerencial de hoy">');
assert.ok(heroIndex !== -1, 'Manager dashboard must render the top command hero');
assert.ok(filtersIndex !== -1, 'Manager dashboard must render the filters panel');
assert.ok(priorityIndex !== -1, 'Manager dashboard must render the daily priority panel');
assert.ok(heroIndex < filtersIndex, 'Filters must sit below the top command banner');
assert.ok(filtersIndex < priorityIndex, 'Filters must sit above Prioridad gerencial de hoy');

console.log('manager-command-center static checks passed');
