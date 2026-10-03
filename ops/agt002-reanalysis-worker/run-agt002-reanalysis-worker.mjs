#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import { createAgt002ReanalysisExecutor } from '../../agt002-reanalysis-executor.js';
import { createAgt002ReanalysisWorker } from '../../agt002-reanalysis-worker.js';
import { claimAgt002ReanalysisJobById } from '../../agt002-reanalysis-jobs.js';
import { resolveAgt002GovernedDocumentForExecution } from '../../agt002-governed-document-rehydration.js';
import { resolveAgt002GovernedContextVersionForExecution } from '../../agt002-governed-context-version-rehydration.js';
import { buildReanalysisWorkerIdentity } from '../../agt002-control-plane-surface-builders.js';
import { resolveAgt002ReleaseArtifactEvidence } from '../../agt002-control-plane-runtime-evidence.js';

const REANALYSIS_WORKER_RELATIVE_PATH = 'ops/agt002-reanalysis-worker/run-agt002-reanalysis-worker.mjs';

// --control-plane: side-effect-free identity report, gated before any secret/client
// requirement below. Never trusts an env-var/config claim -- the sha/version are only ever
// reported when this exact script's realpath resolves into the immutable releases/<sha>/ tree
// (see agt002-control-plane-runtime-evidence.js); otherwise the surface stays honestly
// unobserved.
if (process.argv.includes('--control-plane')) {
  const evidence = resolveAgt002ReleaseArtifactEvidence({
    scriptPath: fileURLToPath(import.meta.url),
    relativePath: REANALYSIS_WORKER_RELATIVE_PATH,
  });
  console.log(JSON.stringify(buildReanalysisWorkerIdentity({
    releaseSha: evidence.sha,
    version: evidence.version,
  })));
  process.exit(0);
}

const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const targetJobId = String(process.env.AGT002_REANALYSIS_TARGET_JOB_ID || '').trim();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

if (!supabaseUrl || !serviceRoleKey || (targetJobId && !UUID_RE.test(targetJobId))) {
  console.error(JSON.stringify({ event: 'agt002_reanalysis_worker_unavailable', code: 'CONFIG_MISSING' }));
  process.exit(1);
}

const database = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
const executeJob = createAgt002ReanalysisExecutor({
  environment: process.env,
  governedDocumentResolver: args => resolveAgt002GovernedDocumentForExecution(database, args),
  governedContextVersionResolver: resolveAgt002GovernedContextVersionForExecution,
});
const claimJob = targetJobId
  ? (db, { leaseSeconds }) => claimAgt002ReanalysisJobById(db, { jobId: targetJobId, leaseSeconds })
  : undefined;
const worker = createAgt002ReanalysisWorker({ database, executeJob, leaseSeconds: 600, ...(claimJob ? { claimJob } : {}) });

try {
  const result = await worker.runOnce();
  console.log(JSON.stringify({ event: 'agt002_reanalysis_worker_finished', ...result }));
} catch {
  console.error(JSON.stringify({ event: 'agt002_reanalysis_worker_failed', code: 'WORKER_FAILURE' }));
  process.exit(1);
}
