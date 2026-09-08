// Fase 2 SQL del traspaso AGT-002 -> expediente post-GO (migración 082) — contrato
// estructural. RED reason: `supabase/migrations/082_tender_dossier_agt002_handoff.sql` no
// existía en esta rama, así que `readFileSync` fallaba con ENOENT antes de correr cualquier
// aserción.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../supabase/migrations/082_tender_dossier_agt002_handoff.sql', import.meta.url), 'utf8',
);

// --- envelope -----------------------------------------------------------------
assert.match(migration, /^begin;/im, '082 must be wrapped in a single transaction');
assert.match(migration, /commit;\s*$/i, '082 must commit at the end');
assert.doesNotMatch(migration, /drop\s+table|truncate/i, '082 must be additive only, never drop or truncate');

// --- 1) origin ampliado, seed_go/human preservados -----------------------------
assert.match(
  migration,
  /origin in \('seed_go', 'human', 'seed_agt002_post_go'\)/,
  '082 must widen the origin check to add seed_agt002_post_go while preserving seed_go and human',
);

// --- 2) tabla de proveniencia append-only --------------------------------------
const TABLE = 'psi_tender_dossier_agt002_sources';
assert.match(migration, new RegExp(`create table (if not exists )?public\\.${TABLE}\\b`, 'i'),
  `082 must create public.${TABLE}`);
for (const fk of ['dossier_item_id', 'opportunity_id', 'tender_id', 'decision_id', 'analysis_run_id', 'actor_id']) {
  assert.match(migration, new RegExp(`${fk} uuid not null references public\\.`, 'i'),
    `082 ${TABLE}.${fk} must be a NOT NULL FK`);
}
assert.match(migration, /source_kind text not null check \(source_kind = 'integral_unit'\)/,
  '082 must constrain source_kind to the single closed value integral_unit');
