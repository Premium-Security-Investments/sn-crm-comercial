import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const source = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const radarSource = readFileSync(new URL('../src/tenders/TenderRadarView.tsx', import.meta.url), 'utf8');
const radarUtilsSource = readFileSync(new URL('../src/tenders/radarUtils.ts', import.meta.url), 'utf8');
const tabsSource = readFileSync(new URL('../src/tenders/components/TenderModuleTabs.tsx', import.meta.url), 'utf8');

assert.doesNotMatch(source, /tenderSubnav/, 'El sidebar no debe conservar un array de subrutas de Licitaciones.');
assert.doesNotMatch(source, /nav-subitems/, 'El sidebar no debe renderizar sublinks duplicados de Licitaciones.');
assert.match(source, /href="#\/tenders\?view=radar"/, 'El sidebar compacto debe conservar un único enlace padre hacia Radar.');
assert.match(source, /className=\{`nav-parent \$\{route\.page === 'tenders' \? 'active' : ''\}`\}/, 'El enlace padre debe quedar activo para cualquiera de las subvistas de Licitaciones.');
assert.match(tabsSource, /tender-module-tabs/, 'El módulo debe proporcionar la navegación interna de Licitaciones.');
for (const label of ['Radar de oportunidades', 'Seguimiento', 'Expedientes', 'Perfiles de búsqueda']) {
  assert.match(tabsSource, new RegExp(label), `Las tabs del módulo deben incluir ${label}.`);
}
assert.match(radarSource, /Región SN/, 'El Radar debe exponer un filtro Región SN');
assert.match(radarUtilsSource, /BOG - Bogotá\/Cundinamarca/, 'El Radar debe contemplar regiones donde SN tiene presencia');
assert.match(radarUtilsSource, /tenderMatchesRegion\(tender, filters\.region\)/, 'El filtro regional debe aplicarse a la lista de licitaciones desde el helper de filtro compartido.');
assert.doesNotMatch(radarSource, /TenderUnifiedBoard|renderLegacy/, 'Radar no debe delegar en el tablero unificado ni en el renderer legado.');

console.log('Tender module UI expectations passed');
