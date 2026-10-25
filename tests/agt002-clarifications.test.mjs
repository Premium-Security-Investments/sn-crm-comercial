// Juan, 2026-10-21: un solo espacio con Vig-IA y dos tipos de mensaje. Fija: la aclaración se valida y se registra por la
// función gobernada, pide el incremental a nombre de quien la escribe (sin hacer fallar el registro si la solicitud
// falla), se lista con autor; y la síntesis incremental recibe exactamente las aclaraciones fijadas, con su instrucción.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { listAgt002Clarifications, parseAgt002ClarificationBody, recordAgt002Clarification } from '../verticales/licitaciones/agt002-clarifications.js';
import { createAgt002InitialAnalysisRuntime } from '../verticales/licitaciones/agt002-initial-analysis-runtime.js';
import { otherRiskNotes, placeAgt002Clarifications } from '../verticales/licitaciones/agt002-requirements-model.js';

test('el cuerpo de una aclaración: texto obligatorio, punto opcional pero completo', () => {
  assert.throws(() => parseAgt002ClarificationBody({ content: '  ' }), /Escriba la aclaración/);
  assert.throws(() => parseAgt002ClarificationBody({ content: 'x'.repeat(4001) }), /supera 4000/);
  assert.throws(() => parseAgt002ClarificationBody({ content: 'x', target_kind: 'otro', target_id: 'a' }), /no es válido/);
  assert.throws(() => parseAgt002ClarificationBody({ content: 'x', target_kind: 'requirement' }), /Falta el punto/);
  assert.deepEqual(parseAgt002ClarificationBody({ content: ' En Cali somos agencia. ' }), { content: 'En Cali somos agencia.', targetKind: null, targetId: null, targetLabel: null });
  assert.deepEqual(parseAgt002ClarificationBody({ content: 'x', target_kind: 'finding', target_id: 'F-1', target_label: 'Domicilio' }), { content: 'x', targetKind: 'finding', targetId: 'F-1', targetLabel: 'Domicilio' });
});

test('registrar: función gobernada + incremental a nombre de quien escribe; la solicitud fallida no tumba el registro', async () => {
  const calls = [];
  const database = { rpc: async (name, args) => { calls.push([name, args]); return { data: { id: 'c1', content: args.p_content }, error: null }; } };
  const requests = [];
  const ok = await recordAgt002Clarification(database, { opportunityId: 'opp', actorId: 'juan', body: { content: 'Somos agencia.', target_kind: 'requirement', target_id: 'REQ-DOM', target_label: 'Domicilio' },
    request: async (_db, args) => { requests.push(args); return { requested: true, alreadyOpen: false, status: { state: 'requested' } }; } });
  assert.equal(calls[0][0], 'psi_record_agt002_clarification');
  assert.deepEqual(calls[0][1], { p_opportunity_id: 'opp', p_actor_id: 'juan', p_content: 'Somos agencia.', p_target_kind: 'requirement', p_target_id: 'REQ-DOM', p_target_label: 'Domicilio' });
  assert.deepEqual(requests[0], { opportunityId: 'opp', requestedBy: 'juan', mode: 'incremental' });
  assert.equal(ok.analysis_request.requested, true);
  const failed = await recordAgt002Clarification(database, { opportunityId: 'opp', actorId: 'juan', body: { content: 'x' }, request: async () => { throw Object.assign(new Error('Ya se hicieron 10 análisis'), { reason: 'limite_por_proceso' }); } });
  assert.equal(failed.clarification.id, 'c1');
  assert.deepEqual(failed.analysis_request, { requested: false, reason: 'limite_por_proceso', message: 'Ya se hicieron 10 análisis' });
  const rejected = { rpc: async () => ({ data: null, error: { code: '23514', message: 'La Mesa no está disponible: NO GO vigente.' } }) };
  await assert.rejects(recordAgt002Clarification(rejected, { opportunityId: 'opp', actorId: 'juan', body: { content: 'x' } }), error => error.status === 409);
});

