import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

assert.ok(main.includes('function tenderDefaultFiltersForView'), 'Debe existir helper para inicializar filtros según vista de Licitaciones.');
assert.ok(main.includes("radar: { section: 'todas'"), 'Radar debe iniciar sin filtro de sección para no aparecer vacío al entrar por URL directa.');
assert.ok(main.includes("seguimiento: { section: 'todas', internalStatus: 'en_revision'"), 'Seguimiento debe iniciar con estado interno en revisión, no con sección Hacer hoy.');
assert.ok(main.includes("expedientes: { section: 'todas', internalStatus: 'convertida_oportunidad'"), 'Expedientes debe iniciar con convertidas/listas para expediente.');
assert.ok(main.includes('setRouteViewDefaults(tenderView)'), 'TendersRadar debe resetear filtros al cambiar view por hash directo.');
assert.ok(!main.includes("useState<TenderSection | 'todas'>('hacer')"), 'Licitaciones no debe hardcodear Hacer hoy como filtro inicial para todas las subvistas.');

console.log('tender route state static checks passed');
