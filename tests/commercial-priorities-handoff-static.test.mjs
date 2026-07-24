import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const priorities = fs.readFileSync(new URL('../src/vigia/VigiaCommercial.tsx', import.meta.url), 'utf8');

for (const mapping of [
  /label: 'Valor en riesgo'[^\n]*priorityStatus: 'risk'/,
  /label: 'Vencidas'[^\n]*priorityStatus: 'overdue'/,
  /label: 'Sin agenda'[^\n]*priorityStatus: 'missing'/,
  /label: 'Sin seguimiento'[^\n]*priorityStatus: 'risk'/,
]) {
  assert.match(main, mapping, `falta mapeo contextual ${mapping}`);
}

assert.match(main, /v2RiskSummaryCards\.map\(card => <a[\s\S]{0,220}href=\{prioritiesHashFromDashboard\(card\.priorityStatus, priorityLinkFilters\)\}/, 'cada tarjeta de riesgo debe conservar categoría y filtros mediante el helper gobernado');
assert.match(main, /href=\{prioritiesHashFromDashboard\('missing', priorityLinkFilters\)\}[^\n]*<small>Disciplina de agenda<\/small>/, 'Disciplina de agenda debe abrir la intervención primaria Sin agenda');
assert.ok(main.includes("import { prioritiesHashFromDashboard } from './vigia/priority-filters.js';"), 'Dashboard debe usar el contrato compartido de URL');
assert.ok(main.includes('const priorityLinkFilters = { owner, regional, stage, service, segment: customerSegmentFilter };'), 'el handoff sólo debe transportar los cinco filtros autorizados');
assert.doesNotMatch(main, /priorityLinkFilters\s*=\s*\{[^}]*\b(?:q|period|active|onlyActive)\b/s, 'búsqueda, periodo y active no deben cruzar a Prioridades');

for (const marker of [
  'Contexto recibido del Dashboard',
  'priorityContextSummary',
  'priority-context-summary',
  'setLinkedContext(false)',
  '>Limpiar contexto<',
]) {
  assert.ok(priorities.includes(marker), `Prioridades debe exponer el contexto recibido: ${marker}`);
}

const handoffFragments = [
  ...main.matchAll(/prioritiesHashFromDashboard\([^\n]+/g),
  ...priorities.matchAll(/priority-context-summary[^\n]*/g),
].map(match => match[0]).join('\n');
assert.doesNotMatch(handoffFragments, /api\(|fetch\(|POST|PUT|PATCH|DELETE/, 'seguir o limpiar el handoff no debe ejecutar escrituras');

console.log('Dashboard → Prioridades contextual handoff static contract passed');
