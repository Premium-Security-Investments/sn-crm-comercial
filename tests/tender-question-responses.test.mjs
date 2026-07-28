import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const migrationUrl = new URL('../supabase/migrations/038_tender_question_responses.sql', import.meta.url);
assert.equal(existsSync(migrationUrl), true, 'Debe existir la migración append-only de respuestas a dudas.');
const migration = existsSync(migrationUrl) ? readFileSync(migrationUrl, 'utf8') : '';
const analysis = readFileSync(new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/tenders/types.ts', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');

assert.match(migration, /create table if not exists public\.psi_tender_question_responses/, 'Debe persistir respuestas sin reescribir análisis.');
assert.match(migration, /before update or delete/, 'Las respuestas deben ser append-only.');
assert.match(migration, /pending.*resolved.*not_applicable/s, 'La migración debe limitar estados humanos permitidos.');
assert.match(migration, /responded_by/, 'Autor debe derivarse y persistirse en servidor.');
assert.match(migration, /responded_at/, 'Fecha debe derivarse y persistirse en servidor.');
assert.match(migration, /revoke all on table public\.psi_tender_question_responses/, 'No debe haber escritura directa desde cliente.');
assert.match(migration, /revoke all on table public\.psi_tender_question_responses from anon/, 'Supabase no debe conservar grants directos del default ACL para anon.');
assert.match(migration, /revoke all on function public\.psi_record_tender_question_response\(uuid,uuid,text,text,text,text,text,uuid\) from anon/, 'anon no debe ejecutar el RPC gobernado directamente.');
assert.match(migration, /psi_record_tender_question_response/, 'La escritura debe pasar por RPC gobernado.');

for (const source of [server, api]) {
  assert.match(source, /app\.get\('\/api\/tender-question-responses'/, 'Backend debe listar respuestas autorizadas.');
  assert.match(source, /app\.post\('\/api\/tender-question-responses'/, 'Backend debe registrar respuestas autorizadas.');
  assert.match(source, /ensureTenderOpportunity/, 'El endpoint debe comprobar acceso a la oportunidad.');
  assert.match(source, /currentProfile\.id/, 'El actor debe derivarse de sesión, no del body.');
}
assert.equal(server.includes("app.post('/api/tender-question-responses'") && api.includes("app.post('/api/tender-question-responses'"), true, 'Server y Vercel deben mantener paridad.');
assert.match(types, /TenderQuestionResponseStatus/, 'El frontend debe tipar estados de respuesta.');
assert.match(types, /question_responses\?: TenderQuestionResponse\[\]/, 'La carga documental debe exponer respuestas vigentes/históricas.');
assert.match(analysis, /Responder duda|Actualizar respuesta/, 'Cada duda debe ofrecer acción de respuesta.');
assert.match(analysis, /textarea/, 'La encargada debe poder escribir una respuesta.');
assert.match(analysis, /Evidencia o notas/, 'Debe permitir evidencia o notas opcionales.');
assert.match(analysis, /Resuelta|No aplica|Pendiente/, 'Debe presentar estados humanos comprensibles.');
assert.match(analysis, /No autoriza GO \/ NO GO/, 'La UI debe preservar el gate humano formal.');
assert.match(main, /tender-question-responses/, 'El contenedor debe integrar carga y guardado de respuestas.');
assert.doesNotMatch(analysis, /onChange=.*responded_by|name="responded_by"/, 'La UI no debe permitir elegir o falsificar autor.');

console.log('tender question responses static contract passed');
