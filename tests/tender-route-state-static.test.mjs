import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const module = fs.readFileSync(new URL('../src/tenders/TendersModule.tsx', import.meta.url), 'utf8');

assert.ok(main.includes("normalizeTenderModuleView(hashQueryParam('view'))"), 'La ruta debe normalizar aliases históricos y usar Radar por defecto.');
for (const [view, component] of [['radar', 'TenderRadarView'], ['seguimiento', 'TenderTrackingView'], ['oportunidades', 'TenderOpportunitiesView'], ['configuracion', 'TenderConfigurationView']]) {
  assert.ok(module.includes(`props.view === '${view}' && <${component}`), `${view} debe montar su componente independiente y reiniciar su estado al cambiar de vista.`);
}
assert.ok(!main.includes('tenderDefaultFiltersForView'), 'No debe quedar estado/filtros compartidos del tablero legacy.');
assert.ok(!module.includes('renderLegacy'), 'El módulo no debe volver al tablero legacy para ninguna vista.');
assert.ok(!main.includes("useState<TenderSection | 'todas'>('hacer')"), 'Licitaciones no debe hardcodear Hacer hoy como filtro inicial para todas las subvistas.');

console.log('tender route state static checks passed');
