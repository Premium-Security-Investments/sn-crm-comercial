#!/usr/bin/env node
// AGT-002 P0-05 — initial-analysis durable worker runner (docs/agt002/initial-analysis/
// CURRENT.md). Fails closed on both kill switches, then on missing Supabase config, before any
// Supabase client is ever created. Wires the real initial-analysis jobs/checkpoints/engine
// helpers; never imports, and is never imported by, any parallel operational runtime module.
import { createClient } from '@supabase/supabase-js';
import { createAgt002InitialAnalysisWorker } from '../../agt002-initial-analysis-worker.js';
import { createAgt002InitialAnalysisExecutor } from '../../agt002-initial-analysis-executor.js';
import { claimAgt002InitialAnalysisJob, renewAgt002InitialAnalysisJobLease, failAgt002InitialAnalysisJob } from '../../agt002-initial-analysis-jobs.js';
import { resumeAgt002InitialAnalysisCheckpoint, storeAgt002InitialAnalysisCheckpoint } from '../../agt002-initial-analysis-checkpoints.js';
import { assertAgt002RehydratedMembersMatchHashes, runAgt002AnalysisBatch } from '../../agt002-analysis-engine.js';
import { completeAgt002InitialAnalysisJob } from '../../agt002-initial-analysis-persistence.js';
import { createAgt002HetznerBridgeClient } from '../../agt002-hetzner-bridge-client.js';
import { createAgt002InitialAnalysisRuntime } from '../../agt002-initial-analysis-runtime.js';
import { createAgt002InitialAnalysisObserver, readAgt002InitialAnalysisRuntimeConfig } from '../../agt002-initial-analysis-observability.js';

const LEASE_SECONDS = 600;

if (process.env.AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED !== 'true'
    || process.env.AGT002_MODEL_CALLS_ENABLED !== 'true') {
  console.error(JSON.stringify({ event: 'agt002_initial_analysis_worker_unavailable', code: 'KILL_SWITCH' }));
  process.exit(1);
}
const runtimeConfig = readAgt002InitialAnalysisRuntimeConfig(process.env);
if (!runtimeConfig.runtimeReady) {
  console.error(JSON.stringify({ event: 'agt002_initial_analysis_worker_unavailable', code: 'KILL_SWITCH' }));
  process.exit(1);
}

const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!supabaseUrl || !serviceRoleKey) {
  console.error(JSON.stringify({ event: 'agt002_initial_analysis_worker_unavailable', code: 'CONFIG_MISSING' }));
  process.exit(1);
}

const bridgeHmacSecret = String(process.env.AGT002_BRIDGE_HMAC_SECRET || '').trim();
if (bridgeHmacSecret.length < 32) {
  console.error(JSON.stringify({ event: 'agt002_initial_analysis_worker_unavailable', code: 'BRIDGE_CONFIG_MISSING' }));
  process.exit(1);
}

const database = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
const observer = createAgt002InitialAnalysisObserver({ sink: event => console.log(JSON.stringify(event)) });
const runtime = createAgt002InitialAnalysisRuntime({
  bridgeClient: createAgt002HetznerBridgeClient({ hmacSecret: bridgeHmacSecret }),
});
observer.emit('runtime_readback', runtimeConfig);

function executeJob(db, job) {
  const executor = createAgt002InitialAnalysisExecutor({
    rehydrateMembers: runtime.rehydrateMembers,
    assertMembersMatchHashes: assertAgt002RehydratedMembersMatchHashes,
    runBatch: async ({ job: executingJob, batch, modelId, members, expectedMemberIds, usedTotalTokens, usedCostUsd }) => {
      const budget = executingJob.payload.budget;
      const execution = executingJob.payload.execution;
      if (modelId !== runtimeConfig.modelId
          || budget.maxTotalTokens !== runtimeConfig.maxTotalTokens
          || budget.maxCostUsd !== runtimeConfig.maxCostUsd
          || budget.inputCostPerMillionUsd !== runtimeConfig.inputCostPerMillionUsd
          || budget.outputCostPerMillionUsd !== runtimeConfig.outputCostPerMillionUsd
          || execution.timeoutMs !== runtimeConfig.timeoutMs
          || execution.reasoningEffort !== runtimeConfig.reasoningEffort) {
        const error = new Error('La configuración durable INITIAL no coincide con el readback del runtime.');
        error.code = 'AGT002_ENGINE_BUDGET_EXCEEDED';
        throw error;
      }
      const result = await runAgt002AnalysisBatch({
        members,
        expectedMemberIds,
        modelId,
        budget,
        usedTotalTokens,
        usedCostUsd,
        callModel: async args => {
          try {
            return await runtime.callModel({
              ...args, job: executingJob, batch, database: db,
              // Several model calls inside one durable batch: keep the lease alive between them.
              heartbeat: () => renewAgt002InitialAnalysisJobLease(db, {
                jobId: executingJob.jobId, leaseId: executingJob.leaseId, fenceVersion: executingJob.fenceVersion, leaseSeconds: LEASE_SECONDS,
              }),
            });
          } catch (error) {
            // The engine collapses every model-call failure into one generic code; this closed diagnostic (reason
            // and validator paths/codes only, never model or document content) keeps the cause observable.
            console.error(JSON.stringify({
              event: 'agt002_initial_analysis_model_call_diagnostic',
              job_id: executingJob.jobId,
              phase: batch.phase,
              code: typeof error?.code === 'string' ? error.code : 'UNKNOWN',
              ...(error?.diagnostic ? { diagnostic: error.diagnostic } : {}),
            }));
            throw error;
          }
        },
      });
      return result;
    },
    resumeCheckpoint: resumeAgt002InitialAnalysisCheckpoint,
    storeCheckpoint: storeAgt002InitialAnalysisCheckpoint,
    renewLease: (db2, args) => renewAgt002InitialAnalysisJobLease(db2, { ...args, leaseSeconds: LEASE_SECONDS }),
  });
  return executor(db, job);
}

const worker = createAgt002InitialAnalysisWorker({
  database,
  leaseSeconds: LEASE_SECONDS,
  claimJob: claimAgt002InitialAnalysisJob,
  executeJob,
  completeJob: completeAgt002InitialAnalysisJob,
  failJob: failAgt002InitialAnalysisJob,
});

try {
  const result = await worker.runOnce();
  if (result.status === 'completed') observer.emit('job_completed', { jobId: result.jobId });
  if (result.status === 'unavailable') observer.emit('job_failed', { jobId: result.jobId, errorCode: result.errorCode });
  console.log(JSON.stringify({ event: 'agt002_initial_analysis_worker_finished', ...result }));
} catch {
  console.error(JSON.stringify({ event: 'agt002_initial_analysis_worker_failed', code: 'WORKER_FAILURE' }));
  process.exit(1);
}
