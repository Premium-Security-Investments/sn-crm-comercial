// Issue #187 (caso REAL de Cali): la decisión GO vigente quedó registrada con `analysis_run_id`
// NULL, así que la igualdad exacta que 082 exige contra `p_analysis_run_id` era imposible de
// satisfacer y ese expediente no podía traspasarse nunca. 083 reemplaza la RPC
// `psi_sync_agt002_post_go_checklist` conservando íntegramente la lógica de 082 y abriendo un único
// caso legado ESTRICTO para la decisión sin anclaje.
//
// RED reason: `supabase/migrations/083_tender_dossier_agt002_unanchored_go.sql` no existía en esta
// rama, así que `readFileSync` fallaba con ENOENT antes de correr cualquier aserción.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../supabase/migrations/083_tender_dossier_agt002_unanchored_go.sql', import.meta.url), 'utf8',
);
const m082 = readFileSync(
  new URL('../supabase/migrations/082_tender_dossier_agt002_handoff.sql', import.meta.url), 'utf8',
);

const RPC = 'psi_sync_agt002_post_go_checklist';

// --- envelope -----------------------------------------------------------------------------------
assert.match(migration, /^begin;/im, '083 must be wrapped in a single transaction');
assert.match(migration, /commit;\s*$/i, '083 must commit at the end');
assert.doesNotMatch(migration, /drop\s+table|truncate/i, '083 must never drop or truncate anything');
assert.doesNotMatch(migration, /drop function/i, '083 must replace the RPC in place, never drop it');

// --- 082 stays untouched: 083 applies AFTER it and replaces the RPC -----------------------------
assert.match(
  m082,
  /if v_decision\.analysis_run_id is distinct from p_analysis_run_id then/,
  '082 must keep its original unconditional anchoring equality (083 must not edit 082)',
);
assert.doesNotMatch(m082, /v_unanchored_decision/, '083 must not be back-ported into 082');
assert.doesNotMatch(m082, /evidence_coverage/, '082 must stay free of the legacy unanchored rule');

// --- the RPC is replaced with the same signature, security posture and grants --------------------
assert.match(
  migration,
  new RegExp(`create or replace function public\\.${RPC}\\(\\s*p_opportunity_id uuid,\\s*p_actor_id uuid,\\s*p_decision_id uuid,\\s*p_analysis_run_id uuid,\\s*p_items jsonb\\s*\\)`, 'i'),
  `083 must CREATE OR REPLACE public.${RPC} with the exact same five-argument signature`,
);
assert.match(
  migration,
  new RegExp(`function public\\.${RPC}\\([^;]*?security definer[\\s\\S]{0,400}?set\\s+search_path\\s*=\\s*public\\s*,\\s*pg_temp`, 'i'),
  `083 ${RPC} must stay SECURITY DEFINER with search_path = public, pg_temp`,
);
for (const role of ['public', 'anon', 'authenticated']) {
  assert.match(
    migration,
    new RegExp(`revoke all on function public\\.${RPC}\\(uuid, uuid, uuid, uuid, jsonb\\) from ${role}`, 'i'),
    `083 must re-declare the revoke of EXECUTE on ${RPC} from ${role}`,
  );
}
assert.match(
  migration,
  new RegExp(`grant execute on function public\\.${RPC}\\(uuid, uuid, uuid, uuid, jsonb\\) to service_role`, 'i'),
  `083 must keep EXECUTE on ${RPC} granted only to service_role`,
);

// --- scope discipline: 083 touches ONLY the sync RPC ---------------------------------------------
for (const [label, pattern] of [
  ['the provenance table', /create table[\s\S]{0,40}psi_tender_dossier_agt002_sources/i],
  ['the GO wrapper overloads', /create or replace function public\.psi_record_tender_go_no_go/i],
  ['the item projection', /create or replace function public\.psi_project_tender_dossier_item/i],
  ['the manual item creation RPC', /create or replace function public\.psi_create_tender_dossier_item/i],
  ['the origin check constraint', /psi_tender_dossier_items_origin_check/i],
]) {
  assert.doesNotMatch(migration, pattern, `083 must not redeclare ${label}: 082 stays its owner`);
}

// --- TOCTOU: the whole resolution still happens under the opportunity row lock -------------------
assert.match(
  migration,
  /perform 1 from public\.psi_sales_opportunities where id = p_opportunity_id for update;[\s\S]{0,600}?psi_assert_tender_dossier_go\(p_opportunity_id\)/,
  '083 must keep taking the opportunity row lock BEFORE resolving the current GO / chain / run',
);
assert.match(migration, /psi_assert_tender_dossier_actor\(p_actor_id, false\)/, '083 must keep the 040 actor helper');
assert.match(migration, /psi_assert_tender_dossier_go\(p_opportunity_id\)/, '083 must keep the 040 current-GO helper');
assert.match(
  migration,
  /not exists \(select 1 from public\.psi_tender_go_no_go_decisions c where c\.supersedes_decision_id = d\.id\)/,
  '083 must keep resolving the current decision through the supersession chain',
);
assert.match(
  migration,
  /v_decision\.id is distinct from p_decision_id or v_decision\.decision is distinct from 'go'/,
  '083 must keep demanding that the submitted decision be exactly the current GO one',
);

