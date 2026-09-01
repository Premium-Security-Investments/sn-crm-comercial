// AGT-002 actionable review/knowledge — migration 078 structural contract
// (design §§9-11, §23). RED reason: neither
// `supabase/migrations/078_agt002_actionable_review_knowledge.sql` nor its
// rollback exist yet on this branch (077 is still the highest present
// migration), so `readFileSync` throws ENOENT before any assertion runs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../supabase/migrations/078_agt002_actionable_review_knowledge.sql', import.meta.url), 'utf8',
);
const rollback = readFileSync(
  new URL('../supabase/rollbacks/078_agt002_actionable_review_knowledge_rollback.sql', import.meta.url), 'utf8',
);

const FACT_TABLES = [
  'psi_tender_actionable_review_items',
  'psi_tender_actionable_review_events',
  'psi_tender_actionable_review_attachments',
  'psi_tender_actionable_review_upload_tickets',
  'psi_tender_actionable_review_resolution_supports',
  'psi_tender_knowledge_items',
  'psi_tender_knowledge_versions',
  'psi_tender_knowledge_version_sources',
  'psi_tender_knowledge_events',
  'psi_tender_knowledge_publications',
];

const RPC_NAMES = [
  'psi_ensure_tender_actionable_review_item',
  'psi_record_tender_actionable_review_comment',
  'psi_issue_tender_actionable_review_upload_ticket',
  'psi_complete_tender_actionable_review_attachment',
  'psi_record_tender_actionable_review_outcome',
  'psi_reopen_tender_actionable_review',
  'psi_create_tender_knowledge_candidate',
  'psi_add_tender_knowledge_version',
  'psi_submit_tender_knowledge_version',
  'psi_approve_tender_knowledge_version',
  'psi_reject_tender_knowledge_version',
  'psi_record_tender_knowledge_publication',
];

// --- envelope ----------------------------------------------------------------
assert.match(migration, /^begin;/i, '078 must be wrapped in a single transaction');
assert.match(migration, /commit;\s*$/i, '078 must commit at the end');

