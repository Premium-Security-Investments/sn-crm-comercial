import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

// Locate the ternary that replaces the private "grid three" summary for licitaciones.
const ternaryStart = main.indexOf("service_type_code === 'licitacion_publica' ? <>");
assert.ok(ternaryStart >= 0, 'Debe existir una rama pública dedicada del resumen para licitaciones.');
const privateBranchMarker = main.indexOf('</> : <section className="opportunity-insight-grid opportunity-priority-grid"', ternaryStart);
assert.ok(privateBranchMarker > ternaryStart, 'La rama pública debe cerrar antes de la rama privada del grid.');
const publicBlock = main.slice(ternaryStart, privateBranchMarker);
const privateBranchStart = privateBranchMarker + '</> : '.length;
const privateBranchEnd = main.indexOf('</section>}', privateBranchStart) + '</section>}'.length;
const privateBlock = main.slice(privateBranchStart, privateBranchEnd);

// Public data is intentionally consolidated to avoid four oversized, repetitive groups.
assert.match(publicBlock, /<Panel title="Resumen de la oportunidad" className="tender-opportunity-summary-panel">/, 'Debe existir el resumen público consolidado y compacto.');
for (const duplicatedGroup of ['Proceso oficial', 'Cronograma y cuantía', 'Gestión interna', 'Expediente y análisis']) {
  assert.doesNotMatch(publicBlock, new RegExp(`<Panel title="${duplicatedGroup}"`), `No debe reaparecer el grupo redundante "${duplicatedGroup}".`);
}
assert.doesNotMatch(publicBlock, /tender-opportunity-technical/, 'Los datos técnicos internos no deben aparecer en la vista operativa.');

// The governed public fields (compact summary, 2026-10): entity, owner and amount head the page once (the hero);
// the summary adds only the official close and the process facts (service, sector, city), never repeating them.
const heroStart = main.indexOf('id="tender-summary"');
const hero = main.slice(heroStart, main.indexOf('</div>', main.indexOf('className="hero"', heroStart)));
assert.match(hero, /\{o\.company_name\}/, 'La entidad encabeza la ficha.');
assert.match(hero, /o\.owner_name/, 'El responsable encabeza la ficha.');
assert.match(hero, /fmtMoney\(o\.offer_value\)/, 'La cuantía encabeza la ficha.');
assert.match(publicBlock, /<small>Cierre oficial<\/small>/, 'El resumen público debe incluir el cierre oficial.');
for (const field of ['o.service_type_name', 'o.economic_sector', 'o.quote_city']) {
  assert.ok(publicBlock.includes(field), `El resumen público debe incluir ${field}.`);
}
for (const repeated of ['o.company_name', 'o.owner_name', 'o.offer_value']) {
  assert.ok(!publicBlock.includes(repeated), `El resumen público no debe repetir ${repeated}, que ya encabeza la ficha.`);
}

// CRM-only fields must not leak into the public branch.
for (const label of ['Tipo de cliente', 'Decisor', 'Correo decisor', 'Teléfono', 'Cierre estimado']) {
  assert.doesNotMatch(publicBlock, new RegExp(`label="${label}"`), `El resumen público no debe mostrar "${label}".`);
}

// The private branch (non-licitación opportunities) now shows the four priority cards.
for (const label of ['Próxima gestión', 'Último seguimiento', 'Cierre estimado', 'Contacto decisor']) {
  assert.match(privateBlock, new RegExp(`<small>${label}</small>`), `El resumen prioritario debe incluir la tarjeta "${label}".`);
}
assert.doesNotMatch(privateBlock, /<Panel title="Proceso oficial"/, 'El grid privado no debe reorganizarse en los grupos públicos.');

for (const hidden of ['Snapshot', 'Productor', 'Estado técnico']) {
  assert.doesNotMatch(publicBlock, new RegExp(`label="${hidden}"`), `El resumen público no debe mostrar "${hidden}".`);
}

// Postgres date-only values must use the timezone-safe formatter; the generic timestamp
// formatter shifts 2026-08-06 to 05/08 in America/Bogota.
assert.match(publicBlock, /<strong>\{fmtDateOnly\(o\.expected_close_date\)\}<\/strong>/);

// AGT-002 Task 6 · la vigencia temporal aparece una sola vez, en el banner del shell.
assert.doesNotMatch(publicBlock, /label="Días restantes"/, 'El resumen público no debe repetir la vigencia como conteo regresivo.');
assert.doesNotMatch(main, /tenderDaysRemainingLabel/, 'El helper que imprimía "Vencida" fuera del banner debe desaparecer.');
assert.doesNotMatch(publicBlock, /\bVigente\b|\bVencida\b/, 'Sólo TenderDetailNavigation escribe Vigente/Vencida.');
assert.match(
  main,
  /<TenderDetailNavigation[^>]*expectedCloseDate=\{o\.expected_close_date\}/,
  'La vigencia se computa una sola vez, en el shell, desde la misma fecha de cierre oficial.',
);

console.log('tender summary public fields passed');
