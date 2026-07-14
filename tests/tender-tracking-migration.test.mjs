import { existsSync, readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const migrationPath = new URL('../supabase/migrations/018_tender_tracking_rpc.sql', import.meta.url);
assert.equal(existsSync(migrationPath), true, 'La migración 018 preparada debe crear los RPC transaccionales.');

const sql = readFileSync(migrationPath, 'utf8').toLowerCase().replace(/\s+/g, ' ');
const rpcFunctionNames = ['psi_update_tender_tracking', 'psi_transition_tender_tracking', 'psi_discard_tender_opportunity', 'psi_convert_tender_to_opportunity'];
for (const functionName of rpcFunctionNames) {
  assert.match(sql, new RegExp(`create or replace function public\\.${functionName}\\(`));
  assert.match(sql, new RegExp(`revoke all on function public\\.${functionName}[^;]+ from public`));
  assert.match(sql, new RegExp(`revoke all on function public\\.${functionName}[^;]+ from authenticated`));
  assert.match(sql, new RegExp(`grant execute on function public\\.${functionName}[^;]+ to service_role`));
}

for (const functionName of rpcFunctionNames) {
  const definitions = [...sql.matchAll(new RegExp(`create or replace function public\\.${functionName}\\(`, 'g'))];
  assert.equal(definitions.length, 1, `${functionName} must have exactly one auditable create-or-replace definition.`);

  const bodyEnd = sql.indexOf('$$;', definitions[0].index) + '$$;'.length;
  const revokePublicIndex = sql.indexOf(`revoke all on function public.${functionName}`, bodyEnd);
  const revokeAuthenticatedIndex = sql.indexOf(`revoke all on function public.${functionName}`, revokePublicIndex + 1);
  const grantIndex = sql.indexOf(`grant execute on function public.${functionName}`, bodyEnd);
  assert.ok(revokePublicIndex > bodyEnd, `${functionName} must revoke public access after its body.`);
  assert.ok(revokeAuthenticatedIndex > revokePublicIndex, `${functionName} must revoke authenticated access after its public revoke.`);
  assert.ok(grantIndex > revokeAuthenticatedIndex, `${functionName} must grant service_role access after revokes.`);
}

assert.match(sql, /select \* into v_tender from public\.psi_public_tenders where id = p_tender_id for update/);
assert.match(sql, /from public\.psi_sales_profiles p where p\.id = p_actor_id and p\.active = true/);
assert.match(sql, /p\.role in \('admin', 'director', 'gerencia'\)/);
assert.match(sql, /lower\(p\.microsoft_email\) = 'directora\.licitaciones@seguridadnacional\.co'/);
assert.match(sql, /p_expected_tracking_updated_at is distinct from v_tender\.tracking_updated_at/);
assert.match(sql, /if p_tracking_status is null or p_tracking_status not in \('pendiente_revision', 'analizando', 'esperando_informacion', 'listo_para_decision', 'bloqueado'\) then/);
assert.match(sql, /if p_internal_status is null or p_internal_status not in \('nueva', 'descartada'\) then/);
assert.match(sql, /from public\.psi_sales_profiles where id = p_tracking_owner_id and active = true/);

assert.match(sql, /v_event_type := 'entered_tracking'/);
assert.match(sql, /v_event_type := 'assigned'/);
assert.match(sql, /v_event_type := 'blocked'/);
assert.match(sql, /v_event_type := 'unblocked'/);
assert.match(sql, /v_event_type := 'tracking_updated'/);

assert.match(sql, /p_expected_tracking_updated_at is null/);
assert.match(sql, /v_tender\.internal_status = 'convertida_oportunidad'/);
assert.match(sql, /p_internal_status is distinct from 'descartada'/);
assert.match(sql, /v_tender\.internal_status = 'en_revision' and p_internal_status in \('nueva', 'descartada'\)/);

for (const functionName of ['psi_update_tender_tracking', 'psi_transition_tender_tracking']) {
  const body = sql.slice(sql.indexOf(`create or replace function public.${functionName}`), sql.indexOf(`grant execute on function public.${functionName}`));
  assert.match(body, /update public\.psi_public_tenders/);
  assert.match(body, /insert into public\.psi_tender_tracking_events/);
  assert.match(body, /return to_jsonb\(v_updated\)/);
  assert.match(body, /v_tender\.internal_status = 'nueva'/, `${functionName} must accept only an explicit nueva source state.`);
  assert.doesNotMatch(body, /coalesce\(v_tender\.internal_status, 'nueva'\)/, `${functionName} must not treat a persisted NULL lifecycle as nueva.`);
}

const updateBody = sql.slice(sql.indexOf('create or replace function public.psi_update_tender_tracking'), sql.indexOf('grant execute on function public.psi_update_tender_tracking'));
assert.match(updateBody, /v_tender\.internal_status is distinct from 'en_revision'/, 'update RPC must use a NULL-safe invalid-origin guard.');

const transitionBody = sql.slice(sql.indexOf('create or replace function public.psi_transition_tender_tracking'), sql.indexOf('grant execute on function public.psi_transition_tender_tracking'));
assert.match(transitionBody, /v_tender\.internal_status is distinct from 'en_revision' and v_tender\.internal_status is distinct from 'convertida_oportunidad'/, 'transition RPC must route NULL lifecycle states to its invalid-origin guard.');
assert.doesNotMatch(transitionBody, /p_internal_status = 'convertida_oportunidad'/, 'generic transition must not branch to converted.');
assert.doesNotMatch(transitionBody, /p_internal_status in \('nueva', 'descartada', 'convertida_oportunidad'\)/, 'generic transition must not allow converted as a target.');
assert.doesNotMatch(transitionBody, /when 'convertida_oportunidad' then 'converted'/, 'generic transition must not emit converted events.');
assert.doesNotMatch(transitionBody, /converted_opportunity_id = case/, 'generic transition must not assign converted opportunity links.');

const conversionBody = sql.slice(sql.indexOf('create or replace function public.psi_convert_tender_to_opportunity'), sql.indexOf('grant execute on function public.psi_convert_tender_to_opportunity'));
assert.match(conversionBody, /set internal_status = 'convertida_oportunidad', converted_opportunity_id = v_opportunity\.id/);
assert.match(conversionBody, /p_tender_id, 'converted', 'convertida a oportunidad desde radar\.'/);

for (const [table, policies] of [
  ['psi_public_tenders', ['psi_public_tenders_modify']],
  ['psi_tender_tracking_events', ['psi_tender_tracking_events_insert']],
]) {
  for (const policy of policies) {
    assert.match(sql, new RegExp(`drop policy if exists ${policy} on public\\.${table}`));
    assert.doesNotMatch(sql, new RegExp(`create policy ${policy} on public\\.${table}`));
  }
  assert.match(sql, new RegExp(`revoke insert, update, delete on public\\.${table} from authenticated`));
  assert.doesNotMatch(sql, new RegExp(`create policy [^;]* on public\\.${table} for (all|insert|update|delete) to authenticated`));
  assert.doesNotMatch(sql, new RegExp(`grant [^;]*(insert|update|delete)[^;]* on public\\.${table} to authenticated`));
}

assert.match(sql, /grant select on public\.psi_public_tenders to authenticated/);
assert.match(sql, /grant select on public\.psi_tender_tracking_events to authenticated/);

const discardBody = sql.slice(sql.indexOf('create or replace function public.psi_discard_tender_opportunity'), sql.indexOf('grant execute on function public.psi_discard_tender_opportunity'));
assert.match(discardBody, /security definer/);
assert.match(discardBody, /set search_path = public, pg_temp/);
assert.match(discardBody, /from public\.psi_sales_opportunities where id = p_opportunity_id for update/);
assert.match(discardBody, /from public\.psi_public_tenders where converted_opportunity_id = p_opportunity_id for update/);
assert.match(discardBody, /v_tender\.internal_status is distinct from 'convertida_oportunidad'/);
assert.match(discardBody, /p_expected_tracking_updated_at is distinct from v_tender\.tracking_updated_at/);
assert.match(discardBody, /update public\.psi_sales_opportunities/);
assert.match(discardBody, /insert into public\.psi_sales_interactions/);
assert.match(discardBody, /update public\.psi_public_tenders/);
assert.match(discardBody, /insert into public\.psi_tender_tracking_events/);
assert.match(discardBody, /linked_tender_status/);

assert.match(sql, /create unique index if not exists psi_public_tenders_converted_opportunity_id_unique on public\.psi_public_tenders \(converted_opportunity_id\) where converted_opportunity_id is not null/);
assert.match(sql, /create unique index if not exists psi_sales_opportunities_secop_radar_external_source_unique on public\.psi_sales_opportunities \(external_source\) where external_source like 'secop_radar:%'/);
assert.match(sql, /existen varias licitaciones vinculadas a la misma oportunidad/);
assert.match(sql, /on conflict \(external_source\) where external_source like 'secop_radar:%' do nothing/);
assert.match(sql, /linked_tender_status', 'already_discarded'/);
assert.match(sql, /linked_tender_status', case when v_opportunity\.stage_code = 'descartado' then 'reconciled' else 'discarded' end/);

console.log('tender tracking migration RPC contract passed');