assert.match(migration, /source_hash text not null check \(source_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/,
  '082 must constrain source_hash to lowercase SHA-256 hex');

// The Node-supplied source_hash is audit metadata only: it is never verified server-side, so it
// must not gate provenance identity nor the requirement_changed event. The verified unit payload
// read from the anchored run's own result is what governs both.
assert.match(migration, /source_payload jsonb not null check \(jsonb_typeof\(source_payload\) = 'object'\)/,
  '082 must persist the verified V3 unit payload alongside the audit-only source_hash');
assert.match(
  migration,
  /add constraint psi_tender_dossier_agt002_sources_identity_key\s*unique \(dossier_item_id, analysis_run_id, source_id\)/i,
  '082 must key provenance identity on (dossier_item_id, analysis_run_id, source_id), with source_hash excluded',
);
assert.doesNotMatch(
  migration,
  /unique[\s\S]{0,60}\(\s*dossier_item_id\s*,\s*analysis_run_id\s*,\s*source_id\s*,\s*source_hash\s*\)/i,
  '082 must never let a differing source_hash split the identity of one repeated (item, run, unit)',
);
assert.match(
  migration,
  /on conflict \(dossier_item_id, analysis_run_id, source_id\) do nothing/i,
  '082 must treat a repeated (item, run, unit) as a no-op regardless of the submitted hash',
);
assert.match(
  migration,
  /jsonb_build_object\('source_kind', 'integral_unit'\) \|\| u into v_source_payload/,
  '082 must derive source_payload in SQL from the exact unit `u` read from the anchored run result',
);
assert.match(
  migration,
  /v_previous_payload is not null and v_previous_payload is distinct from v_source_payload/,
  '082 must decide requirement_changed by comparing verified unit payloads, never source_hash',
);
assert.doesNotMatch(
  migration,
  /v_previous_hash/,
  '082 must not keep any hash-comparison branch driving behavior',
);
assert.match(
  migration,
  /create index[\s\S]{0,250}\(\s*opportunity_id\s*,\s*requirement_id\s*,\s*created_at desc\s*\)/i,
  '082 must index (opportunity_id, requirement_id, created_at desc)',
);
assert.match(migration, new RegExp(`before update or delete on public\\.${TABLE}`, 'i'),
  `082 must install an append-only guard on public.${TABLE}`);
assert.match(migration, new RegExp(`alter table public\\.${TABLE} enable row level security`, 'i'),
  `082 must enable RLS on public.${TABLE}`);
assert.match(migration, new RegExp(`revoke all on table public\\.${TABLE} from authenticated`, 'i'),
  `082 must revoke authenticated on public.${TABLE}`);
assert.match(migration, new RegExp(`grant select on table public\\.${TABLE} to service_role`, 'i'),
  `082 must grant service_role read-only on public.${TABLE}`);

// --- 3) RPC de sincronización: service-role-only, security definer ------------
const RPC = 'psi_sync_agt002_post_go_checklist';
assert.match(migration, new RegExp(`create or replace function public\\.${RPC}\\(`, 'i'), `082 must define public.${RPC}`);
assert.match(
  migration,
  new RegExp(`function public\\.${RPC}\\([^;]*?security definer[\\s\\S]{0,400}?set\\s+search_path\\s*=\\s*public\\s*,\\s*pg_temp`, 'i'),
  `082 ${RPC} must be SECURITY DEFINER with search_path = public, pg_temp`,
);
assert.match(migration, new RegExp(`revoke all on function public\\.${RPC}[\\s\\S]{0,300}from authenticated`, 'i'),
  `082 must revoke default EXECUTE on public.${RPC} from authenticated`);
assert.match(migration, new RegExp(`grant execute on function public\\.${RPC}[\\s\\S]{0,200}to service_role`, 'i'),
  `082 must grant EXECUTE on public.${RPC} only to service_role`);

// The RPC must re-derive eligibility from the run's own analysis_units, never trust the
// caller's shape without cross-checking unit_kind/closure.status.
assert.match(migration, /unit_kind' = 'tender_requirement'/, '082 must re-verify unit_kind = tender_requirement server-side');
assert.match(migration, /'evidence_satisfied'/, '082 must exclude evidence_satisfied units server-side');
assert.match(migration, /agt002_post_go:/, "082 must validate the exact item_key prefix agt002_post_go:<requirement_id>");

// --- 4) fail-closed authorization/anchoring reuses the 040 helpers, never a new gate ----
assert.match(migration, /psi_assert_tender_dossier_actor\(p_actor_id, false\)/, '082 must reuse the 040 actor helper');
assert.match(migration, /psi_assert_tender_dossier_go\(p_opportunity_id\)/, '082 must reuse the 040 current-GO helper');

// The whole GO/supersession-chain/run resolution must happen under a row lock on the opportunity,
// otherwise a concurrent NO-GO (or a GO anchored to another run) can land between validation and
// write and the batch is seeded against a state that stopped being true.
assert.match(
  migration,
  /perform 1 from public\.psi_sales_opportunities where id = p_opportunity_id for update;[\s\S]{0,400}?psi_assert_tender_dossier_go\(p_opportunity_id\)/,
  '082 must take the opportunity row lock BEFORE resolving the current GO / chain / run',
);

// --- 4 bis) item-key squatting: the reserved key space is closed on both sides -----------
const createItem = migration.match(
  /create or replace function public\.psi_create_tender_dossier_item\([\s\S]*?\n\$\$;/,
)?.[0];
assert.ok(createItem, '082 must override psi_create_tender_dossier_item to close the reserved key space');
assert.match(
  createItem,
  /left\(btrim\(coalesce\(p_item_key, ''\)\), 15\) = 'agt002_post_go:'/,
  '082 must reject manual creation of any item_key whose btrim starts with agt002_post_go:',
);
// The override must be 040's logic plus that single rejection — never a rewrite of the RPC.
for (const [label, pattern] of [
  ['actor gate', /perform public\.psi_assert_tender_dossier_actor\(p_actor_id, false\);/],
  ['current-GO gate', /v_tender_id := public\.psi_assert_tender_dossier_go\(p_opportunity_id\);/],
  ['item type check', /p_item_type not in \('documento','pendiente_humano','general'\)/],
  ['title check', /El ítem requiere un título/],
  ['human origin', /'human', p_actor_id\)/],
  ['idempotent insert', /on conflict \(opportunity_id, item_key\) do nothing/],
  ['created action', /'created', 'pendiente', 'requerido', p_actor_id/],
]) {
  assert.match(createItem, pattern,
    `the 082 override of psi_create_tender_dossier_item must keep the 040 logic (${label})`);
}
// The sync must revalidate under FOR UPDATE instead of adopting whatever row holds the key.
assert.match(
  migration,
  /select \* into v_existing_item from public\.psi_tender_dossier_items\s*\n\s*where opportunity_id = p_opportunity_id and item_key = v_key for update;/,
  '082 must lock the pre-existing/conflict-lost row before deciding anything about it',
);
for (const guard of [
  "v_existing_item\\.origin is distinct from 'seed_agt002_post_go'",
  "v_existing_item\\.item_type is distinct from 'pendiente_humano'",
  'v_existing_item\\.required is distinct from true',
  'v_existing_item\\.opportunity_id is distinct from p_opportunity_id',
  'v_existing_item\\.tender_id is distinct from v_tender_id',
]) {
  assert.match(migration, new RegExp(guard), `082 must refuse to adopt a foreign row (${guard})`);
}

// --- 5) projection extension preserves prior keys and adds instruction/analysis_source --
assert.match(migration, /create or replace function public\.psi_project_tender_dossier_item\(p_item_id uuid\)/,
  '082 must extend psi_project_tender_dossier_item in place');
for (const priorKey of ['id', 'item_key', 'title', 'item_type', 'required', 'origin', 'status', 'applicability', 'assignee_id', 'target_date', 'latest_evidence']) {
  assert.match(migration, new RegExp(`'${priorKey}',`), `082 must preserve the prior projection key ${priorKey}`);
}
assert.match(migration, /'instruction',/, '082 must add the instruction projection key');
assert.match(migration, /'analysis_source',/, '082 must add the analysis_source projection key');

// 040 left this SECURITY DEFINER projection on the default PUBLIC EXECUTE grant, so any role
// holding an item uuid could read the full dossier item state around RLS. 082 closes it.
for (const role of ['public', 'anon', 'authenticated']) {
  assert.match(
    migration,
    new RegExp(`revoke all on function public\\.psi_project_tender_dossier_item\\(uuid\\) from ${role}`, 'i'),
    `082 must revoke EXECUTE on psi_project_tender_dossier_item(uuid) from ${role}`,
  );
}
assert.match(
  migration,
  /grant execute on function public\.psi_project_tender_dossier_item\(uuid\) to service_role/i,
  '082 must grant EXECUTE on psi_project_tender_dossier_item(uuid) only to service_role',
);

// --- 6) scope discipline: never redefines the eight-arg wrapper, no blind backfill -----------
// 041 stays the sole owner of the eight-argument GO wrapper; 082 (fase 3A) may only ADD a
// nine-argument overload alongside it, never redeclare the eight-argument signature itself.
assert.doesNotMatch(
  migration,
  /create or replace function public\.psi_record_tender_go_no_go\(\s*p_opportunity_id uuid, p_tender_id uuid, p_actor_id uuid, p_decision text,\s*p_analysis_run_id uuid, p_justification text, p_preparation jsonb, p_document_hash text\s*\)/,
  '082 must never redefine the eight-argument psi_record_tender_go_no_go wrapper owned by 041',
);
assert.doesNotMatch(migration, /update public\.psi_tender_dossier_items\s+set/i,
  '082 must never blind-backfill existing dossier items');
assert.doesNotMatch(migration, /md5\(/i, '082 must never use md5() for any identity/hash column');

// --- 7) fase 3A: nine-argument GO overload wires the sync atomically ------------------------
assert.match(
  migration,
  /create or replace function public\.psi_record_tender_go_no_go\(\s*p_opportunity_id uuid, p_tender_id uuid, p_actor_id uuid, p_decision text,\s*p_analysis_run_id uuid, p_justification text, p_preparation jsonb, p_document_hash text,\s*p_agt002_items jsonb\s*\)/,
  '082 must add a nine-argument psi_record_tender_go_no_go overload carrying p_agt002_items',
);
assert.match(
  migration,
  /function public\.psi_record_tender_go_no_go\([^;]*?p_agt002_items jsonb[\s\S]{0,200}?security definer[\s\S]{0,200}?set\s+search_path\s*=\s*public\s*,\s*pg_temp/i,
  'the nine-argument overload must be SECURITY DEFINER with search_path = public, pg_temp',
);
assert.match(migration, /v_result := public\.psi_record_tender_go_no_go\(\s*p_opportunity_id, p_tender_id, p_actor_id, p_decision,\s*p_analysis_run_id, p_justification, p_preparation, p_document_hash\)/,
  '082 must delegate to the eight-argument wrapper, never reimplement its behavior');
assert.match(migration, /if p_decision = 'go' and p_agt002_items is not null then/,
  '082 must sync only for GO decisions with an explicit non-null batch');
assert.match(migration, /\(v_result->>'decision_id'\)::uuid/,
  '082 must anchor the sync to the decision this same call just recorded, never a separate re-query');
assert.match(
  migration,
  /public\.psi_sync_agt002_post_go_checklist\(\s*p_opportunity_id, p_actor_id, v_decision_id, p_analysis_run_id, p_agt002_items\)/,
  '082 must call the sync RPC with opportunity, actor, the just-recorded decision id, the exact analysis run and the batch',
);
assert.match(migration, /'agt002_handoff'/, '082 must return a non-technical handoff field alongside the preserved prior result');
assert.match(
  migration,
  /revoke all on function public\.psi_record_tender_go_no_go\(uuid, uuid, uuid, text, uuid, text, jsonb, text, jsonb\) from (public|anon|authenticated)/,
  '082 must revoke default EXECUTE on the nine-argument overload',
);
assert.match(
  migration,
  /grant execute on function public\.psi_record_tender_go_no_go\(uuid, uuid, uuid, text, uuid, text, jsonb, text, jsonb\) to service_role/,
  '082 must grant EXECUTE on the nine-argument overload only to service_role',
);

// --- 8) the legacy eight-argument overload stops being callable by service_role ---------------
// It stays defined (041 owns it) and the nine-argument overload keeps calling it internally as a
// SECURITY DEFINER, but no client role may use it to record a GO that skips the handoff.
assert.match(
  migration,
  /revoke execute on function public\.psi_record_tender_go_no_go\(uuid, uuid, uuid, text, uuid, text, jsonb, text\) from service_role/,
  '082 must revoke EXECUTE on the legacy eight-argument overload from service_role',
);
assert.doesNotMatch(
  migration,
  /grant execute on function public\.psi_record_tender_go_no_go\(uuid, uuid, uuid, text, uuid, text, jsonb, text\) to/,
  '082 must never re-grant the legacy eight-argument overload',
);
{
  const grantNineArg = migration.indexOf(
    'grant execute on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text, jsonb) to service_role',
  );
  const revokeEightArg = migration.indexOf(
    'revoke execute on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text) from service_role',
  );
  assert.ok(grantNineArg > 0 && revokeEightArg > grantNineArg,
    '082 must revoke the eight-argument overload only AFTER the nine-argument one is granted');
}

console.log('Tender dossier AGT-002 handoff migration 082 static structural contract passed');
