#!/usr/bin/env node
// AGT-002 INITIAL — acceptance simulation over REAL production data, READ-ONLY, with the REAL model.
// Reads a frozen evidence package (members + governed extractions) and the current company dossier, runs the same
// runtime the worker runs (member batches -> synthesis -> server stamping -> v2 validation), and prints a summary.
// It writes nothing to any database (the company profile is passed in memory, not frozen) and spends model tokens.
//
// Usage: ENV_FILE=/root/.agt002-prod.env node scripts/agt002-initial-analysis-simulate-real.mjs \
//          --package-version <uuid> --opportunity <uuid> --tender <uuid> [--scope A|A_PLUS_B] [--out file.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

import { createAgt002ClaudeClient } from '../agt002-claude-client.js';
import { createAgt002InitialAnalysisRuntime } from '../agt002-initial-analysis-runtime.js';
import { loadAgt002CompanyDossier } from '../agt002-company-dossier.js';
import { computeAgt002CompanyProfileSnapshotHash } from '../agt002-company-profile-snapshot.js';
import { validatePreGoAnalysisV2 } from '../agt002-pre-go-analysis-v2.js';

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
if (process.env.ENV_FILE) {
  for (const line of readFileSync(process.env.ENV_FILE, 'utf8').split('\n')) {
    const i = line.indexOf('='); if (i > 0 && !process.env[line.slice(0, i)]) process.env[line.slice(0, i)] = line.slice(i + 1);
  }
}
const packageVersionId = arg('package-version');
const opportunityId = arg('opportunity');
const tenderId = arg('tender');
const scope = arg('scope') || 'A_PLUS_B';
const model = process.env.AGT002_SIM_MODEL || 'sonnet';
if (!packageVersionId || !opportunityId || !tenderId) { console.error('Faltan --package-version, --opportunity y --tender.'); process.exit(2); }

// Read-only client: every write method throws, so nothing can be persisted by accident.
const real = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const database = { from: table => real.from(table), rpc: () => { throw new Error('simulación de solo lectura: RPC bloqueada'); } };

const { data: version, error: versionError } = await real.from('psi_agt002_evidence_package_versions')
  .select('id,package_id,package_hash,document_manifest_hash,semantic_manifest_hash,member_count,batch_count,created_at').eq('id', packageVersionId).single();
const { data: members, error: membersError } = await real.from('psi_agt002_evidence_package_members')
  .select('id,document_version_id,batch_index,source_classification,inclusion_reason,content_hash,extraction_text_hash')
  .eq('package_version_id', packageVersionId).order('batch_index').order('document_version_id');
if (versionError || membersError) { console.error('No fue posible leer el paquete.'); process.exit(1); }

let company = null;
if (scope === 'A_PLUS_B') {
  const snapshot = JSON.parse(JSON.stringify(await loadAgt002CompanyDossier(real)));
  company = { profileSnapshotId: randomUUID(), profileSnapshotHash: computeAgt002CompanyProfileSnapshotHash(snapshot), snapshot };
}

const persistence = {
  workflowInstanceId: randomUUID(), authorizationId: randomUUID(), packageVersionId, packageHash: version.package_hash,
  g1Scope: scope, policyVersion: 'agt002-initial-analysis-policy-v1', analysisRunId: randomUUID(),
};
const job = {
  jobId: randomUUID(), leaseId: randomUUID(), fenceVersion: 1, opportunityId, tenderId,
  payload: { persistence, execution: { timeoutMs: 900_000, reasoningEffort: 'medium' }, budget: { maxTotalTokens: 900_000, maxCostUsd: 50, inputCostPerMillionUsd: 3, outputCostPerMillionUsd: 15 } },
};
const claude = createAgt002ClaudeClient();
const runtime = createAgt002InitialAnalysisRuntime({
  bridgeClient: { run: request => claude.run(request) },
  loadPackage: async () => ({ version, members }),
  loadCompanyProfile: async () => company,
});

const started = Date.now();
const batches = [...new Set(members.map(member => member.batch_index))].sort((a, b) => a - b);
const memberOutputs = [];
let tokens = 0; let cost = 0;
for (const batchIndex of batches) {
  const ids = members.filter(member => member.batch_index === batchIndex).map(member => member.document_version_id);
  const rehydrated = await runtime.rehydrateMembers(database, ids, { job, batch: { batchIndex } });
  const step = await runtime.callModel({ job, database, modelId: model, members: rehydrated, batch: { phase: 'member_batch_analysis', batchIndex, requestHash: `sim-${batchIndex}` } });
  memberOutputs.push({ memberId: `batch:${batchIndex}`, content: step.output, contentHash: step.outputSha256 });
  tokens += step.usage.totalTokens; cost += step.usage.costUsd;
  console.log(`lote ${batchIndex}: ${ids.length} documentos, ${step.output.analysis_notes.length} notas`);
}
try {
  const synthesis = await runtime.callModel({ job, database, modelId: model, members: memberOutputs, batch: { phase: 'synthesis', batchIndex: batches.length, requestHash: 'sim-synthesis' } });
  tokens += synthesis.usage.totalTokens; cost += synthesis.usage.costUsd;
  const envelope = synthesis.output;
  const validation = validatePreGoAnalysisV2(envelope);
  if (arg('out')) writeFileSync(arg('out'), JSON.stringify(envelope, null, 2));
  console.log(JSON.stringify({
    resultado: validation.ok ? 'PASS' : 'FAIL', alcance: scope, minutos: ((Date.now() - started) / 60000).toFixed(1),
    tokens, costo_usd: Number(cost.toFixed(3)),
    recomendacion: envelope.recommendation?.kind, encaje_empresa: envelope.company_fit?.overall_label,
    requisitos: (envelope.requirements || []).map(r => `${r.category}:${r.company_evaluation}`),
    hallazgos: (envelope.findings || []).map(f => `${f.severity} ${f.title}`),
  }, null, 1));
} catch (error) {
  console.log(JSON.stringify({ resultado: 'FAIL', code: error?.code, diagnostic: error?.diagnostic ?? null, message: String(error?.message).slice(0, 300) }, null, 1));
  process.exitCode = 1;
}
