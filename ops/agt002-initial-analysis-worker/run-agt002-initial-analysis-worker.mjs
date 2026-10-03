#!/usr/bin/env node
// AGT-002 P0-05 — initial-analysis durable worker runner (docs/agt002/initial-analysis/
// CURRENT.md). Fails closed on both kill switches, then on missing Supabase config, before any
// Supabase client is ever created. Wires the real initial-analysis jobs/checkpoints/engine
// helpers; never imports, and is never imported by, any parallel operational runtime module.
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createAgt002InitialAnalysisWorker } from '../../agt002-initial-analysis-worker.js';
import { createAgt002InitialAnalysisExecutor } from '../../agt002-initial-analysis-executor.js';
import { claimAgt002InitialAnalysisJob, renewAgt002InitialAnalysisJobLease, failAgt002InitialAnalysisJob } from '../../agt002-initial-analysis-jobs.js';
import { resumeAgt002InitialAnalysisCheckpoint, storeAgt002InitialAnalysisCheckpoint } from '../../agt002-initial-analysis-checkpoints.js';
import { assertAgt002RehydratedMembersMatchHashes, runAgt002AnalysisBatch } from '../../agt002-analysis-engine.js';
import { completeAgt002InitialAnalysisJob } from '../../agt002-initial-analysis-persistence.js';

const LEASE_SECONDS = 600;

if (process.env.AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED !== 'true' || process.env.AGT002_MODEL_CALLS_ENABLED !== 'true') {
  console.error(JSON.stringify({ event: 'agt002_initial_analysis_worker_unavailable', code: 'KILL_SWITCH' }));
  process.exit(1);
}

const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!supabaseUrl || !serviceRoleKey) {
  console.error(JSON.stringify({ event: 'agt002_initial_analysis_worker_unavailable', code: 'CONFIG_MISSING' }));
  process.exit(1);
}

const database = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

// Neither a durable member-content store nor a model bridge has landed for the initial-analysis
// slice yet (docs/agt002/initial-analysis/CURRENT.md): both fail closed rather than fabricate
// output. A model-call failure here is still caught and remapped by runAgt002AnalysisBatch
// itself, onto the already-tested AGT002_ENGINE_MODEL_CALL_FAILED -> 'model_call_failed' path.
async function rehydrateAgt002InitialAnalysisMembers() {
  throw new Error('AGT-002 initial-analysis: la rehidratación de miembros aún no está disponible.');
}

async function callAgt002InitialAnalysisModel() {
  throw new Error('AGT-002 initial-analysis: la llamada al modelo aún no está disponible.');
}

function executeJob(db, job) {
  let usedTotalTokens = 0;
  const executor = createAgt002InitialAnalysisExecutor({
    rehydrateMembers: rehydrateAgt002InitialAnalysisMembers,
    assertMembersMatchHashes: assertAgt002RehydratedMembersMatchHashes,
    runBatch: async ({ modelId, members, expectedMemberIds }) => {
      const result = await runAgt002AnalysisBatch({
        members,
        expectedMemberIds,
        modelId,
        budget: job.payload.budget,
        usedTotalTokens,
        callModel: callAgt002InitialAnalysisModel,
      });
      usedTotalTokens += result.usage.totalTokens;
      return {
        output: result.output,
        outputSha256: createHash('sha256').update(JSON.stringify(result.output)).digest('hex'),
        usage: result.usage,
      };
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
  console.log(JSON.stringify({ event: 'agt002_initial_analysis_worker_finished', ...result }));
} catch {
  console.error(JSON.stringify({ event: 'agt002_initial_analysis_worker_failed', code: 'WORKER_FAILURE' }));
  process.exit(1);
}
