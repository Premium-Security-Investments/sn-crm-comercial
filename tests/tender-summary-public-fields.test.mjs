import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

// Locate the ternary that replaces the private "grid three" summary for licitaciones.
const ternaryStart = main.indexOf("service_type_code === 'licitacion_publica' ? <>");
assert.ok(ternaryStart >= 0, 'Debe existir una rama pública dedicada del resumen para licitaciones.');
const privateBranchMarker = main.indexOf('</> : <div className="grid three">', ternaryStart);
assert.ok(privateBranchMarker > ternaryStart, 'La rama pública debe cerrar antes de la rama privada del grid.');
const publicBlock = main.slice(ternaryStart, privateBranchMarker);
const privateBranchStart = privateBranchMarker + '</> : '.length;
const privateBranchEnd = main.indexOf('</div>}', privateBranchStart) + '</div>}'.length;
const privateBlock = main.slice(privateBranchStart, privateBranchEnd);

// Public data is intentionally consolidated to avoid four oversized, repetitive groups.
assert.match(publicBlock, /<Panel title="Resumen de la oportunidad">/, 'Debe existir el resumen público consolidado.');
for (const duplicatedGroup of ['Proceso oficial', 'Cronograma y cuantía', 'Gestión interna', 'Expediente y análisis']) {
  assert.doesNotMatch(publicBlock, new RegExp(`<Panel title="${duplicatedGroup}"`), `No debe reaparecer el grupo redundante "${duplicatedGroup}".`);
}
assert.doesNotMatch(publicBlock, /tender-opportunity-technical/, 'Los datos técnicos internos no deben aparecer en la vista operativa.');

// The required labels must exist in the public branch.
// AGT-002 Task 6: the seven governed fields are the whole public summary. "Días restantes" was
// removed because its overdue branch printed "Vencida" a second time, next to the single
// Vigente/Vencida badge owned by TenderDetailNavigation.
for (const label of ['Entidad', 'Servicio', 'Sector', 'Ciudad', 'Cuantía', 'Cierre oficial', 'Responsable']) {
  assert.match(publicBlock, new RegExp(`label="${label}"`), `El resumen público debe incluir el campo "${label}".`);
}

// CRM-only fields must not leak into the public branch.
for (const label of ['Tipo de cliente', 'Decisor', 'Correo decisor', 'Teléfono', 'Cierre estimado']) {
  assert.doesNotMatch(publicBlock, new RegExp(`label="${label}"`), `El resumen público no debe mostrar "${label}".`);
}

// The private branch (non-licitación opportunities) must keep exactly its current fields, intact.
for (const label of [
  'Servicio', 'Tipo de cliente', 'Área comercial', 'Fecha creación', 'Cierre estimado',
  'Próxima acción', 'Estado próxima gestión', 'Días sin seguimiento', 'Decisor', 'Correo decisor', 'Teléfono',
]) {
  assert.match(privateBlock, new RegExp(`label="${label}"`), `El grid privado debe conservar el campo "${label}".`);
}
assert.doesNotMatch(privateBlock, /<Panel title="Proceso oficial"/, 'El grid privado no debe reorganizarse en los grupos públicos.');

for (const hidden of ['Snapshot', 'Productor', 'Estado técnico']) {
  assert.doesNotMatch(publicBlock, new RegExp(`label="${hidden}"`), `El resumen público no debe mostrar "${hidden}".`);
}

// Postgres date-only values must use the timezone-safe formatter; the generic timestamp
// formatter shifts 2026-08-06 to 05/08 in America/Bogota.
assert.match(publicBlock, /label="Cierre oficial" value=\{fmtDateOnly\(o\.expected_close_date\)\}/);

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
