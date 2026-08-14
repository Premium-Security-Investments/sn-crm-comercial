import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');

// The canonical endpoint (POST /api/tender-documents-analyze-agent-preview) must, under
// canonicalOnly, cross the SAME durable post-bridge frontier PR #90 introduced for the
// human-answer reanalysis path (runAgt002PostBridgeAnalysis): exactly one engine.analyze()
// call, exactly one persistence attempt, the queued->running->completed|unavailable
// psi_agt002_analysis_attempt_events lifecycle, the single closed-catalog
// reanalysis_post_bridge_outcome event (fine-grained stage + error_code, including
// bridge_response_received), and exactly one claim release. Today it instead calls
// engine.analyze/registerAgt002PreviewAnalysis directly and only ever records the coarse
// canonical_preview_unavailable event, which never consumes error.stage.
for (const [label, source] of [['server/index.js', server], ['api/[...path].js', api]]) {
  const routeStart = source.indexOf("app.post('/api/tender-documents-analyze-agent-preview'");
  assert.notEqual(routeStart, -1, `${label}: debe declarar POST /api/tender-documents-analyze-agent-preview`);
  const routeEnd = source.indexOf("\napp.post('/api/tender-documents-import'", routeStart);
  assert.ok(routeEnd > routeStart, `${label}: debe existir el límite de la ruta canónica`);
  const routeBody = source.slice(routeStart, routeEnd);

  const postBridgeCallIndex = routeBody.indexOf('await runAgt002PostBridgeAnalysis(database, {');
  assert.notEqual(postBridgeCallIndex, -1, `${label}: bajo canonicalOnly la ruta canónica debe delegar en runAgt002PostBridgeAnalysis, igual que reanalyzeAgt002AfterHumanAnswer`);

  const callTerminatorIndex = routeBody.indexOf(');', postBridgeCallIndex);
  const orchestratorCall = routeBody.slice(postBridgeCallIndex, callTerminatorIndex + 2);

  assert.match(orchestratorCall, /claimId, idempotencyKey, canonicalOnly/, `${label}: debe propagar el claim vivo y la clave de idempotencia al orquestador post-bridge`);
  assert.match(orchestratorCall, /correlationId: canonicalCorrelationId/, `${label}: debe reutilizar el correlation id ya generado por la ruta canónica`);
  assert.match(orchestratorCall, /contextVersionId: contextVersion\?\.id/, `${label}: debe referenciar explícitamente la versión de contexto`);
  assert.match(orchestratorCall, /engine,/, `${label}: debe reutilizar el motor Vig-IA ya construido, no crear uno nuevo`);
  assert.match(orchestratorCall, /observability: agt002AnalysisObservability/, `${label}: debe reutilizar el sink de observabilidad existente`);
  assert.match(orchestratorCall, /bridgeTelemetry,/, `${label}: debe propagar la telemetría mutable del puente para clasificar fallas post-bridge`);
  assert.match(orchestratorCall, /integralContractV3: agt002AnalysisConfig\.AGT002_INTEGRAL_CONTRACT_V3 === true/, `${label}: debe indicar al orquestador si el contrato integral v3 está activo`);
  assert.match(orchestratorCall, /presentAnalysis: registeredRun => presentCurrentTenderAnalysis\(registeredRun\)/, `${label}: debe reutilizar el presentador existente, no una segunda forma de la respuesta`);

  // bridgeTelemetry must be wired exactly like the human-answer pattern: read fresh after
  // engine.analyze() settles, never before, so post-bridge failures can be told apart from
  // transport failures using bridge_response_received.
  assert.match(routeBody, /const bridgeTelemetry = \{ invocationStarted: false, responseReceived: false \};/, `${label}: debe rastrear invocación y respuesta del puente, no solo invocación`);
  assert.match(routeBody, /onBridgeInvocationStarted: \(\) => \{ bridgeTelemetry\.invocationStarted = true; \}/, `${label}: debe cablear el inicio de invocación del puente en la telemetría mutable`);
  assert.match(routeBody, /onBridgeResponseReceived: \(\) => \{ bridgeTelemetry\.responseReceived = true; \}/, `${label}: debe cablear la respuesta del puente en la telemetría mutable`);

  // From the orchestrator call onward (until the next direct engine.analyze(), which only the
  // !canonicalOnly single-fallback path may still reach), there must be no second engine
  // invocation, no second persistence, no duplicated attempt-lifecycle append, and no double
  // claim release: runAgt002PostBridgeAnalysis owns all of that exactly once.
  const nextDirectEngineCall = routeBody.indexOf('engine.analyze(', callTerminatorIndex);
  const segmentAfterOrchestrator = nextDirectEngineCall === -1
    ? routeBody.slice(postBridgeCallIndex)
    : routeBody.slice(postBridgeCallIndex, nextDirectEngineCall);

  assert.equal(
    (segmentAfterOrchestrator.match(/runAgt002PostBridgeAnalysis\(/g) || []).length, 1,
    `${label}: exactamente una invocación al orquestador post-bridge (cero reintento)`,
  );
  assert.doesNotMatch(segmentAfterOrchestrator, /registerAgt002PreviewAnalysis\(/, `${label}: no debe existir una segunda persistencia directa junto al orquestador (persistencia única)`);
  assert.doesNotMatch(segmentAfterOrchestrator, /appendAttempt\(idempotencyKey, 'running'\)/, `${label}: el estado 'running' debe vivir únicamente dentro del orquestador (lifecycle único)`);
  assert.doesNotMatch(segmentAfterOrchestrator, /appendAttempt\(idempotencyKey, 'completed'/, `${label}: el estado 'completed' debe vivir únicamente dentro del orquestador (lifecycle único)`);
  assert.match(segmentAfterOrchestrator, /claimId = null;/, `${label}: el claim ya liberado dentro del orquestador nunca debe liberarse una segunda vez`);
  assert.match(segmentAfterOrchestrator, /analysis: outcome\.presented/, `${label}: la respuesta completada debe reenviar exactamente la presentación devuelta por el orquestador`);
}

console.log('AGT-002 canonical preview post-bridge observability static wiring passed');
