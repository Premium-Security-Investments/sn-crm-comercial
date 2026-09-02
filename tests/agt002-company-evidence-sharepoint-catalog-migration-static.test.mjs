// AGT-002 — migration 080 (governed SharePoint company-evidence catalog) structural contract.
//
// RED reason: neither `supabase/migrations/080_agt002_company_evidence_sharepoint_catalog.sql`
// nor its rollback nor the reviewed safe fixture exist on this branch (079 is the highest
// migration present), so `readFileSync` throws ENOENT before any assertion runs.
//
// This file pins the *structure* of the DDL (names, closed checks, RLS, privilege posture,
// the single security-definer RPC) and the *safety* of the reviewed fixture. Behavior —
// seeded counts, the RPC's actual payload, hash sensitivity, apply/rollback idempotency —
// is proven against a real Postgres in the PGlite integration test alongside this one.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../supabase/migrations/080_agt002_company_evidence_sharepoint_catalog.sql', import.meta.url), 'utf8',
);
const rollback = readFileSync(
  new URL('../supabase/rollbacks/080_agt002_company_evidence_sharepoint_catalog_rollback.sql', import.meta.url), 'utf8',
);
const fixtureText = readFileSync(
  new URL('../fixtures/agt002/company-evidence/pereira-sharepoint-safe-catalog-v1.json', import.meta.url), 'utf8',
);

const DETAIL_TABLES = [
  'psi_agt002_company_evidence_source_files',
  'psi_agt002_company_evidence_source_file_links',
];
const RPC = 'psi_get_agt002_company_evidence_inventory_snapshot';
const GOVERNED_STATES = ['current_valid', 'historical_update_required', 'reported_unverified', 'absent_unknown', 'process_specific_template'];

// --- envelope ---------------------------------------------------------------
assert.match(migration, /^begin;/i, '080 must be wrapped in a single transaction');
assert.match(migration, /commit;\s*$/i, '080 must commit at the end');
assert.match(rollback, /^begin;/i, 'the 080 rollback must be wrapped in a single transaction');
assert.match(rollback, /commit;\s*$/i, 'the 080 rollback must commit at the end');

// --- pgcrypto prerequisite for the deterministic catalog fingerprint --------
assert.match(migration, /create schema if not exists extensions;/i, '080 must declare the extensions schema prerequisite');
assert.match(migration, /create extension if not exists pgcrypto with schema extensions;/i, '080 must declare pgcrypto in the extensions schema');
assert.doesNotMatch(migration, /\bmd5\s*\(/i, '080 must never use md5() — the catalog fingerprint is a real sha256');

// --- both detail tables exist, with the exact governed names ----------------
for (const table of DETAIL_TABLES) {
  assert.match(
    migration,
    new RegExp(`create table (if not exists )?public\\.${table}\\b`, 'i'),
    `080 must create public.${table}`,
  );
  assert.match(
    migration,
    new RegExp(`alter table public\\.${table} enable row level security`, 'i'),
    `080 must enable RLS on public.${table}`,
  );
  // Detail tables are internal: no client role and no service_role may touch them at all.
  // Every read goes through the security-definer RPC, which returns only the safe snapshot.
  for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
    assert.match(
      migration,
      new RegExp(`revoke all on (table )?public\\.${table} from [^;]*\\b${role}\\b`, 'i'),
      `080 must revoke all privileges on public.${table} from ${role}`,
    );
  }
  assert.doesNotMatch(
    migration,
    new RegExp(`grant [a-z, ()]+ on (table )?public\\.${table}\\b`, 'i'),
    `080 must never grant any table privilege on public.${table} — the RPC is the only read path`,
  );
}

// --- the source-file table stores opaque metadata only ----------------------
{
  const start = migration.search(/create table (if not exists )?public\.psi_agt002_company_evidence_source_files\b/i);
  assert.ok(start !== -1, 'source-files table definition not found');
  const end = migration.indexOf('\n);', start);
  assert.ok(end !== -1 && end > start, 'source-files table definition is not terminated');
  const definition = migration.slice(start, end);

  assert.match(definition, /disposition[\s\S]{0,160}'evidence'/i, '080 must carry an explicit evidence disposition');
  assert.match(definition, /disposition[\s\S]{0,160}'excluded_non_evidence'/i, '080 must carry an explicit excluded_non_evidence disposition');
  assert.match(
    definition,
    new RegExp(`governed_state[\\s\\S]{0,240}in\\s*\\(\\s*${GOVERNED_STATES.map(state => `'${state}'`).join("\\s*,\\s*")}\\s*\\)`, 'i'),
    '080 must constrain governed_state to exactly the five closed governed states, in catalog order',
  );
  // The whole point of "inventory, never copy": SharePoint remains the source of truth, so no
  // human-readable locator may ever be persisted here.
  for (const forbidden of ['web_url', 'weburl', 'file_name', 'display_name', 'relative_path', 'folder_path', 'parent_path', 'download_url']) {
    assert.doesNotMatch(
      definition,
      new RegExp(forbidden, 'i'),
      `080's source-file table must never declare a ${forbidden} column`,
    );
  }
}

