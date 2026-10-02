#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import { createTenderSourceReconciliation } from '../../tender-source-reconciliation.js';

const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!supabaseUrl || !serviceRoleKey) {
  // Exactly one safe JSON line on stdout even on a config failure -- never the key/url values --
  // so whatever invokes this one-shot can always parse a single summary line off stdout.
  console.log(JSON.stringify({ status: 'unavailable', code: 'AGT002_RADAR_RECONCILIATION_CONFIG_INVALID' }));
  process.exitCode = 1;
} else {
  try {
    const database = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const reconciliation = createTenderSourceReconciliation({ database, now: () => new Date().toISOString() });
    const result = await reconciliation.runOnce();
    console.log(JSON.stringify(result));
    if (result.status !== 'success') process.exitCode = 1;
  } catch {
    console.log(JSON.stringify({ status: 'unavailable', code: 'AGT002_RADAR_RECONCILIATION_FAILED' }));
    process.exitCode = 1;
  }
}
