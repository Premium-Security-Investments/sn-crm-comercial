import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { computeAgt002PreviewIdempotencyKey } from '../agt002-preview-persistence.js';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');

// Task 36 residual: the REAL human-answer route (POST /api/tender-question-responses)
// must connect to a new append-only, idempotent, versioned reanalysis using the
// existing AGT-002 processing/Preview flow — not a second engine, not an automatic
// GO/NO-GO path.
for (const [label, source] of [['server/index.js', server], ['api/[...path].js', api]]) {
  const routeStart = source.indexOf("app.post('/api/tender-question-responses'");
  assert.notEqual(routeStart, -1, `${label} debe declarar POST /api/tender-question-responses`);
  const routeEnd = source.indexOf("\n});", routeStart);
  const routeBody = source.slice(routeStart, routeEnd);

  assert.match(
    routeBody,
    /await\s+reanalyzeAgt002AfterHumanAnswer\(/,
    `${label}: al registrar la respuesta humana, la ruta debe disparar el reanálisis versionado AGT-002`,
  );

  const helperStart = source.indexOf('async function reanalyzeAgt002AfterHumanAnswer');
  assert.notEqual(helperStart, -1, `${label}: debe existir la función que conecta la respuesta humana con el reanálisis`);
  const helperEnd = source.indexOf('\n}\n', helperStart);
  const helperBody = source.slice(helperStart, helperEnd);

  assert.match(
    helperBody,
    /registerAgt002ContextVersion/,
    `${label}: la respuesta humana debe generar una nueva versión de contexto AGT-002 (registerAgt002ContextVersion)`,
  );
  assert.match(
    helperBody,
    /context_version_id/,
    `${label}: el reanálisis debe referenciar explícitamente la versión de contexto (context_version_id)`,
  );

  // Reuse of the existing engine and the observability-only orchestrator, which itself
  // delegates persistence to registerAgt002PreviewAnalysis; never a second engine or a
  // parallel persistence implementation.
  assert.match(helperBody, /createAgt002PreviewRuntime/, `${label}: debe reutilizar el motor Vig-IA existente, no crear uno nuevo`);
  assert.match(helperBody, /runAgt002PostBridgeAnalysis/, `${label}: debe atravesar el orquestador post-bridge observable`);
  assert.match(source, /import\s*\{[^}]*runAgt002PostBridgeAnalysis[^}]*\}\s*from\s*['"]\.\.\/agt002-post-bridge-observability\.js['"];/s, `${label}: debe importar el orquestador post-bridge canónico`);
  const postBridgeModule = readFileSync(new URL('../agt002-post-bridge-observability.js', import.meta.url), 'utf8');
  assert.match(postBridgeModule, /registerAgt002PreviewAnalysis/, `${label}: el orquestador debe persistir mediante la función existente`);

  // Only exact human identities may reach either the write RPC or the reanalysis. The
  // centralized guard must run in the real route before the first database write.
  const guardHelperStart = source.indexOf('function requireHumanTenderIdentity');
  assert.notEqual(guardHelperStart, -1, `${label}: debe existir el guard central de identidad humana`);
  const guardHelperEnd = source.indexOf('\n}', guardHelperStart);
  const guardHelperBody = source.slice(guardHelperStart, guardHelperEnd);
  assert.match(guardHelperBody, /identity_type\s*!==\s*'human'/, `${label}: el guard debe rechazar toda identidad distinta de human`);
  const humanGuardIndex = routeBody.indexOf('requireHumanTenderIdentity(currentProfile)');
  const responseWriteIndex = routeBody.indexOf("database.rpc('psi_record_tender_question_response");
  assert.ok(humanGuardIndex >= 0, `${label}: la ruta real debe invocar el guard de identidad humana`);
  assert.ok(
    humanGuardIndex < responseWriteIndex,
    `${label}: el guard de identidad humana debe ejecutarse antes de registrar la respuesta`,
  );
  assert.match(helperBody, /identity_type\s*===\s*'agent'/, `${label}: el helper de reanálisis debe conservar defensa en profundidad`);

  // The new analysis must actually consume the newly recorded human evidence,
  // not merely version it beside an otherwise unchanged model input.
  assert.match(
    helperBody,
    /contextV2Sections:\s*\{[^}]*human_evidence:\s*humanEvidence[^}]*\}/s,
    `${label}: el motor Preview debe recibir la evidencia humana en contextV2Sections`,
  );

  // Exact retries may append another immutable answer row, but they must collapse to
  // the same effective evidence set so context/run idempotency remains stable.
  const evidenceHelperStart = source.indexOf('function agt002HumanEvidenceFromResponses');
  const evidenceHelperEnd = source.indexOf('\n}\n', evidenceHelperStart);
  const buildEvidence = Function(`"use strict"; return (${source.slice(evidenceHelperStart, evidenceHelperEnd + 2)});`)();
  const original = {
    id: 'answer-old', question_id: 'q-1', question_text: 'Pregunta', status: 'resolved',
    response: 'Respuesta', evidence_notes: 'Soporte', responded_by: 'human-1', responded_by_name: 'Humana',
    responded_at: '2026-07-30T10:00:00.000Z', analysis_run_id: 'run-old',
  };
  const exactRetry = { ...original, id: 'answer-new', responded_at: '2026-07-30T10:01:00.000Z' };
  const deduplicated = buildEvidence([exactRetry, original]);
  assert.equal(deduplicated.length, 1, `${label}: un reintento exacto no debe crear una nueva identidad de evidencia`);
  assert.equal(deduplicated[0].answer_id, original.id, `${label}: la identidad estable debe conservar la primera evidencia append-only`);
  assert.equal(
    buildEvidence([{ ...exactRetry, response: 'Respuesta corregida' }, original]).length,
    2,
    `${label}: una respuesta humana realmente distinta debe conservar una identidad nueva`,
  );

  // Must never create/reference a GO/NO-GO decision from this human-answer path.
  assert.doesNotMatch(helperBody, /go_no_go|callTenderGoNoGoDecision/i, `${label}: el reanálisis por respuesta humana no debe crear una decisión GO/NO-GO`);
}

// Idempotency must be identity-bound to the new context, not just snapshot+policy+model:
// same context version -> same key (idempotent retry); different context version -> a
// distinct key (new human evidence must not collide with the run it supersedes).
const base = { snapshotId: 'snap-1', policyVersion: 'policy-1', model: 'model-1' };
const keyWithoutContext = computeAgt002PreviewIdempotencyKey(base);
const keyWithContextA = computeAgt002PreviewIdempotencyKey({ ...base, contextVersionId: 'ctx-a' });
const keyWithContextARetry = computeAgt002PreviewIdempotencyKey({ ...base, contextVersionId: 'ctx-a' });
const keyWithContextB = computeAgt002PreviewIdempotencyKey({ ...base, contextVersionId: 'ctx-b' });

assert.notEqual(keyWithContextA, keyWithoutContext, 'una versión de contexto debe producir una identidad distinta a la corrida original');
assert.equal(keyWithContextA, keyWithContextARetry, 'la misma versión de contexto debe ser idempotente ante reintentos exactos');
assert.notEqual(keyWithContextA, keyWithContextB, 'evidencia humana distinta (otra versión de contexto) debe producir una identidad distinta');

console.log('AGT-002 human-answer reanalysis static wiring passed');