test('listar con autor; sin la migración 141 la lista es vacía', async () => {
  const chain = rows => ({ select() { return this; }, eq() { return this; }, order: async () => rows });
  const ok = { from: () => chain({ data: [{ id: 'c1', content: 'x', target_kind: null, target_id: null, target_label: null, created_at: 't', author: { full_name: 'Juan Botero' } }], error: null }) };
  assert.deepEqual(await listAgt002Clarifications(ok, 'opp'), [{ id: 'c1', content: 'x', target_kind: null, target_id: null, target_label: null, created_at: 't', author_name: 'Juan Botero' }]);
  const missing = { from: () => chain({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.psi_agt002_clarifications'" } }) };
  assert.deepEqual(await listAgt002Clarifications(missing, 'opp'), []);
});

const textHash = createHash('sha256').update('t').digest('hex');
const PACKAGE_HASH = 'c'.repeat(64);
const job = {
  jobId: 'job-1', opportunityId: 'opp', tenderId: 'tender',
  payload: {
    persistence: { packageVersionId: 'pkg', packageHash: PACKAGE_HASH, analysisRunId: 'run-2', authorizationId: 'a', g1Scope: 'A', policyVersion: 'p', analysisKind: 'REANALYSIS', analysisVersion: 2, sourceAnalysisRunId: 'run-1' },
    execution: { timeoutMs: 1000, reasoningEffort: 'medium' },
    budget: { maxTotalTokens: 1000, maxCostUsd: 1, inputCostPerMillionUsd: 1, outputCostPerMillionUsd: 1 },
  },
};
const pkg = { version: { package_id: 'p', package_hash: PACKAGE_HASH, document_manifest_hash: 'd'.repeat(64), semantic_manifest_hash: 'e'.repeat(64), member_count: 1, batch_count: 1, created_at: '2026-10-21T00:00:00Z' },
  members: [{ id: 'm', document_version_id: 'doc', batch_index: 0, source_classification: 'official', inclusion_reason: 'x', content_hash: 'a'.repeat(64), extraction_text_hash: textHash }] };
const empty = JSON.stringify({ claims: [], process_analysis: {}, requirements: [], findings: [], contradictions: [], coverage: [], recommendation: {}, open_items: [], process_deadlines: [] });

test('la síntesis incremental recibe las aclaraciones fijadas y su instrucción; sin aclaraciones, no', async () => {
  const requests = [];
  const runtime = createAgt002InitialAnalysisRuntime({
    bridgeClient: { run: async request => { requests.push(request); return { content: empty, usage: { input_tokens: 1, output_tokens: 1 } }; } },
    loadPackage: async () => pkg, loadOfficialContext: async () => null, loadPriorAnalysis: async () => ({ claims: [], requirements: [], findings: [] }),
    loadClarifications: async (_db, { ids, opportunityId }) => { assert.deepEqual(ids, ['c1']); assert.equal(opportunityId, 'opp'); return [{ autor: 'Juan Botero', fecha: '2026-10-21', punto: 'Domicilio', aclaracion: 'Somos agencia.' }]; },
    validateEnvelope: () => ({ ok: true, errors: [] }), now: () => new Date('2026-10-21T12:00:00Z'),
  });
  await runtime.callModel({ job, batch: { phase: 'synthesis', batchIndex: 0, requestHash: 'h', mode: 'incremental', priorAnalysisRunId: 'run-1', clarificationIds: ['c1'] }, modelId: 'm', members: [] });
  assert.deepEqual(requests[0].input.human_clarifications, [{ autor: 'Juan Botero', fecha: '2026-10-21', punto: 'Domicilio', aclaracion: 'Somos agencia.' }]);
  assert.match(requests[0].policy, /ACLARACIONES\./);
  await runtime.callModel({ job, batch: { phase: 'synthesis', batchIndex: 1, requestHash: 'h2', mode: 'incremental', priorAnalysisRunId: 'run-1', clarificationIds: [] }, modelId: 'm', members: [] });
  assert.equal('human_clarifications' in requests[1].input, false);
  assert.doesNotMatch(requests[1].policy, /ACLARACIONES\./);
});

test('los otros riesgos traen su id para poder aclararlos', () => {
  const notes = otherRiskNotes({ findings: [{ id: 'F-9', title: 'Riesgo', impact: 'x', severity: 'HIGH' }], contradictions: [{ id: 'R-1', topic: 'Decimales', requiredAction: 'y', status: 'OPEN' }] }, []);
  assert.deepEqual(notes.map(note => note.id), ['F-9', 'R-1']);
});

// --- Punto 3 de la definición de Juan: cada aclaración junto a su punto y todas en una lista ----------

const ROWS = [
  { key: 'CLM-GAR', title: 'Garantía de seriedad', requirementIds: ['REQ-GAR'], findingIds: ['FND-GAR'] },
  { key: 'CLM-EXP', title: 'Experiencia de 35.192 SMLMV', requirementIds: ['REQ-EXP'], findingIds: [] },
];
const NOTES = [{ id: 'FND-SUELTO', title: 'Reajuste de precios' }];
const clarification = (id, overrides = {}) => ({ id, content: `texto ${id}`, target_kind: null, target_id: null, target_label: null, created_at: '2026-10-21T02:46:00Z', author_name: 'Juan Botero', ...overrides });

test('aclaración ligada a un requisito: queda en su fila y en la lista con el nombre del requisito', () => {
  const placed = placeAgt002Clarifications([clarification('c1', { target_kind: 'requirement', target_id: 'CLM-GAR', target_label: 'Garantía de seriedad' })], { requirements: ROWS, findings: NOTES });
  assert.deepEqual(placed.byRequirement.get('CLM-GAR').map(item => item.id), ['c1']);
  assert.deepEqual(placed.listed.map(entry => [entry.clarification.id, entry.scope, entry.rowKey, entry.label]), [['c1', 'requirement', 'CLM-GAR', 'Garantía de seriedad']]);
});

test('el análisis renumera sus claims: el punto se reencuentra por el id del requisito o por el nombre guardado', () => {
  const byRequirementId = placeAgt002Clarifications([clarification('c2', { target_kind: 'requirement', target_id: 'REQ-EXP', target_label: 'otro nombre' })], { requirements: ROWS });
  assert.deepEqual(byRequirementId.byRequirement.get('CLM-EXP').map(item => item.id), ['c2']);
  // Mismo nombre con otra puntuación, mayúsculas y espacios: sigue siendo el mismo punto.
  const byLabel = placeAgt002Clarifications([clarification('c3', { target_kind: 'requirement', target_id: 'CLM-VIEJO-DE-LA-V2', target_label: '  GARANTÍA  de seriedad ' })], { requirements: ROWS });
  assert.deepEqual(byLabel.byRequirement.get('CLM-GAR').map(item => item.id), ['c3']);
});

test('aclaración sobre un hallazgo: en el hallazgo suelto, o en la fila del requisito que lo contiene', () => {
  const placed = placeAgt002Clarifications([
    clarification('c4', { target_kind: 'finding', target_id: 'FND-SUELTO', target_label: 'Reajuste de precios' }),
    clarification('c5', { target_kind: 'finding', target_id: 'FND-GAR', target_label: 'Garantías' }),
  ], { requirements: ROWS, findings: NOTES });
  assert.deepEqual(placed.byFinding.get('FND-SUELTO').map(item => item.id), ['c4']);
  assert.deepEqual(placed.byRequirement.get('CLM-GAR').map(item => item.id), ['c5']);
  assert.deepEqual(placed.listed.map(entry => entry.scope), ['finding', 'requirement']);
});

test('la general va sin punto y la que ya no tiene punto no se pierde: sale como huérfana con su nombre', () => {
  const placed = placeAgt002Clarifications([
    clarification('c6'),
    clarification('c7', { target_kind: 'requirement', target_id: 'CLM-QUE-YA-NO-EXISTE', target_label: 'Domicilio en Cali' }),
  ], { requirements: ROWS, findings: NOTES });
  assert.equal(placed.byRequirement.size, 0);
  assert.deepEqual(placed.listed.map(entry => [entry.clarification.id, entry.scope, entry.label]), [['c6', 'general', null], ['c7', 'orphan', 'Domicilio en Cali']]);
});

test('sin análisis vigente (sin filas) ninguna aclaración se traga: todas quedan listadas', () => {
  const placed = placeAgt002Clarifications([clarification('c8', { target_kind: 'requirement', target_id: 'CLM-GAR', target_label: 'Garantía de seriedad' }), clarification('c9')], {});
  assert.deepEqual(placed.listed.map(entry => entry.scope), ['orphan', 'general']);
});

test('la pantalla de la licitación muestra las aclaraciones en su punto y la lista completa', async () => {
  const source = readFileSync(new URL('../src/tenders/workspace/TenderWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(source, /placeAgt002Clarifications\(clarifications, \{ requirements: rows, findings: others \}\)/, 'reparte las aclaraciones del expediente');
  assert.match(source, /<TenderClarificationNotes items=\{clarificationsByRow\?\.get\(selected\.key\) \|\| \[\]\} \/>/, 'el requisito seleccionado muestra lo que ya se aclaró');
  assert.match(source, /<TenderClarificationsCard listed=\{listedClarifications\}/, 'la licitación tiene su lista de aclaraciones');
  assert.match(source, /onSaved=\{\(\) => void reloadClarifications\(\)\}/, 'al registrar una aclaración la lista se recarga');
});
