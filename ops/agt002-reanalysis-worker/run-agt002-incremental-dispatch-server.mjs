#!/usr/bin/env node
import { createServer } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { createAgt002IncrementalWorkerDispatchServer } from '../../agt002-incremental-worker-dispatch-server.js';
import { createAgt002ReanalysisExecutor } from '../../agt002-reanalysis-executor.js';
import { createAgt002IncrementalHostDrain } from '../../agt002-incremental-host-drain.js';
import { resolveAgt002GovernedDocumentForExecution } from '../../agt002-governed-document-rehydration.js';
import { resolveAgt002GovernedContextVersionForExecution } from '../../agt002-governed-context-version-rehydration.js';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Falta ${name}.`);
  return value;
}

const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');
const hmacSecret = required('AGT002_HETZNER_BRIDGE_HMAC_SECRET');
const port = Number(required('AGT002_INCREMENTAL_DISPATCH_LISTEN_PORT'));
if (!supabaseUrl || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Configuración incremental inválida.');

const database = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
const executeJob = createAgt002ReanalysisExecutor({
  environment: process.env,
  governedDocumentResolver: args => resolveAgt002GovernedDocumentForExecution(database, args),
  governedContextVersionResolver: resolveAgt002GovernedContextVersionForExecution,
});
const drain = createAgt002IncrementalHostDrain({ database, executeJob, environment: process.env });
const listener = createAgt002IncrementalWorkerDispatchServer({
  hmacSecret,
  dispatchJob: jobId => drain.run({ targetJobId: jobId }),
});

createServer(listener).listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'agt002_incremental_dispatch_listening', port, listen_host: '127.0.0.1' }));
});
