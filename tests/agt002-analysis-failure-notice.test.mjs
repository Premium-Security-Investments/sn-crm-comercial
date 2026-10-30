import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGT002_ANALYSIS_FAILURE_REASONS,
  agt002AnalysisFailureLine,
  agt002FailureDayLabel,
  announceAgt002AnalysisFailure,
} from '../verticales/licitaciones/agt002-analysis-failure-notice.js';
import { createAgt002InitialAnalysisWorker } from '../verticales/licitaciones/agt002-initial-analysis-worker.js';
import { AGT002_INITIAL_ANALYSIS_WORKER_ID } from '../verticales/licitaciones/agt002-initial-analysis-jobs.js';
import { AGT002_CLAUDE_MAX_STDOUT_BYTES } from '../agt002-claude-client.js';

// Supersalud SNS-LP-2-2026, 2026-10-26: dos reanálisis murieron en la fase de síntesis con
// AGT002_CLAUDE_OUTPUT_TOO_LARGE —00:58:08Z y 03:45:57Z— y ninguno dejó rastro visible. La ficha siguió
// mostrando el análisis anterior y se supo horas después porque Juan preguntó si todo estaba bien.
// Pruebas puras: sin red, sin base de datos real.

const OPP = '021c37ec-99f0-4151-b4b0-42dfb930c5c7';

test('el aviso dice que no terminó, por qué en llano, y que lo vigente sigue siendo lo anterior', () => {
  const line = agt002AnalysisFailureLine({ errorCode: 'model_call_failed', at: new Date('2026-10-26T03:45:57Z') });
  assert.match(line, /^Vig-IA: el análisis del 25-oct no terminó/, 'día Bogotá, no UTC: 03:45Z del 26 es el 25 en Bogotá');
  assert.match(line, /el modelo no devolvió un resultado utilizable/);
  assert.match(line, /El análisis vigente sigue siendo el anterior/);
  assert.match(line, /volver a pedirlo/);
});

test('cada código de fallo tiene su motivo en llano, y uno desconocido no inventa nada', () => {
  for (const [code, reason] of Object.entries(AGT002_ANALYSIS_FAILURE_REASONS)) {
    assert.match(agt002AnalysisFailureLine({ errorCode: code }), new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), code);
  }
  for (const code of ['', null, undefined, 'lo_que_sea']) {
    assert.match(agt002AnalysisFailureLine({ errorCode: code }), /por una causa no tipificada/, String(code));
  }
  // El motivo nunca puede salir del texto de un error ni de la salida del modelo.
  assert.match(agt002AnalysisFailureLine({ errorCode: 'AGT002_CLAUDE_OUTPUT_TOO_LARGE: 300000 bytes' }), /por una causa no tipificada/);
});

test('el día del aviso es el de Bogotá y una fecha inválida no rompe la línea', () => {
  assert.equal(agt002FailureDayLabel(new Date('2026-10-26T03:45:57Z')), '25-oct');
  assert.equal(agt002FailureDayLabel(new Date('2026-10-26T06:00:00Z')), '26-oct');
  assert.equal(agt002FailureDayLabel('no es fecha'), '');
  assert.match(agt002AnalysisFailureLine({ errorCode: 'model_call_failed', at: 'no es fecha' }), /^Vig-IA: el análisis no terminó/);
});

test('el aviso se agrega con el RPC atómico y nunca lanza por un aviso', async () => {
  const calls = [];
  const ok = { rpc: async (name, args) => { calls.push({ name, args }); return { error: null }; } };
  const outcome = await announceAgt002AnalysisFailure(ok, { opportunityId: OPP, errorCode: 'model_call_failed' });
  assert.equal(outcome.announced, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'psi_append_opportunity_observation_line', 'sólo el append atómico, nunca un UPDATE del campo completo');
  assert.equal(calls[0].args.p_opportunity_id, OPP);

  const failing = { rpc: async () => ({ error: { message: 'no' } }) };
  assert.deepEqual(await announceAgt002AnalysisFailure(failing, { opportunityId: OPP, errorCode: 'model_call_failed' }), { announced: false, reason: 'append_failed' });
  assert.deepEqual(await announceAgt002AnalysisFailure(ok, { errorCode: 'model_call_failed' }), { announced: false, reason: 'sin_oportunidad' });
});

