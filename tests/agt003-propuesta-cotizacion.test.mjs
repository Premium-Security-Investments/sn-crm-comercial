// AGT-003 — propuesta en PDF y lo que la cotización le pasa a la oportunidad y al formulario de cierre (entrega 4;
// Juan, 2026-11-16).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { quoteTotals } from '../src/vigia/quote-engine.js';
import { closureFormMoney } from '../src/vigia/closure-form.js';
import { closurePostsFromQuote, daysLabel, opportunityValueFromQuote, proposalContent } from '../src/vigia/quote-proposal.js';
import { buildProposalPdf } from '../src/vigia/quote-proposal-pdf.ts';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const ALL_DAYS = ['lunes_a_viernes', 'sabados', 'domingos', 'festivos'];
const guardPosts = [
  { name: 'Portería principal', start: '0600', end: '0600', dayTypes: ALL_DAYS, guards: 3, modality: 'con_arma' },
  { name: 'Recepción', start: '0700', end: '1900', dayTypes: ['lunes_a_viernes', 'sabados'], guards: 1, modality: 'sin_arma' },
  { name: '', start: '1900', end: '0600', dayTypes: ALL_DAYS, guards: 1, modality: 'canino' },
];
const techLines = [
  { description: 'Cámara ANPR DS-TCG405', category: 'equipo', quantity: 2, unitCost: 3500000 },
  { description: 'Tubería y cableado', category: 'insumo', quantity: 1, unitCost: 1800000 },
  { description: '', category: 'mano_de_obra', quantity: 1, unitCost: 2400000 },
];

test('valor para la oportunidad: vigilancia mensual, tecnología total, mixta con la tecnología en 12 meses (antes de IVA)', () => {
  const guard = quoteTotals({ guardPosts });
  assert.deepEqual(opportunityValueFromQuote(guard).value, guard.monthly.subtotal);
  assert.equal(opportunityValueFromQuote(guard).basis, 'mensual');

  const tech = quoteTotals({ techLines });
  assert.equal(opportunityValueFromQuote(tech).value, tech.oneTime.subtotal);
  assert.equal(opportunityValueFromQuote(tech).basis, 'total');

  const mixed = quoteTotals({ guardPosts, techLines });
  const result = opportunityValueFromQuote(mixed);
  assert.equal(result.basis, 'mixta');
  assert.equal(result.value, mixed.monthly.subtotal + Math.round(mixed.oneTime.subtotal / 12));
  assert.match(result.explanation, /repartida en 12 meses/);

  assert.equal(opportunityValueFromQuote(quoteTotals({})), null);
});

test('los puestos pasan al formulario de cierre con sus horas, días, guardas y valor, y el formulario llega al mismo total', () => {
  const totals = quoteTotals({ guardPosts });
  const posts = closurePostsFromQuote(guardPosts, totals.posts);
  assert.equal(posts.length, 3);
  assert.deepEqual(
    { start: posts[0].shift_start, end: posts[0].shift_end, days: posts[0].days_per_month, guards: posts[0].guards_required, armed: posts[0].armed, value: posts[0].service_value },
    { start: '06:00', end: '06:00', days: 30, guards: 3, armed: true, value: totals.posts[0].subtotal },
  );
  assert.match(posts[0].description, /Portería principal · Con arma · 24 horas · Todos los días/);
  assert.equal(posts[1].days_per_month, 24);
  assert.equal(posts[1].armed, false);
  assert.match(posts[2].description, /^Puesto 3 · Canino/, 'un puesto sin nombre recibe uno');
  assert.match(posts[2].notes, /canina/);
  // La medianoche del formulario es 00:00 (el campo de hora no acepta 24:00).
  assert.equal(closurePostsFromQuote([{ ...guardPosts[1], start: '1800', end: '2400' }], quoteTotals({ guardPosts: [{ ...guardPosts[1], start: '1800', end: '2400' }] }).posts)[0].shift_end, '00:00');
  // Misma regla de dinero: el formulario (AIU 10 %, IVA 19 % sobre el AIU) da el mismo total que la cotización.
  assert.equal(closureFormMoney({ posts }).total, totals.monthly.total);
});

test('la propuesta nunca muestra el costo ni el margen, y sus condiciones dependen de lo que se cotiza', () => {
  const totals = quoteTotals({ guardPosts, techLines });
  const content = proposalContent({ quote: { id: 'abcd1234-ef56-4000-8000-000000000000', client_name: 'Cliente S.A.S.', title: 'Sede norte', guardPosts, techLines, totals }, today: '2026-11-16', seller: { name: 'Comercial Uno', email: 'uno@example.com' } });
  assert.equal(content.number, 'SN-COT-ABCD1234');
  assert.equal(content.date, '16 de noviembre de 2026');
  assert.equal(content.validUntil, '16 de diciembre de 2026');
  assert.equal(content.company.tagline, 'Sabemos de seguridad');
  assert.ok(!JSON.stringify(content).includes('3500000'), 'el costo unitario no sale');
  assert.ok(!/margen|costo/i.test(JSON.stringify(content)), 'ni la palabra margen ni costo');
  assert.equal(content.tech.rows[2].description, 'Instalación y programación', 'una línea sin descripción toma el nombre de su tipo');
  assert.equal(content.guard.total, totals.monthly.total);
  assert.equal(content.tech.total, totals.oneTime.total);
  const conditions = content.conditions.join('\n');
  for (const expected of [/válida por 30 días/, /mes vencido/, /a 30 días/, /50 % de anticipo/, /contra entrega e instalación/, /15 días hábiles/, /fabricante, mínimo un año/]) assert.match(conditions, expected);

  const guardOnly = proposalContent({ quote: { id: 'x', guardPosts, techLines: [], totals: quoteTotals({ guardPosts }) }, today: '2026-11-16' });
  assert.equal(guardOnly.tech, null);
  assert.doesNotMatch(guardOnly.conditions.join('\n'), /anticipo|garantía/);
  assert.equal(guardOnly.client, 'Cliente');
  assert.equal(daysLabel(['lunes_a_viernes', 'sabados']), 'Lunes a viernes y sábados');
});

