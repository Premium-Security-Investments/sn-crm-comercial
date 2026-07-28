import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
const sql = readFileSync(new URL('../supabase/migrations/040_tender_dossier_workspace.sql', import.meta.url), 'utf8');

assert.match(sql, /^begin;/m);
assert.match(sql, /commit;\s*$/);
for (const t of ['psi_tender_dossier_items','psi_tender_dossier_item_actions','psi_tender_dossier_artifacts',
  'psi_tender_dossier_artifact_versions','psi_tender_dossier_artifact_reviews']) {
  assert.match(sql, new RegExp(`create table if not exists public.${t}`), `falta tabla ${t}`);
  assert.match(sql, new RegExp(`grant select on table public.${t} to service_role`), `falta grant ${t}`);
  assert.match(sql, new RegExp(`revoke all on table public.${t} from service_role`), `falta revoke ${t}`);
}
assert.match(sql, /is append-only: UPDATE and DELETE are prohibited/);
assert.match(sql, /security definer\s+set search_path = public, pg_temp/);
// Ninguna RPC concede execute a authenticated/anon/public.
assert.doesNotMatch(sql, /grant execute on function[^\n]*to (public|anon|authenticated)/);
// Nuevos tipos de evento comercial presentes.
for (const e of ['dossier_seeded','dossier_artifact_approved','offer_ready_for_submission']) {
  assert.match(sql, new RegExp(`'${e}'`), `falta event_type ${e}`);
}
const sql041 = readFileSync(new URL('../supabase/migrations/041_tender_dossier_go_seed.sql', import.meta.url), 'utf8');
assert.match(sql041, /rename to psi_record_tender_go_no_go_core_041/);
assert.match(sql041, /perform public\.psi_seed_tender_dossier\(p_opportunity_id, p_actor_id\)/);
assert.match(sql041, /on conflict \(opportunity_id, item_key\) do nothing/);
const sql042 = readFileSync(new URL('../supabase/migrations/042_tender_dossier_offer_gate.sql', import.meta.url), 'utf8');
assert.match(sql042, /rename to psi_transition_tender_offer_status_core_042/);
assert.match(sql042, /if p_to_status = 'lista_para_presentar' then/);
assert.match(sql042, /grant execute on function public\.psi_transition_tender_offer_status\(uuid, uuid, text, text, text\) to service_role/);

console.log('tender dossier workspace migration static checks passed');