// --- §9: every fact table exists, enables RLS, and locks down default grants -
for (const table of FACT_TABLES) {
  assert.match(
    migration,
    new RegExp(`create table (if not exists )?public\\.${table}\\b`, 'i'),
    `078 must create public.${table}`,
  );
  assert.match(
    migration,
    new RegExp(`alter table public\\.${table} enable row level security`, 'i'),
    `078 must enable RLS on public.${table}`,
  );
  assert.match(
    migration,
    new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`, 'i'),
    `078 must revoke public/anon/authenticated on public.${table}`,
  );
  assert.match(
    migration,
    new RegExp(`revoke (all|insert, update, delete) on public\\.${table} from service_role`, 'i'),
    `078 must revoke direct write from service_role on public.${table}`,
  );
  assert.match(
    migration,
    new RegExp(`grant select on public\\.${table} to service_role`, 'i'),
    `078 must grant service_role read-only on public.${table}`,
  );
}

// --- §9: append-only triggers reject UPDATE/DELETE on every fact table, with
// the single documented exception for upload_tickets' monotonic consumed_at.
for (const table of FACT_TABLES) {
  if (table === 'psi_tender_actionable_review_upload_tickets') continue;
  assert.match(
    migration,
    new RegExp(`before update or delete on public\\.${table}`, 'i'),
    `078 must install a BEFORE UPDATE OR DELETE append-only guard on public.${table}`,
  );
}
assert.match(
  migration,
  /before update or delete on public\.psi_tender_actionable_review_upload_tickets/i,
  '078 must install a mutation guard on upload_tickets even though it allows one transition',
);
assert.match(
  migration,
  /consumed_at/i,
  '078 upload_tickets guard must reference consumed_at as the sole allowed transition',
);
assert.doesNotMatch(
  migration,
  /before update or delete on public\.psi_tender_actionable_review_upload_tickets[\s\S]{0,2000}reject/i,
  '078 must not blanket-reject every UPDATE on upload_tickets (consumed_at must be settable exactly once)',
);

// --- §11: exact RPC names, all SECURITY DEFINER with a locked search_path,
// revoked from PUBLIC/anon/authenticated, granted only to service_role -------
for (const fn of RPC_NAMES) {
  assert.match(migration, new RegExp(`function public\\.${fn}\\(`, 'i'), `078 must define public.${fn}`);
  assert.match(
    migration,
    new RegExp(`function public\\.${fn}\\([^;]*?security definer[\\s\\S]{0,400}?set\\s+search_path\\s*=\\s*public\\s*,\\s*pg_temp`, 'i'),
    `078 ${fn} must be SECURITY DEFINER with search_path = public, pg_temp`,
  );
  assert.match(
    migration,
    new RegExp(`revoke all on function public\\.${fn}[\\s\\S]{0,200}from`, 'i'),
    `078 must revoke default EXECUTE on public.${fn}`,
  );
  assert.match(
    migration,
    new RegExp(`grant execute on function public\\.${fn}[\\s\\S]{0,200}to service_role`, 'i'),
    `078 must grant EXECUTE on public.${fn} only to service_role`,
  );
}

// --- §9.1 identity key and indexes -------------------------------------------
assert.match(
  migration,
  /unique[\s\S]{0,80}\(\s*analysis_run_id\s*,\s*source_kind\s*,\s*source_id\s*\)/i,
  '078 items table must enforce identity uniqueness on (analysis_run_id, source_kind, source_id)',
);
assert.match(migration, /source_kind[\s\S]{0,40}in\s*\(\s*'integral_unit'\s*,\s*'decision_review_finding'\s*\)/i,
  '078 items table must constrain source_kind to the two closed values');
assert.match(migration, /hash_contract[\s\S]{0,40}'agt002-actionable-review-json-v1'/i,
  '078 items table must pin hash_contract to the exact contract literal');

// --- §9.2 events: sequence, event_type enum, idempotency, request hash -------
assert.match(migration, /event_type[\s\S]{0,80}in\s*\(\s*'review_started'\s*,\s*'comment_added'\s*,\s*'attachment_added'\s*,\s*'outcome_recorded'\s*,\s*'reopened'\s*,\s*'knowledge_requested'\s*\)/i,
  '078 events table must constrain event_type to the six closed values');
assert.match(migration, /unique[\s\S]{0,60}\(\s*review_item_id\s*,\s*sequence\s*\)|unique[\s\S]{0,60}sequence[\s\S]{0,60}review_item_id/i,
  '078 events table must enforce a unique sequence per item');
assert.match(migration, /unique[\s\S]{0,60}\(\s*actor_id\s*,\s*idempotency_key\s*\)/i,
  '078 events table must enforce global idempotency uniqueness on (actor_id, idempotency_key)');
assert.match(migration, /for update/i, '078 RPCs must lock the item/version row with FOR UPDATE before assigning sequence');

// --- §9.3/§9.8: deferred constraint triggers enforcing exact bijections ------
assert.match(migration, /constraint trigger[\s\S]{0,400}deferrable initially deferred/i,
  '078 must install at least one DEFERRABLE INITIALLY DEFERRED constraint trigger');
const deferredTriggerCount = (migration.match(/constraint trigger[\s\S]{0,200}deferrable initially deferred/gi) || []).length;
assert.ok(deferredTriggerCount >= 2,
  '078 must install both the attachment/event bijection trigger (§9.3) and the knowledge version/sources trigger (§9.8)');

// --- §9.6/§9.7: knowledge scope/confidentiality closed enums -----------------
assert.match(migration, /scope_type[\s\S]{0,60}in\s*\(\s*'general'\s*,\s*'regional'\s*,\s*'cliente'\s*,\s*'tipo_servicio'\s*\)/i,
  '078 knowledge_items must constrain scope_type to the four closed values');
assert.match(migration, /confidentiality[\s\S]{0,60}in\s*\(\s*'interno'\s*,\s*'restringido'\s*\)/i,
  '078 knowledge_versions must constrain confidentiality to the two closed values');
assert.match(migration, /agent_reuse_allowed[\s\S]{0,400}restringido/i,
  '078 must enforce that confidentiality = restringido implies agent_reuse_allowed = false');

// --- §9.10: publication root is the exact literal, never derived from title -
assert.match(migration, /'Comercial\/Licitaciones\/02 Biblioteca corporativa'/,
  '078 must pin library_root to the exact approved corporate root');

// --- §16.1: relative path is <scope_type>/<knowledge_item_id>.md, not title -
assert.doesNotMatch(migration, /relative_path[\s\S]{0,120}title/i,
  '078 must never derive relative_path from a human title');

// --- independence from "Archivar como aprendizaje" (045) --------------------
assert.doesNotMatch(migration, /psi_agt002_learning_proposals|psi_agt002_learning_decisions|psi_agt002_workbench/i,
  '078 must be autonomous of the Mesa Vig-IA / "Archivar como aprendizaje" tables');
assert.doesNotMatch(migration, /reanalyzeAgt002AfterHumanAnswer|psi_agt002_reanalysis_jobs|psi_begin_tender_document_refresh/i,
  '078 must never wire into canonical reanalysis or document refresh');
assert.doesNotMatch(migration, /drop\s+table|truncate/i, '078 must be additive only, never drop or truncate');

// --- crypto hardening: no MD5-doubling, no misleading PGlite/pgcrypto excuse,
// and the ticket nonce/payload hash are Node-owned parameters, never SQL-
// generated or SQL-hashed values ---------------------------------------------
assert.doesNotMatch(migration, /md5\(/i, '078 must never use md5() — every hash persisted by this migration must be a real SHA-256');
assert.doesNotMatch(migration, /pglite/i, '078 must not carry a misleading PGlite/pgcrypto justification for a weak hash construction');
assert.match(migration, /p_nonce_hash text/i, '078 issue/complete RPCs must accept p_nonce_hash, never a plaintext p_nonce, as their nonce parameter');
assert.doesNotMatch(migration, /p_nonce\s+text/i, '078 must never declare a plaintext p_nonce parameter');
assert.match(migration, /p_payload_hash text/i, '078 issue RPC must accept p_payload_hash as a Node-computed parameter instead of deriving it in SQL');

// --- §23 rollback: fail-closed preflight before any destructive DDL ---------
assert.match(rollback, /^begin;/i, 'rollback must be wrapped in a single transaction');
for (const table of FACT_TABLES) {
  assert.match(rollback, new RegExp(`public\\.${table}`, 'i'), `rollback preflight must inspect public.${table} for existing rows`);
}
assert.match(rollback, /raise exception/i, 'rollback must fail closed (raise exception) when preflight finds any row');
assert.match(rollback, /for each row execute function/i, 'rollback must explicitly drop the append-only/constraint triggers');
for (const fn of RPC_NAMES) {
  assert.match(rollback, new RegExp(`drop function if exists public\\.${fn}`, 'i'), `rollback must drop public.${fn}`);
}
for (const table of FACT_TABLES) {
  assert.match(rollback, new RegExp(`drop table if exists public\\.${table}`, 'i'), `rollback must drop public.${table}`);
}
assert.doesNotMatch(rollback, /delete\s+from\s+public\.psi_tender_analysis_runs|drop\s+table.*psi_tender_analysis_runs/i,
  'rollback must never touch the canonical analysis runs table');

console.log('AGT-002 actionable review migration 078 static structural contract passed');
