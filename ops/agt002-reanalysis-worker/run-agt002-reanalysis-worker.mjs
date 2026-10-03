#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import { createAgt002ReanalysisExecutor } from '../../agt002-reanalysis-executor.js';
import { createAgt002ReanalysisWorker } from '../../agt002-reanalysis-worker.js';

const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!supabaseUrl || !serviceRoleKey) {
  console.error(JSON.stringify({ event: 'agt002_reanalysis_worker_unavailable', code: 'CONFIG_MISSING' }));
  process.exit(1);
}

const database = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
const executeJob = createAgt002ReanalysisExecutor({ environment: process.env });
const worker = createAgt002ReanalysisWorker({ database, executeJob, leaseSeconds: 600 });

try {
  const result = await worker.runOnce();
  console.log(JSON.stringify({ event: 'agt002_reanalysis_worker_finished', ...result }));
} catch {
  console.error(JSON.stringify({ event: 'agt002_reanalysis_worker_failed', code: 'WORKER_FAILURE' }));
  process.exit(1);
}
