// AGT-003 — sección Cotizar (entrega 3; Juan, 2026-11-11): menú y ficha, editor con los dos cotizadores, cotización
// mixta guardada en el servidor, y tarifas sólo para el administrador.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadReactComponent, renderReactComponent } from './helpers/bundle-react-component.mjs';
import { getVisibleNavGroups, canAccessRoute } from '../src/navPermissions.ts';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Cotizar está en el menú comercial para quien trabaja oportunidades, después de Oportunidades', () => {
  const comercial = { id: 'c', active: true, role: 'comercial', permissions: ['modulo_oportunidades'] };
  const items = getVisibleNavGroups(comercial).flatMap(group => group.items.map(item => item.label));
  assert.ok(items.indexOf('Cotizar') === items.indexOf('Oportunidades') + 1);
  assert.equal(canAccessRoute(comercial, 'quotes'), true);
  assert.equal(canAccessRoute({ id: 'x', active: true, role: 'comercial', permissions: [] }, 'quotes'), false);
  assert.equal(canAccessRoute({ id: 'r', active: true, role: 'consulta', permissions: ['modulo_oportunidades'] }, 'quotes'), false, 'solo consulta no cotiza');
});

// Juan, 2026-11-16: "el botón cotizar en el menú izquierdo no tiene logo". Toda entrada del menú lleva su ícono.
test('cada entrada del menú lateral tiene ícono, Cotizar incluido', () => {
  const iconos = read('../src/shell/UserMenu.tsx');
  const navegacion = read('../src/navPermissions.ts');
  const destinos = [...navegacion.matchAll(/\{ href: '([^']+)', label: '[^']+', page: '\w+' \}/g)].map(m => m[1]);
  assert.ok(destinos.includes('#/cotizar'));
  for (const destino of destinos) {
    assert.ok(iconos.includes(`'${destino}': `), `${destino} no tiene ícono en NAV_ICONS`);
  }
});

test('el editor nuevo arranca con un puesto de vigilancia y calcula mientras se escribe', async () => {
  const QuotesSection = await loadReactComponent('src/vigia/QuotesSection.tsx', 'QuotesSection', 'agt003-quotes-section');
  const html = renderReactComponent(QuotesSection, { id: 'nueva', opportunities: [], navigate: () => {} });
  assert.match(html, /Nueva cotización/);
  assert.match(html, /¿Qué va a cotizar\?/);
  assert.match(html, /Vigilancia · puestos/);
  assert.match(html, /Total al mes \$/, 'el puesto de ejemplo ya muestra su total');
  assert.match(html, /Sin oportunidad: cotización rápida/);
  assert.doesNotMatch(html, /Medios tecnológicos · equipos/, 'tecnología se activa con su botón');
});