test('el PDF sale con el logo, el cliente, los valores y el pie numerado', async () => {
  const totals = quoteTotals({ guardPosts, techLines });
  const content = proposalContent({ quote: { id: 'abcd1234-ef56-4000-8000-000000000000', client_name: 'Cliente Ñandú S.A.S. 🚀', title: null, guardPosts, techLines, totals }, today: '2026-11-16', seller: { name: 'Comercial Uno', email: 'uno@example.com' } });
  const logo = readFileSync(new URL('../public/marca/logo-seguridad-nacional.pdf', import.meta.url));
  const bytes = await buildProposalPdf(content, logo);
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
  const { text, numpages } = await pdfParse(Buffer.from(bytes));
  assert.ok(numpages >= 1);
  assert.match(text, /PROPUESTA COMERCIAL/);
  assert.match(text, /Cliente Ñandú S\.A\.S\./, 'lo que la fuente no puede escribir (el emoji) se quita sin romper el PDF');
  assert.match(text, /Total mensual/);
  assert.match(text, new RegExp(`\\$ ${totals.monthly.total.toLocaleString('es-CO').replace(/\./g, '\\.')}`));
  assert.match(text, /NIT 891\.408\.256-4/);
  assert.match(text, new RegExp(`Página 1 de ${numpages}`));
  assert.doesNotMatch(text, /3\.500\.000/, 'el costo no aparece');

  // Sin logo (no se pudo bajar), el nombre va en texto y el PDF igual sale.
  const plain = await pdfParse(Buffer.from(await buildProposalPdf(content, null)));
  assert.match(plain.text, /Sabemos de seguridad/);
});

test('servidor: pasar el valor a la oportunidad, igual en los dos backends, sólo con oportunidad abierta', () => {
  for (const file of ['../server/index.js', '../api/[...path].js']) {
    const text = read(file);
    assert.match(text, /'POST \/api\/agt003\/quote\/use-in-opportunity': \['opportunities', ACTIONS\.CRM_OPPORTUNITY_EDIT\]/, file);
    const body = /app\.post\('\/api\/agt003\/quote\/use-in-opportunity'[\s\S]*?\n\}\);/.exec(text)[0];
    assert.match(body, /requireQuoteWriter\(currentProfile\)/, `${file}: solo consulta no cambia valores`);
    assert.match(body, /ensureOpportunityAccess\(database, quote\.opportunity_id, currentProfile, ACTIONS\.CRM_OPPORTUNITY_EDIT\)/, file);
    assert.match(body, /CHAT_CLOSED_STAGES\.has\(opportunity\.stage_code\)/, `${file}: no toca oportunidades cerradas`);
    assert.match(body, /licitacion_publica/, `${file}: ni licitaciones`);
    assert.match(body, /opportunityValueFromQuote\(quote\.totals\)/, `${file}: con la cotización guardada`);
  }
});

test('pantallas: la cotización descarga la propuesta y pasa el valor; el formulario de cierre trae los puestos', () => {
  const quotes = read('../src/vigia/QuotesSection.tsx');
  assert.match(quotes, /await import\('\.\/quote-proposal-pdf'\)/, 'pdf-lib se carga sólo al descargar');
  assert.match(quotes, /Descargar propuesta \(PDF\)/);
  assert.match(quotes, /Pasar este valor a la oportunidad/);
  assert.match(quotes, /\/api\/agt003\/quote\/use-in-opportunity/);
  const closure = read('../src/vigia/ClosureFormPanel.tsx');
  assert.match(closure, /Traer puestos de la cotización/);
  assert.match(closure, /closurePostsFromQuote\(found\.guardPosts, found\.totals\.posts\)/);
  assert.match(closure, /basis\.monthly && <button/, 'en proyectos (valor total) no aplica');
  const main = read('../src/main.tsx');
  assert.match(main, /<QuotesSection [^>]*seller=\{\{ name: data\.currentProfile\.full_name/);
});

// Juan (2026-11-16): "luego que me da el precio, ¿qué se supone que debo hacer? No se descarga nada ni queda prueba".
test('después del precio, el siguiente paso está a la vista y no se pierde lo cotizado', async () => {
  const { loadReactComponent, renderReactComponent } = await import('./helpers/bundle-react-component.mjs');
  const QuotesSection = await loadReactComponent('src/vigia/QuotesSection.tsx', 'QuotesSection', 'agt003-quotes-section-entrega');
  const html = renderReactComponent(QuotesSection, { id: 'nueva', opportunities: [], navigate: () => {} });
  assert.match(html, /class="panel quote-summary is-sticky is-dirty"/, 'el resumen queda pegado abajo');
  assert.match(html, /Sin guardar/);
  assert.match(html, /Siguiente paso: guárdela y descargue la propuesta/);
  // El botón principal (el primero) es guardar y descargar; guardar solo es secundario.
  assert.match(html, /<div class="formactions"><button type="button">Guardar y descargar propuesta \(PDF\)<\/button><button type="button" class="secondary">Solo guardar<\/button>/);
  const quotes = read('../src/vigia/QuotesSection.tsx');
  assert.match(quotes, /addEventListener\('beforeunload', warn\)/, 'avisa antes de cerrar con trabajo sin guardar');
  assert.match(quotes, /¿No se descargó\? Ábrala aquí/);
  assert.match(read('../src/styles.css'), /\.quote-summary\.is-sticky\{position:sticky;bottom:12px/);
});
