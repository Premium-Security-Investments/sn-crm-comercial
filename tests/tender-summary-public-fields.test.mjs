import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';

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
assert.match(publicBlock, /<details className="tender-opportunity-technical">/, 'Los datos de auditoría deben conservarse en un detalle secundario.');

// The required labels must exist in the public branch.
for (const label of ['Entidad', 'Cierre oficial', 'Días restantes', 'Snapshot', 'Productor']) {
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

// Snapshot / Productor must be sourced from the current tender analysis (already used for "Productor real").
assert.match(publicBlock, /tenderAnalysis\?\.snapshot_id/, 'Snapshot debe venir del análisis vigente.');
assert.match(publicBlock, /tenderAnalysisMethodLabel\(tenderAnalysis\.producer\)/, 'Productor debe reutilizar el humanizador existente del productor.');
assert.match(main, /import\s*\{[^}]*tenderAnalysisMethodLabel[^}]*\}\s*from\s*'\.\/tenders\/tenderDecisionBrief'/, 'main.tsx debe importar el humanizador de productor existente.');

// Días restantes must be computed from the same date shown as "Cierre oficial" (expected_close_date).
// Postgres date-only values must use the timezone-safe formatter; the generic timestamp
// formatter shifts 2026-08-06 to 05/08 in America/Bogota.
assert.match(publicBlock, /label="Cierre oficial" value=\{fmtDateOnly\(o\.expected_close_date\)\}/);
assert.match(publicBlock, /label="Días restantes" value=\{tenderDaysRemainingLabel\(o\.expected_close_date\)\}/);
assert.match(main, /function tenderDaysRemainingLabel\(/, 'Debe existir el helper de días restantes.');

// Verify the days-remaining helper behaves correctly by extracting and evaluating it directly with esbuild.
const helperSource = main.split('\n').find(line => line.trim().startsWith('function tenderDaysRemainingLabel('));
assert.ok(helperSource, 'Debe poder extraerse el cuerpo del helper de días restantes.');
const helperModule = `${helperSource}\nexport { tenderDaysRemainingLabel };\n`;
const built = buildSync({ stdin: { contents: helperModule, loader: 'ts', resolveDir: process.cwd() }, bundle: false, platform: 'node', format: 'esm', write: false });
const helperUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].contents).toString('base64')}`;
const { tenderDaysRemainingLabel } = await import(helperUrl);
assert.equal(tenderDaysRemainingLabel(null), 'Sin fecha');
assert.equal(tenderDaysRemainingLabel(undefined), 'Sin fecha');
const inFiveDays = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
assert.equal(tenderDaysRemainingLabel(inFiveDays), '5 día(s)');
const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
assert.equal(tenderDaysRemainingLabel(yesterday), 'Vencida');

console.log('tender summary public fields passed');
