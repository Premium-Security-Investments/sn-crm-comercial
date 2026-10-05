#!/usr/bin/env node
// AGT-002 INITIAL — offline end-to-end simulation with the REAL model (acceptance gate before any
// production attempt). It runs the same runtime that the worker runs, over a synthetic evidence package:
//   member batch call -> synthesis call -> server stamping -> pre_go_analysis.v2 validation -> persistence
//   invariants (against a recording fake database; nothing is written anywhere).
//
// It spends real model tokens (two calls through the local `claude` CLI). It touches no database, no
// production service and no kill switch. Usage:  node scripts/agt002-initial-analysis-simulate.mjs
import { createHash, randomUUID } from 'node:crypto';

import { createAgt002ClaudeClient } from '../agt002-claude-client.js';
import { createAgt002InitialAnalysisRuntime } from '../agt002-initial-analysis-runtime.js';
import { completeAgt002InitialAnalysisJob } from '../agt002-initial-analysis-persistence.js';

const sha = text => createHash('sha256').update(text).digest('hex');
const MODEL = process.env.AGT002_SIM_MODEL || 'sonnet';

const DOCUMENTS = [
  {
    id: randomUUID(), name: 'pliego-definitivo.pdf', classification: 'official',
    text: `PLIEGO DE CONDICIONES — LICITACIÓN PÚBLICA LP-003-2026.
Objeto: contratar el servicio de vigilancia y seguridad privada para las sedes administrativas de la entidad.
Presupuesto oficial: CUATRO MIL DOSCIENTOS MILLONES DE PESOS ($4.200.000.000), IVA incluido.
Plazo de ejecución: doce (12) meses contados desde el acta de inicio.
Garantía de seriedad de la oferta: equivalente al diez por ciento (10%) del presupuesto oficial.
Experiencia habilitante: el proponente debe acreditar dos (2) contratos ejecutados en los últimos cinco años, cuya suma sea igual o superior al cien por ciento (100%) del presupuesto oficial.
Cierre de la licitación y presentación de ofertas: 20 de octubre de 2026, 10:00 a.m.
Visita técnica: obligatoria, 8 de octubre de 2026.
Criterios de evaluación: oferta económica 60 puntos; apoyo a la industria nacional 20 puntos; factor técnico 20 puntos.`,
  },
  {
    id: randomUUID(), name: 'anexo-tecnico.pdf', classification: 'official',
    text: `ANEXO TÉCNICO — SERVICIO DE VIGILANCIA.
La entidad requiere dieciocho (18) puestos de vigilancia: doce (12) con servicio 24 horas armado y seis (6) con servicio diurno sin arma.
El contratista debe disponer de un supervisor motorizado por cada seis puestos y de una central de monitoreo con comunicación permanente.
Cada guarda debe contar con credencial vigente de la Superintendencia de Vigilancia y Seguridad Privada.
La sede principal exige además un sistema de control de acceso con registro biométrico.`,
  },
  {
    id: randomUUID(), name: 'adenda-01.pdf', classification: 'official',
    text: `ADENDA No. 1.
Se modifica la fecha de cierre de la licitación: la presentación de ofertas será el 22 de octubre de 2026 a las 10:00 a.m.
Se mantiene sin modificación el presupuesto oficial y el plazo de ejecución.`,
  },
];

const stamp = '2026-10-05T12:00:00.000Z';
const pkg = {
  version: {
    id: randomUUID(), package_id: randomUUID(), package_hash: sha('sim-package'),
    document_manifest_hash: sha('sim-doc-manifest'), semantic_manifest_hash: sha('sim-sem-manifest'),
    member_count: DOCUMENTS.length, batch_count: 1, created_at: stamp,
  },
  members: DOCUMENTS.map(doc => ({
    id: randomUUID(), document_version_id: doc.id, batch_index: 0,
    source_classification: doc.classification, inclusion_reason: `Documento oficial ${doc.name}`,
    content_hash: sha(`file:${doc.text}`), extraction_text_hash: sha(doc.text),
  })),
};

const persistence = {
  workflowInstanceId: randomUUID(), authorizationId: randomUUID(), packageVersionId: pkg.version.id,
  packageHash: pkg.version.package_hash, g1Scope: 'A', policyVersion: 'agt002-initial-policy-v1',
  analysisRunId: randomUUID(),
};
const job = {
  jobId: randomUUID(), leaseId: randomUUID(), fenceVersion: 1,
  opportunityId: randomUUID(), tenderId: randomUUID(),
  payload: {
    persistence,
    execution: { timeoutMs: 600_000, reasoningEffort: 'medium' },
    budget: { maxTotalTokens: 600_000, maxCostUsd: 50, inputCostPerMillionUsd: 3, outputCostPerMillionUsd: 15 },
  },
};

const claude = createAgt002ClaudeClient();
const runtime = createAgt002InitialAnalysisRuntime({
  bridgeClient: { run: request => claude.run(request) },
  loadPackage: async () => pkg,
});

function report(label, value) { console.log(`${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`); }

try {
  const members = DOCUMENTS.map((doc, index) => ({
    memberId: doc.id, content: doc.text, contentHash: pkg.members[index].extraction_text_hash, hashKind: 'utf8_text',
    metadata: { documentVersionId: doc.id, sourceClassification: doc.classification },
  }));
  const memberStep = await runtime.callModel({
    job, modelId: MODEL, members, database: null,
    batch: { phase: 'member_batch_analysis', batchIndex: 0, requestHash: sha('member') },
  });
  report('member notes', memberStep.output.analysis_notes.length);
  report('member tokens', memberStep.usage);

  const synthesisStep = await runtime.callModel({
    job, modelId: MODEL, database: null,
    members: [{ memberId: 'batch:0', content: memberStep.output, contentHash: memberStep.outputSha256 }],
    batch: { phase: 'synthesis', batchIndex: 1, requestHash: sha('synthesis'), sourceBatchIndexes: [0] },
  });
  const envelope = synthesisStep.output;
  report('synthesis tokens', synthesisStep.usage);
  report('claims', envelope.claims.length);
  report('requirements', envelope.requirements.length);
  report('findings', envelope.findings.length);
  report('coverage blocks', envelope.coverage.length);
  report('recommendation', envelope.recommendation.kind);
  report('first claim', envelope.claims[0]?.display_text);

  const rpcCalls = [];
  const fakeDatabase = { rpc: async (name, params) => { rpcCalls.push({ name, params }); return { data: { status: 'completed' }, error: null }; } };
  await completeAgt002InitialAnalysisJob(fakeDatabase, {
    jobId: job.jobId, leaseId: job.leaseId, fenceVersion: 1,
    completion: { ...persistence, envelope },
  });
  report('persistence rpc', rpcCalls.map(call => call.name));
  report('RESULT', 'PASS: respuesta real -> estampado -> validación v2 -> invariantes de persistencia');
} catch (error) {
  report('RESULT', 'FAIL');
  report('code', error?.code ?? 'sin-código');
  report('message', error?.message ?? String(error));
  if (error?.diagnostic) report('diagnostic', error.diagnostic);
  process.exitCode = 1;
}
