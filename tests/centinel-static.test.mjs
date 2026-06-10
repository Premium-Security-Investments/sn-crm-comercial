import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const mainMarkers = [
  "'centinel'",
  "#/vig-ia",
  "Vig-IA — Reportes gerenciales",
  "Vig-IA — Reportes gerenciales asistidos",
  "Selecciona un reporte gerencial",
  "Módulo en evolución",
  "Pregunta opcional",
  "function CentinelAssistant",
  "Generar reporte manual",
  "centinelQuickActionGroups",
  "Consultas comerciales",
  "Gestión gerencial",
  "Licitaciones",
  "Estado de datos",
  "Reintentar carga",
  "centinel-chip-active",
  "ownerSummaryRows",
  "goalComplianceRows",
  "interpretCentinelQuery",
  "CentinelResult",
  "oportunidades sin agenda",
  "pipeline por etapa",
  "cumplimiento de metas",
  "Clientes en sustentación",
  "isLargeOpportunityQuery",
  "isRiskFollowUpQuery",
  "Oportunidades de mayor valor",
  "Seguimiento en riesgo",
  "Licitaciones para revisar hoy",
  "Licitaciones de alto valor sin decisión",
  "Licitaciones convertidas",
  "isTenderQuery",
  "interpretTenderCentinelQuery",
  "centinelTenderPayload",
  "Radar de licitaciones no disponible",
  "Abrir radar de licitaciones",
  "Solo lectura",
];

for (const marker of mainMarkers) {
  assert.ok(main.includes(marker), `main.tsx missing marker: ${marker}`);
}

const cssMarkers = [
  '.centinel-dashboard',
  '.centinel-hero',
  '.centinel-orb',
  '.centinel-assisted-copy',
  '.centinel-manual-query',
  '.centinel-chip',
  '.centinel-chip-active',
  '.centinel-action-group',
  '.centinel-data-status',
  '.centinel-result-grid',
  '.centinel-result-table',
];

for (const marker of cssMarkers) {
  assert.ok(css.includes(marker), `styles.css missing marker: ${marker}`);
}

console.log('centinel static checks passed');
