#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import { aplicarCierresDelPliego } from '../../verticales/licitaciones/tender-cierre-pliego.js';
import { createTenderSourceReconciliation } from '../../verticales/licitaciones/tender-source-reconciliation.js';

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
    // Primero el cierre del pliego (Juan, 2026-11-15: el pliego manda): así la conciliación ya lo encuentra marcado y no
    // lo mueve. Si este paso falla, la conciliación corre igual y el fallo queda en la línea de resumen.
    let cierresPliego;
    try { cierresPliego = await aplicarCierresDelPliego(database); }
    catch { cierresPliego = { status: 'failed', code: 'AGT002_CIERRE_PLIEGO_FAILED' }; }
    const reconciliation = createTenderSourceReconciliation({ database, now: () => new Date().toISOString() });
    const result = await reconciliation.runOnce();
    console.log(JSON.stringify({ ...result, cierres_pliego: cierresPliego }));
    if (result.status !== 'success') process.exitCode = 1;
  } catch {
    console.log(JSON.stringify({ status: 'unavailable', code: 'AGT002_RADAR_RECONCILIATION_FAILED' }));
    process.exitCode = 1;
  }
}