test('el worker avisa en los TRES caminos de fallo, y el aviso no puede cambiar el resultado del turno', async () => {
  const job = { jobId: 'job-1', leaseId: 'lease-1', fenceVersion: 1, opportunityId: OPP };
  const build = ({ executeJob, completeJob, announceFailure }) => createAgt002InitialAnalysisWorker({
    database: {},
    leaseSeconds: 600,
    claimJob: async (_db, { workerId }) => (workerId === AGT002_INITIAL_ANALYSIS_WORKER_ID ? job : null),
    executeJob,
    completeJob: completeJob || (async () => {}),
    failJob: async () => {},
    announceFailure,
  });

  // 1. el ejecutor lanza
  let avisos = [];
  let result = await build({ executeJob: async () => { throw new Error('caída'); }, announceFailure: async (_db, args) => avisos.push(args) }).runOnce();
  assert.equal(result.errorCode, 'executor_failure');
  assert.deepEqual(avisos, [{ opportunityId: OPP, jobId: 'job-1', errorCode: 'executor_failure' }]);

  // 2. el ejecutor devuelve un fallo tipificado
  avisos = [];
  result = await build({ executeJob: async () => ({ status: 'unavailable', error_code: 'model_call_failed' }), announceFailure: async (_db, args) => avisos.push(args) }).runOnce();
  assert.equal(result.errorCode, 'model_call_failed');
  assert.deepEqual(avisos.map(a => a.errorCode), ['model_call_failed']);

  // 3. falla al guardar un resultado bueno
  avisos = [];
  result = await build({
    executeJob: async () => ({ status: 'completed', completion: {} }),
    completeJob: async () => { throw new Error('no guardó'); },
    announceFailure: async (_db, args) => avisos.push(args),
  }).runOnce();
  assert.equal(result.errorCode, 'persistence_failure');
  assert.deepEqual(avisos.map(a => a.errorCode), ['persistence_failure']);

  // Un aviso que revienta no cambia el resultado del turno ni oculta el código del fallo.
  result = await build({ executeJob: async () => ({ status: 'unavailable', error_code: 'budget_exceeded' }), announceFailure: async () => { throw new Error('el aviso falló'); } }).runOnce();
  assert.deepEqual(result, { status: 'unavailable', jobId: 'job-1', errorCode: 'budget_exceeded' });

  // Sin `announceFailure` el worker sigue funcionando igual que antes.
  result = await build({ executeJob: async () => ({ status: 'unavailable', error_code: 'lease_lost' }) }).runOnce();
  assert.equal(result.errorCode, 'lease_lost');

  // Un turno que termina bien no deja aviso de fallo.
  avisos = [];
  result = await build({ executeJob: async () => ({ status: 'completed', completion: {} }), announceFailure: async (_db, args) => avisos.push(args) }).runOnce();
  assert.equal(result.status, 'completed');
  assert.deepEqual(avisos, []);
});

test('el techo de salida del modelo deja caber el expediente que lo rompió', () => {
  // La v6 de Supersalud midió 193.867 bytes de JSON con 77 claims, al 74% del techo viejo de 262.144.
  // El techo nuevo tiene que dejar margen real, no un 10% más.
  assert.equal(AGT002_CLAUDE_MAX_STDOUT_BYTES, 1_048_576);
  assert.ok(AGT002_CLAUDE_MAX_STDOUT_BYTES > 193_867 * 4, 'margen para unas cuatro veces el tamaño que ya se midió');
});