// --- N:M links to the registry's own (entry_id, version) identity -----------
{
  const start = migration.search(/create table (if not exists )?public\.psi_agt002_company_evidence_source_file_links\b/i);
  assert.ok(start !== -1, 'source-file links table definition not found');
  const end = migration.indexOf('\n);', start);
  assert.ok(end !== -1 && end > start, 'source-file links table definition is not terminated');
  const definition = migration.slice(start, end);

  assert.match(definition, /source_file_id[\s\S]{0,200}references public\.psi_agt002_company_evidence_source_files/i,
    '080 links must reference the source-file row');
  assert.match(definition, /references public\.psi_agt002_company_evidence_registry\s*\(\s*entry_id\s*,\s*version\s*\)/i,
    '080 links must reference the registry\'s own versioned (entry_id, version) identity, never a loose text label');
  assert.match(definition, /unique[\s\S]{0,120}\(\s*source_file_id\s*,\s*entry_id\s*,\s*entry_version\s*\)/i,
    '080 links must be unique per (source_file_id, entry_id, entry_version) — N:M, never duplicated');
}

// --- exactly one security-definer read RPC, service_role only ---------------
assert.match(migration, new RegExp(`function public\\.${RPC}\\(`, 'i'), `080 must define public.${RPC}`);
assert.match(migration, /returns jsonb/i, `080's ${RPC} must return one JSON snapshot`);
assert.match(
  migration,
  new RegExp(`function public\\.${RPC}\\([^;]*?security definer[\\s\\S]{0,400}?set\\s+search_path\\s*=\\s*public\\s*,\\s*(extensions\\s*,\\s*)?pg_temp`, 'i'),
  `080's ${RPC} must be SECURITY DEFINER with a locked search_path`,
);
assert.match(
  migration,
  new RegExp(`revoke all on function public\\.${RPC}[\\s\\S]{0,200}from`, 'i'),
  `080 must revoke the default EXECUTE on public.${RPC}`,
);
assert.match(
  migration,
  new RegExp(`grant execute on function public\\.${RPC}[\\s\\S]{0,200}to service_role`, 'i'),
  `080 must grant EXECUTE on public.${RPC} to service_role`,
);
for (const role of ['anon', 'authenticated']) {
  assert.doesNotMatch(
    migration,
    new RegExp(`grant execute on function public\\.${RPC}[\\s\\S]{0,200}\\b${role}\\b`, 'i'),
    `080 must never grant EXECUTE on public.${RPC} to ${role}`,
  );
}
assert.equal(
  (migration.match(new RegExp(`create (or replace )?function public\\.${RPC}\\b`, 'gi')) || []).length,
  1,
  '080 must define the snapshot RPC exactly once — it is the single safe read path',
);
assert.doesNotMatch(
  migration,
  /grant execute on function public\.psi_(?!get_agt002_company_evidence_inventory_snapshot)/i,
  '080 must not grant EXECUTE on any function other than the snapshot RPC',
);

// --- the snapshot the RPC returns is the closed safe contract --------------
assert.match(migration, /'agt002-company-evidence-sharepoint-catalog-v1'/,
  '080 must pin the exact inventory_version literal the JS contract expects');
for (const key of ['inventory_version', 'catalog_snapshot_hash', 'source_file_count', 'excluded_non_evidence_count', 'state_counts', 'effective_state', 'last_reconciled_at']) {
  assert.match(migration, new RegExp(`'${key}'`), `080's snapshot RPC must build the '${key}' field`);
}