// --- anchored decision: the exact equality of 082 is preserved verbatim --------------------------
assert.match(
  migration,
  /if v_decision\.analysis_run_id is not null then\s*\n\s*if v_decision\.analysis_run_id is distinct from p_analysis_run_id then\s*\n\s*raise exception 'El análisis indicado no es el análisis anclado a la decisión GO vigente\.'/,
  '083 must keep exact-equality anchoring whenever the decision carries a non-null analysis_run_id',
);

// --- unanchored decision: the single strict legacy case ------------------------------------------
assert.match(migration, /v_unanchored_decision boolean := false;/, '083 must declare the unanchored flag defaulting to false');
assert.match(
  migration,
  /else\s*\n\s*v_unanchored_decision := true;/,
  '083 must mark the unanchored case only on the NULL branch of the decision anchor',
);
// Same opportunity/tender + completed + canonical, unchanged from 082.
assert.match(
  migration,
  /where id = p_analysis_run_id and opportunity_id = p_opportunity_id and tender_id = v_tender_id;\s*\n\s*if not found or v_run\.status is distinct from 'completed' or v_run\.canonical is not true then/,
  '083 must keep requiring the run to belong to the same opportunity/tender and be completed + canonical',
);
// Current snapshot, no refresh in progress, unchanged from 082.
assert.match(
  migration,
  /if not found or v_state\.refresh_in_progress or v_state\.current_snapshot_id is distinct from v_run\.snapshot_id then/,
  '083 must keep requiring the run snapshot to be the current one with no refresh in progress',
);
assert.match(
  migration,
  /if jsonb_typeof\(v_run\.result -> 'integral_analysis' -> 'analysis_units'\) is distinct from 'array' then/,
  '083 must keep requiring a structured integral V3 envelope',
);
assert.match(
  migration,
  /if v_unanchored_decision then[\s\S]{0,900}?v_run\.producer is distinct from 'AGT-002' or v_run\.method is distinct from 'agent_ai'/,
  '083 must require producer AGT-002 / method agent_ai for the unanchored legacy case',
);
assert.match(
  migration,
  /if coalesce\(v_run\.result \? 'evidence_coverage', true\) then\s*\n\s*raise exception/,
  "083 must reject the unanchored case whenever `result` owns an evidence_coverage property (even JSON null)",
);
// The extra legacy conditions must be additional, never a relaxation: they run after the shared
// vigency checks, so an unanchored decision is never more permissive than an anchored one.
{
  const snapshotGate = migration.indexOf("ya no es el análisis vigente del conjunto documental");
  const v3Gate = migration.indexOf("no tiene un análisis integral V3 estructurado");
  const legacyGate = migration.indexOf('if v_unanchored_decision then');
  assert.ok(snapshotGate > 0 && v3Gate > snapshotGate && legacyGate > v3Gate,
    '083 must apply the unanchored legacy conditions only after every shared vigency check');
}

// --- the decision row is never mutated ------------------------------------------------------------
assert.doesNotMatch(migration, /update public\.psi_tender_go_no_go_decisions/i,
  '083 must never update the GO decision row (no backfill of analysis_run_id)');
assert.doesNotMatch(migration, /insert into public\.psi_tender_go_no_go_decisions/i,
  '083 must never re-insert the GO decision row');
assert.doesNotMatch(migration, /update public\.psi_tender_dossier_items\s+set/i,
  '083 must never blind-backfill existing dossier items');

// --- provenance stays append-only and anchored to decision_id + run_id ---------------------------
assert.match(
  migration,
  /insert into public\.psi_tender_dossier_agt002_sources \([\s\S]{0,300}?decision_id, analysis_run_id,[\s\S]{0,400}?p_decision_id, p_analysis_run_id,/,
  '083 must keep anchoring each provenance row to decision_id + analysis_run_id',
);
assert.match(migration, /on conflict \(dossier_item_id, analysis_run_id, source_id\) do nothing/i,
  '083 must keep provenance identity on (dossier_item_id, analysis_run_id, source_id)');

// --- 082 batch logic preserved integrally ---------------------------------------------------------
for (const [label, pattern] of [
  ['closed p_items keys', /'instruction','item_key','required','requirement_id','source_hash','source_id','source_kind','status','title'/],
  ['item_key shape', /v_key is distinct from \('agt002_post_go:' \|\| v_requirement_id\)/],
  ['source_hash format', /\(v_item->>'source_hash'\) !~ '\^\[0-9a-f\]\{64\}\$'/],
  ['eligible-unit revalidation', /u->>'unit_kind' = 'tender_requirement'/],
  ['evidence_satisfied exclusion', /\(u->'closure'->>'status'\) is distinct from 'evidence_satisfied'/],
  ['server-derived source_payload', /jsonb_build_object\('source_kind', 'integral_unit'\) \|\| u into v_source_payload/],
  ['payload-driven requirement_changed', /v_previous_payload is not null and v_previous_payload is distinct from v_source_payload/],
  ['locked revalidation of a pre-existing row', /where opportunity_id = p_opportunity_id and item_key = v_key for update;/],
  ['no adoption of foreign rows', /no adopta ítems ajenos/],
  ['all-or-nothing two passes', /Pasada 1[\s\S]*Pasada 2/],
]) {
  assert.match(migration, pattern, `083 must preserve the 082 batch logic (${label})`);
}
assert.doesNotMatch(migration, /v_previous_hash/, '083 must not reintroduce any hash-comparison branch');
assert.doesNotMatch(migration, /md5\(/i, '083 must never use md5() for any identity/hash column');

console.log('Tender dossier AGT-002 unanchored GO migration 083 static structural contract passed');