test('servidor: crear, leer, cambiar y ligar; valida con el motor antes de guardar; solo consulta no cotiza', () => {
  for (const file of ['../server/index.js', '../api/[...path].js']) {
    const src = read(file);
    for (const route of ["'GET /api/agt003/quotes'", "'GET /api/agt003/quote'", "'POST /api/agt003/quotes'", "'PUT /api/agt003/quote'"]) assert.ok(src.includes(route), route);
    const post = src.slice(src.indexOf("app.post('/api/agt003/quotes'"));
    const handler = post.slice(0, post.indexOf('\n});'));
    assert.match(handler, /requireQuoteWriter\(currentProfile\);/);
    assert.match(handler, /quoteTotals\(input, rates\); \/\/ valida todo con el motor antes de guardar nada/);
    assert.match(handler, /guard_rates: rates\.guardRates, tech_rates: rates\.techRates/, 'guarda la copia de tarifas');
    assert.match(src, /if \(isReadOnlyRole\(profile\.role\)\) \{ const error = new Error\('El perfil de solo consulta no puede cotizar\.'\)/);
    assert.match(src, /if \(quote\.created_by !== profile\.id && !globalCrmScopeRoles\.has\(profile\.role\)\) \{/);
  }
});

test('la ficha de la oportunidad tiene el botón Cotizar y la lista de sus cotizaciones', () => {
  const ui = read('../src/main.tsx');
  assert.match(ui, /go\(`#\/cotizar\/nueva\?opportunity=\$\{encodeURIComponent\(o\.id\)\}`\)\}>Cotizar<\/button>/);
  assert.match(ui, /<OpportunityQuotes opportunityId=\{o\.id\}/);
  assert.match(ui, /if \(page === 'cotizar'\) return id \? \{ page: 'quotes', id: decodeURIComponent\(id\) \} : \{ page: 'quotes' \};/);
});

// Juan, 2026-11-25: "se pueden guardar pero luego no se pueden eliminar; deberíamos tener un botón de eliminar y otro
// de asignar a oportunidad".
test('servidor: eliminar y ligar a oportunidad, sólo quien la hizo (o gerencia y administración)', () => {
  for (const file of ['../server/index.js', '../api/[...path].js']) {
    const src = read(file);
    assert.ok(src.includes("'DELETE /api/agt003/quote': ['opportunities', ACTIONS.CRM_OPPORTUNITY_EDIT]"));
    assert.ok(src.includes("'POST /api/agt003/quote/link': ['opportunities', ACTIONS.CRM_OPPORTUNITY_EDIT]"));
    const del = src.slice(src.indexOf("app.delete('/api/agt003/quote'"));
    const delHandler = del.slice(0, del.indexOf('\n});'));
    assert.match(delHandler, /requireQuoteWriter\(currentProfile\);/);
    assert.match(delHandler, /requireQuoteOwner\(existing, currentProfile, 'Sólo quien hizo la cotización la puede eliminar\.'\);/);
    assert.ok(delHandler.indexOf('requireQuoteOwner') < delHandler.indexOf(".delete()"), 'revisa el dueño antes de borrar');
    const link = src.slice(src.indexOf("app.post('/api/agt003/quote/link'"));
    const linkHandler = link.slice(0, link.indexOf('\n});'));
    assert.match(linkHandler, /requireQuoteOwner\(existing, currentProfile,/);
    assert.match(linkHandler, /ensureOpportunityAccess\(database, opportunityId, currentProfile, ACTIONS\.CRM_OPPORTUNITY_EDIT\)/);
    assert.match(linkHandler, /licitacion_publica/, 'una licitación no se liga a una cotización');
  }
});

test('la lista de cotizaciones tiene Eliminar (con confirmación) y Asignar a oportunidad', () => {
  const ui = read('../src/vigia/QuotesSection.tsx');
  assert.match(ui, /window\.confirm\(`¿Eliminar la cotización/);
  assert.match(ui, /\{ method: 'DELETE' \}/);
  assert.match(ui, /\/api\/agt003\/quote\/link\?id=/);
  assert.match(ui, />Asignar a oportunidad<\/button>/);
  assert.match(ui, />Eliminar<\/button>/);
});

// Juan, 2026-11-25: "las cotizaciones que ya tienen asignada una oportunidad deben salir de esa visual inicial y ya
// viven dentro de la oportunidad".
test('la lista de Cotizar sólo trae las sueltas; la ligada sale de la lista y vive en su oportunidad', () => {
  for (const file of ['../server/index.js', '../api/[...path].js']) {
    const src = read(file);
    const get = src.slice(src.indexOf("app.get('/api/agt003/quotes'"));
    const handler = get.slice(0, get.indexOf('\n});'));
    assert.match(handler, /query = query\.eq\('opportunity_id', opportunityId\);\n    \} else \{[\s\S]*?query = query\.is\('opportunity_id', null\);/);
  }
  const ui = read('../src/vigia/QuotesSection.tsx');
  assert.match(ui, /setQuotes\(list => \(list \|\| \[\]\)\.filter\(item => item\.id !== r\.id\)\);/);
  assert.match(ui, /Las que ya tienen una se ven dentro de su oportunidad\./);
});
