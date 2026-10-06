#!/usr/bin/env node
// Freezes the current company procurement profile as an immutable snapshot (migration 107) and prints the id and
// hash to put in an INITIAL A_PLUS_B manifest (profile_snapshot_id / profile_snapshot_hash). Idempotent by hash.
// Usage: node scripts/agt002-company-profile-freeze.mjs --actor <psi_sales_profiles.id>
import { createClient } from '@supabase/supabase-js';
import { freezeAgt002CompanyProfileSnapshot } from '../agt002-company-profile-snapshot.js';

const index = process.argv.indexOf('--actor');
const actorProfileId = index > 0 ? process.argv[index + 1] : '';
if (!/^[0-9a-f-]{36}$/i.test(actorProfileId || '')) {
  console.error('Uso: node scripts/agt002-company-profile-freeze.mjs --actor <uuid del perfil que autoriza>');
  process.exit(2);
}
const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!url || !key) { console.error(JSON.stringify({ event: 'agt002_company_profile_freeze_failed', code: 'CONFIG_MISSING' })); process.exit(1); }
try {
  const result = await freezeAgt002CompanyProfileSnapshot(createClient(url, key, { auth: { persistSession: false } }), { actorProfileId });
  console.log(JSON.stringify({ event: 'agt002_company_profile_frozen', ...result }));
} catch (error) {
  console.error(JSON.stringify({ event: 'agt002_company_profile_freeze_failed', code: error?.diagnostic?.reason || 'FREEZE_FAILED' }));
  process.exitCode = 1;
}
