import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

// Root cause: Supabase's default ACLs on the public schema grant anon full
// privileges the instant an object is created. 026/027 revoked from
// public/authenticated/service_role but never from anon, so anon silently
// kept table access and EXECUTE on every new SECURITY DEFINER function
// (including the GO/NO-GO decision RPC). This test statically enforces that
// every object 026/027 create — and every object their rollbacks
// create/restore — explicitly revokes from anon, without touching the
// pre-existing public/authenticated/service_role grants.
const read = relPath => readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8');

const migration026 = read('supabase/migrations/026_tender_document_versions.sql');
const migration027 = read('supabase/migrations/027_tender_decision_current_analysis.sql');
const rollback026 = read('supabase/rollbacks/026_tender_document_versions_rollback.sql');
const rollback027 = read('supabase/rollbacks/027_tender_decision_current_analysis_rollback.sql');

function assertRevokesFromAnon(source, label, objects) {
  for (const object of objects) {
    const pattern = new RegExp(`revoke\\s+all\\s+on\\s+${object.kind}\\s+${object.name}\\s+from\\s+anon\\s*;`, 'i');
    assert.match(source, pattern, `${label} must revoke all on ${object.kind} ${object.name} from anon`);
  }
}

// 026 creates 2 tables and 3 functions with SECURITY DEFINER / default-ACL exposure.
assertRevokesFromAnon(migration026, '026', [
  { kind: 'function', name: 'public\\.psi_is_public_https_url\\(text\\)' },
  { kind: 'table', name: 'public\\.psi_company_procurement_documents' },
  { kind: 'function', name: 'public\\.psi_record_company_procurement_document\\(text,\\s*text,\\s*date,\\s*date,\\s*text,\\s*text,\\s*text,\\s*bigint,\\s*uuid,\\s*uuid\\)' },
  { kind: 'table', name: 'public\\.psi_tender_document_versions' },
  { kind: 'function', name: 'public\\.psi_record_tender_document_version\\(uuid,\\s*uuid,\\s*text,\\s*text,\\s*text,\\s*text,\\s*text,\\s*text,\\s*bigint,\\s*text,\\s*text,\\s*text,\\s*uuid\\)' },
]);

// 027 creates 1 table and 6 functions (including the GO/NO-GO decision RPC).
assertRevokesFromAnon(migration027, '027', [
  { kind: 'table', name: 'public\\.psi_tender_document_state' },
  { kind: 'function', name: 'public\\.psi_invalidate_tender_state_from_legacy_upload\\(\\)' },
  { kind: 'function', name: 'public\\.psi_invalidate_tender_state_from_typed_version\\(\\)' },
  { kind: 'function', name: 'public\\.psi_begin_tender_document_refresh\\(uuid,\\s*uuid\\)' },
  { kind: 'function', name: 'public\\.psi_record_tender_document_snapshot\\(uuid,\\s*uuid,\\s*text,\\s*text,\\s*jsonb,\\s*jsonb,\\s*uuid,\\s*uuid\\)' },
  { kind: 'function', name: 'public\\.psi_record_tender_go_no_go\\(uuid,\\s*uuid,\\s*uuid,\\s*text,\\s*uuid,\\s*text,\\s*jsonb,\\s*text\\)' },
  { kind: 'function', name: 'public\\.psi_tender_analysis_foundation_ready\\(\\)' },
]);

// 027's rollback restores the 025-era 7-arg overloads of the snapshot and
// GO/NO-GO functions plus foundation_ready — each is a fresh `create or
// replace function`, so it must also be explicitly locked down from anon.
assertRevokesFromAnon(rollback027, '027 rollback', [
  { kind: 'function', name: 'public\\.psi_record_tender_document_snapshot\\(uuid,\\s*uuid,\\s*text,\\s*text,\\s*jsonb,\\s*jsonb,\\s*uuid\\)' },
  { kind: 'function', name: 'public\\.psi_record_tender_go_no_go\\(uuid,\\s*uuid,\\s*uuid,\\s*text,\\s*uuid,\\s*text,\\s*jsonb\\)' },
  { kind: 'function', name: 'public\\.psi_tender_analysis_foundation_ready\\(\\)' },
]);

// 026's rollback only revokes service_role EXECUTE on 2 pre-existing
// functions (no table drop, no function re-creation) — nothing new for anon
// to be granted, so no anon revoke is required there. This is asserted
// negatively so a future edit that starts recreating objects in 026's
// rollback is forced to reconsider anon exposure rather than being silently
// exempt forever.
assert.doesNotMatch(rollback026, /create (or replace )?function|create table/i, '026 rollback must not create/restore any object (if it starts to, it must also revoke from anon)');

// Preserve existing (already-correct) grants: public/authenticated/service_role
// revokes and the deliberate service_role EXECUTE/SELECT grants must survive untouched.
assert.match(migration026, /revoke all on function public\.psi_record_company_procurement_document\([^)]*\) from service_role;\nrevoke all on function public\.psi_record_company_procurement_document\([^)]*\) from anon;\ngrant execute on function public\.psi_record_company_procurement_document\([^)]*\) to service_role;/);
assert.match(migration027, /grant execute on function public\.psi_record_tender_go_no_go\(uuid, uuid, uuid, text, uuid, text, jsonb, text\) to service_role;/);
assert.match(rollback027, /grant execute on function public\.psi_record_tender_go_no_go\(uuid, uuid, uuid, text, uuid, text, jsonb\) to service_role;/);

console.log('026/027 anon grant remediation static test passed');
