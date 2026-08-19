import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const migrationUrl = new URL('../supabase/migrations/038_tender_question_responses.sql', import.meta.url);
const attachmentsMigrationUrl = new URL('../supabase/migrations/059_tender_question_response_attachments.sql', import.meta.url);
assert.equal(existsSync(migrationUrl), true, 'Debe existir la migración append-only de respuestas a dudas.');
assert.equal(existsSync(attachmentsMigrationUrl), true, 'Debe existir la migración append-only de adjuntos de respuestas.');
const migration = existsSync(migrationUrl) ? readFileSync(migrationUrl, 'utf8') : '';
const analysis = [
  readFileSync(new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/tenders/components/TenderQuestionResponseCard.tsx', import.meta.url), 'utf8'),
].join('\n');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/tenders/types.ts', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const actionsPath = new URL('../src/tenders/tenderQuestionResponseActions.ts', import.meta.url);
assert.equal(existsSync(actionsPath), true, 'Debe existir el módulo de acciones de adjuntos de respuestas.');
const actions = readFileSync(actionsPath, 'utf8');

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
  assert.match(source, /app\.post\('\/api\/tender-question-response-attachment-upload-url'/, 'Backend debe emitir URLs firmadas de subida directa para adjuntos.');
  assert.match(source, /ensureTenderOpportunity/, 'El endpoint debe comprobar acceso a la oportunidad.');
  assert.match(source, /currentProfile\.id/, 'El actor debe derivarse de sesión, no del body.');
  const humanGuard = source.match(/function requireHumanTenderIdentity\(profile\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(humanGuard, /profile\?\.identity_type != null/, 'El guard debe aceptar perfiles humanos legacy sin identity_type explícito.');
  assert.match(humanGuard, /profile\?\.identity_type !== 'human'/, 'El guard debe bloquear cualquier identidad explícita no humana.');
  assert.match(source, /psi_record_tender_question_response_with_attachments/, 'El registro debe pasar por el RPC 059 con adjuntos.');
  assert.match(source, /randomUUID\(\)/, 'El servidor debe generar el response_id.');
  assert.match(source, /p_evidence_notes:\s*null/, 'El servidor ya no debe persistir evidencia/notas.');
  assert.match(source, /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/, 'El backend debe validar el mismo allow-list de MIME que la migración 059.');
  assert.match(source, /25 \* 1024 \* 1024/, 'El backend debe validar el límite de 25 MiB por archivo.');
  assert.match(source, /storage\.from\(tenderDocumentBucket\)\.remove\(/, 'Un fallo del RPC debe limpiar objetos recién subidos.');
  assert.match(source, /createSignedUrl\(tenderQuestionResponseAttachmentBucketRelativePath/, 'El GET debe emitir signed_url cortas de descarga.');
  assert.doesNotMatch(source, /'question_response(?:s)?["'][^}]*storage_path/s, 'La respuesta HTTP no debe exponer storage_path a la UI.');
}
assert.equal(server.includes("app.post('/api/tender-question-responses'") && api.includes("app.post('/api/tender-question-responses'"), true, 'Server y Vercel deben mantener paridad.');
assert.equal(server, api, 'server/index.js y api/[...path].js deben ser idénticos (paridad).');

assert.match(types, /TenderQuestionResponseStatus/, 'El frontend debe tipar estados de respuesta.');
assert.match(types, /question_responses\?: TenderQuestionResponse\[\]/, 'La carga documental debe exponer respuestas vigentes/históricas.');
assert.match(types, /TenderQuestionResponseAttachment\b/, 'El frontend debe tipar los adjuntos de respuesta.');
assert.match(types, /attachments:\s*TenderQuestionResponseAttachment\[\]/, 'Cada respuesta debe tipar su lista de adjuntos.');
const inputTypeMatch = types.match(/export type TenderQuestionResponseInput = [^;]+;/);
assert.ok(inputTypeMatch, 'Debe existir el tipo de entrada de respuesta.');
assert.doesNotMatch(inputTypeMatch[0], /evidence_notes/, 'El tipo de entrada ya no debe incluir evidencia/notas.');

assert.match(analysis, /Responder duda|Actualizar respuesta/, 'Cada duda debe ofrecer acción de respuesta.');
assert.match(analysis, /textarea/, 'La encargada debe poder escribir una respuesta.');
assert.equal((analysis.match(/<textarea/g) || []).length, 1, 'Debe existir un único campo textarea «Respuesta» (sin textarea de evidencia).');
assert.doesNotMatch(analysis, /Evidencia o notas/i, 'Ya no debe presentarse «Evidencia o notas» en ningún lugar de la UI.');
assert.doesNotMatch(analysis, /evidence_notes/, 'La UI ya no debe leer ni escribir evidence_notes.');
assert.match(analysis, /type="file"/, 'Debe ofrecer selección opcional de archivos de soporte.');
assert.match(analysis, /Archivos de soporte/i, 'Debe rotular la selección de archivos de soporte.');
assert.match(analysis, /signed_url/, 'Debe listar archivos históricos descargables mediante URL firmada.');
assert.match(analysis, /Resuelta|No aplica|Pendiente/, 'Debe presentar estados humanos comprensibles.');
assert.match(analysis, /No autoriza GO \/ NO GO/, 'La UI debe preservar el gate humano formal.');
assert.doesNotMatch(analysis, /onChange=.*responded_by|name="responded_by"/, 'La UI no debe permitir elegir o falsificar autor.');

assert.match(main, /tender-question-responses/, 'El contenedor debe integrar carga y guardado de respuestas.');
assert.match(main, /createTenderQuestionResponseActions/, 'El contenedor debe usar las acciones de adjuntos de respuestas.');

assert.match(actions, /TENDER_QUESTION_RESPONSE_ATTACHMENT_MAX_BYTES\s*=\s*25 \* 1024 \* 1024/, 'El límite de tamaño del cliente debe coincidir con el servidor.');
assert.match(actions, /TENDER_QUESTION_RESPONSE_ATTACHMENT_MAX_COUNT\s*=\s*8/, 'El máximo de archivos por respuesta debe ser 8.');
assert.match(actions, /crypto\.subtle\.digest\('SHA-256'/, 'El hash SHA-256 debe calcularse en el navegador.');
assert.match(actions, /tender-question-response-attachment-upload-url/, 'Debe solicitar tickets de subida directa firmada.');
assert.match(actions, /uploadToSignedUrl/, 'Debe reutilizar el patrón de subida directa firmada.');
assert.match(actions, /response_ticket/, 'El cliente debe transportar el response_ticket firmado por el servidor.');
const uploadAttachmentsBody = actions.match(/async uploadAttachments\([\s\S]*?\n {4}\},/);
assert.ok(uploadAttachmentsBody, 'Debe existir el método uploadAttachments.');
assert.match(uploadAttachmentsBody[0], /responseTicket\s*=\s*ticket\.response_ticket/, 'uploadAttachments debe guardar el response_ticket devuelto por cada solicitud de subida.');
assert.match(uploadAttachmentsBody[0], /response_ticket:\s*responseTicket/, 'uploadAttachments debe reenviar el response_ticket guardado en la siguiente solicitud de ticket.');
assert.match(uploadAttachmentsBody[0], /return\s*\{[^}]*response_ticket[^}]*\}/, 'uploadAttachments debe devolver el response_ticket final junto con el response_id.');

assert.match(main, /response_ticket/, 'El contenedor debe reenviar el response_ticket en el POST final de respuestas.');
assert.match(main, /canAnswerQuestions=\{currentProfile\.identity_type == null \|\| currentProfile\.identity_type === 'human'\}/, 'La UI debe mostrar el formulario a humanos explícitos y perfiles humanos legacy, igual que el backend.');
assert.doesNotMatch(main, /canAnswerQuestions=\{currentProfile\.identity_type === 'human'\}/, 'La comparación estricta no debe ocultar el formulario a perfiles humanos legacy.');
const saveQuestionResponseBody = main.match(/const saveQuestionResponse = async[\s\S]*?\n {2}\};/);
assert.ok(saveQuestionResponseBody, 'Debe existir saveQuestionResponse en el contenedor.');
assert.match(saveQuestionResponseBody[0], /response_ticket/, 'saveQuestionResponse debe incluir response_ticket en el cuerpo del POST final.');
assert.doesNotMatch(saveQuestionResponseBody[0], /storage_path/, 'saveQuestionResponse no debe manipular storage_path directamente.');

console.log('tender question responses static contract passed');
