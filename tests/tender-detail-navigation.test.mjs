import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const component = readFileSync(new URL('../src/tenders/components/TenderDetailNavigation.tsx', import.meta.url), 'utf8');
const navigationState = readFileSync(new URL('../src/tenders/detailNavigationState.ts', import.meta.url), 'utf8');
const decisionPanel = readFileSync(new URL('../src/tenders/components/TenderGoNoGoDecisionPanel.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const corpus = `${component}\n${navigationState}\n${main}`;

for (const id of ['tender-summary', 'tender-document-review', 'tender-analysis', 'tender-decision', 'tender-preparation', 'tender-follow-up']) {
  assert.match(corpus, new RegExp(`id=[\\"'{]*${id}|['\\"]${id}['\\"]`), `falta ancla ${id}`);
  assert.match(navigationState, new RegExp(id), `la navegación debe apuntar a ${id}`);
}
for (const label of ['Resumen', 'Documentos', 'Análisis', 'Decisión', 'Preparación', 'Seguimiento']) assert.match(navigationState, new RegExp(label));
assert.doesNotMatch(component, /tender-detail-breadcrumb|Ruta del expediente|Línea de avance/);
assert.match(component, /← Oportunidades/);
assert.match(component, /aria-label="Abrir fuente oficial en una pestaña nueva"/);
assert.match(component, /aria-label="Secciones del expediente"/);
assert.match(component, /IntersectionObserver/);
assert.match(component, /new Map<HTMLElement, number>/, 'El observer debe conservar la visibilidad acumulada de todas las secciones.');
assert.match(component, /aria-current=\{activeSection === id \? 'location' : undefined\}/);
assert.match(component, /tender-detail-indicator/);
assert.match(component, /scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/);
assert.match(component, /sourceUrl/);
assert.match(component, /observations/);
assert.match(component, /Link fuente:/, 'el URL histórico sólo debe ser fallback explícito');
assert.match(main, /<TenderDetailNavigation/);
assert.match(main, /statusSnapshot=\{tenderNavigationSnapshot\}/);
assert.match(main, /onNavigationStateChanged/);
assert.match(main, /importError: Boolean\(data\.import_error\)/, 'La navegación debe conservar fallos de importación documentales persistidos.');
assert.match(decisionPanel, /onNavigationStateChanged/);
assert.doesNotMatch(main, /\/api\/tender-opportunities[^'"`]*opportunity_id/, 'no debe agregarse una solicitud duplicada');
assert.match(server, /from\('psi_public_tenders'\)\.select\('url'\)\.eq\('converted_opportunity_id', id\)/);
assert.match(server, /opportunity\.source_url = tenderSource\?\.url \|\| getTenderSourceUrlFromOpportunity\(opportunity\)/);
assert.match(styles, /\.tender-detail-navigation\{[^}]*grid-template-columns:/);
assert.match(styles, /\.tender-detail-sections\{[^}]*overflow-x:auto/);
for (const tone of ['ready', 'attention', 'error', 'unknown']) assert.match(styles, new RegExp(`\\.tender-detail-indicator\\.tone-${tone}`));
assert.match(styles, /scroll-margin-top/);

console.log('tender detail navigation shell passed');