// --- nothing locator-shaped or personal may appear anywhere in the DDL/seed -
assert.doesNotMatch(migration, /https?:\/\//i, '080 must never persist a URL');
assert.doesNotMatch(migration, /sharepoint\.com|\/sites\/|\/drives\/|:\/root:/i, '080 must never persist a SharePoint locator');
assert.doesNotMatch(migration, /\.pdf|\.docx|\.xlsx|\.zip|\.jpg|\.png/i, '080 must never persist a file name/extension');
assert.doesNotMatch(migration, /c[eé]dula|pasaporte|correo electr[oó]nico|tel[eé]fono/i, '080 must never persist PII');

// --- the migration is additive: it never rewrites the governed registry -----
assert.doesNotMatch(migration, /drop\s+table|truncate/i, '080 must be additive only');
assert.doesNotMatch(
  migration,
  /(update|delete from|alter table)\s+public\.psi_agt002_company_evidence_registry/i,
  '080 must never mutate the human-approved evidence registry it links to',
);

// --- rollback: drops exactly what 080 added, and nothing else --------------
assert.match(rollback, new RegExp(`drop function if exists public\\.${RPC}`, 'i'), 'the rollback must drop the snapshot RPC');
for (const table of DETAIL_TABLES) {
  assert.match(rollback, new RegExp(`drop table if exists public\\.${table}`, 'i'), `the rollback must drop public.${table}`);
}
assert.doesNotMatch(
  rollback,
  /(drop|truncate|delete from|alter)\s+[a-z ]*public\.psi_agt002_company_evidence_registry/i,
  'the rollback must never touch the governed evidence registry (061/075)',
);
assert.doesNotMatch(
  rollback,
  /public\.psi_tender_analysis_runs|public\.psi_tender_actionable_review_items/i,
  'the rollback must never touch canonical analysis or actionable-review state',
);

// --- the reviewed fixture is itself a SAFE snapshot -------------------------
{
  const fixture = JSON.parse(fixtureText);
  assert.equal(fixture.inventory_version, 'agt002-company-evidence-sharepoint-catalog-v1');
  assert.match(fixture.catalog_snapshot_hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    Object.keys(fixture).sort(),
    ['catalog_snapshot_hash', 'classes', 'excluded_non_evidence_count', 'inventory_version', 'source_file_count', 'state_counts'].sort(),
    'the reviewed fixture must be exactly the safe snapshot contract, no extra fields',
  );

  // The live-safe facts of the adjudicated Rama Judicial Pereira historical folder.
  assert.equal(fixture.source_file_count, 93, 'the reviewed inventory holds 93 source rows');
  assert.equal(fixture.excluded_non_evidence_count, 1, 'exactly one row is dispositioned excluded_non_evidence');
  assert.deepEqual(fixture.state_counts, {
    current_valid: 0,
    historical_update_required: 25,
    reported_unverified: 50,
    absent_unknown: 0,
    process_specific_template: 17,
  }, 'the 92 evidence rows are 25 historical / 50 reported / 17 template — and nothing is current_valid');
  const evidenceTotal = Object.values(fixture.state_counts).reduce((sum, value) => sum + value, 0);
  assert.equal(evidenceTotal, 92, 'the five state counts must add up to the 92 evidence rows');
  assert.equal(evidenceTotal + fixture.excluded_non_evidence_count, fixture.source_file_count);

  assert.equal(fixture.classes.length, 17);
  assert.equal(new Set(fixture.classes.map(cls => cls.entry_id)).size, 17, 'all 17 technical classes must be represented, uniquely');
  for (const cls of fixture.classes) {
    assert.deepEqual(
      Object.keys(cls).sort(),
      ['effective_state', 'entry_id', 'last_reconciled_at', 'source_file_count', 'state_counts'].sort(),
    );
    assert.ok(cls.source_file_count >= 1, `${cls.entry_id} must be represented by at least one source file`);
    assert.equal(cls.state_counts.current_valid, 0, `${cls.entry_id}: historical evidence never declares currency`);
    assert.equal(cls.state_counts.absent_unknown, 0, `${cls.entry_id}: a linked file is never absent_unknown`);
    assert.ok(GOVERNED_STATES.includes(cls.effective_state));
    assert.notEqual(cls.effective_state, 'current_valid', 'no class may be current_valid: this is the historical adjudicated folder');
    assert.equal(
      Object.values(cls.state_counts).reduce((sum, value) => sum + value, 0),
      cls.source_file_count,
      `${cls.entry_id}: state counts must add up to its own source_file_count`,
    );
  }

  // Metadata only: never a name, a path, a URL, an eTag, a raw fingerprint or PII.
  const lowered = fixtureText.toLowerCase();
  for (const forbidden of ['http', 'sharepoint', '/sites/', '/drives/', 'web_url', 'etag', 'item_id', 'path', 'file_name', '.pdf', '.docx', '.zip', 'cedula', 'cédula']) {
    assert.ok(!lowered.includes(forbidden), `the reviewed fixture must never carry "${forbidden}"`);
  }
}

console.log('AGT-002 SharePoint company-evidence catalog migration 080 + safe fixture static contract passed');
