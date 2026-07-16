import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const nav = readFileSync(new URL('../src/navPermissions.ts', import.meta.url), 'utf8');
const radarSource = readFileSync(new URL('../src/tenders/TenderRadarView.tsx', import.meta.url), 'utf8');
const radarUtilsSource = readFileSync(new URL('../src/tenders/radarUtils.ts', import.meta.url), 'utf8');
const tabsSource = readFileSync(new URL('../src/tenders/components/TenderModuleTabs.tsx', import.meta.url), 'utf8');

assert.doesNotMatch(main, /tenderSubnav|nav-subitems/, 'El sidebar no debe duplicar sublinks de Licitaciones.');
assert.match(nav, /title: 'Licitaciones'[\s\S]{0,220}href: '#\/tenders\?view=radar', label: 'Radar de oportunidades', page: 'tenders'/, 'El catálogo central debe conservar un único enlace padre hacia Radar.');
assert.match(nav, /tenders: 'licitaciones'/, 'Licitaciones debe estar protegida por su capability central.');
assert.match(nav, /\.filter\(item => canAccessRoute\(profile, item\.page\)\)/, 'El enlace de Licitaciones debe filtrarse antes de renderizarse según capability.');
assert.match(main, /item\.page === 'tenders' \? 'nav-parent '/, 'El renderer genérico debe mantener activo el padre de Licitaciones para cualquiera de sus subvistas.');
assert.doesNotMatch(main, /href="#\/tenders\?view=radar"/, 'main.tsx no debe duplicar el enlace centralizado de Licitaciones.');
assert.match(tabsSource, /tender-module-tabs/, 'El módulo debe proporcionar la navegación interna de Licitaciones.');
for (const label of ['Radar de oportunidades', 'Seguimiento', 'Expedientes', 'Perfiles de búsqueda']) {
  assert.match(tabsSource, new RegExp(label), `Las tabs del módulo deben incluir ${label}.`);
}
assert.match(radarSource, /Región SN/, 'El Radar debe exponer un filtro Región SN');
assert.match(radarUtilsSource, /BOG - Bogotá\/Cundinamarca/, 'El Radar debe contemplar regiones donde SN tiene presencia');
assert.match(radarUtilsSource, /tenderMatchesRegion\(tender, filters\.region\)/, 'El filtro regional debe aplicarse a la lista de licitaciones desde el helper de filtro compartido.');
assert.doesNotMatch(radarSource, /TenderUnifiedBoard|renderLegacy/, 'Radar no debe delegar en el tablero unificado ni en el renderer legado.');

console.log('Tender module UI expectations passed');
