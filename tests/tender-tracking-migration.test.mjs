import { existsSync, readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const migrationPath = new URL('../supabase/migrations/018_tender_tracking_rpc.sql', import.meta.url);
assert.equal(existsSync(migrationPath), true, 'La migración 018 preparada debe crear los RPC transaccionales.');

const sql = readFileSync(migrationPath, 'utf8').toLowerCase().replace(/\s+/g, ' ');
for (const functionName of ['psi_update_tender_tracking', 'psi_transition_tender_tracking']) {
  assert.match(sql, new RegExp(`create or replace function public\\.${functionName}\\(`));
  assert.match(sql, new RegExp(`revoke all on function public\\.${functionName}[^;]+ from public`));
  assert.match(sql, new RegExp(`revoke all on function public\\.${functionName}[^;]+ from authenticated`));
  assert.match(sql, new RegExp(`grant execute on function public\\.${functionName}[^;]+ to service_role`));
}

assert.match(sql, /select \* into v_tender from public\.psi_public_tenders where id = p_tender_id for update/);
assert.match(sql, /from public\.psi_sales_profiles p where p\.id = p_actor_id and p\.active = true/);
assert.match(sql, /p\.role in \('admin', 'director', 'gerencia'\)/);
assert.match(sql, /lower\(p\.microsoft_email\) = 'directora\.licitaciones@seguridadnacional\.co'/);
assert.match(sql, /p_expected_tracking_updated_at is distinct from v_tender\.tracking_updated_at/);
assert.match(sql, /coalesce\(v_tender\.internal_status, 'nueva'\) = 'nueva'/);
assert.match(sql, /v_tender\.internal_status <> 'en_revision'/);
assert.match(sql, /if p_tracking_status is null or p_tracking_status not in \('pendiente_revision', 'analizando', 'esperando_informacion', 'listo_para_decision', 'bloqueado'\) then/);
assert.match(sql, /if p_internal_status is null or p_internal_status not in \('nueva', 'descartada', 'convertida_oportunidad'\) then/);
assert.match(sql, /p_internal_status not in \('nueva', 'descartada', 'convertida_oportunidad'\)/);
assert.match(sql, /from public\.psi_sales_profiles where id = p_tracking_owner_id and active = true/);
assert.match(sql, /from public\.psi_sales_opportunities where id = p_converted_opportunity_id/);
assert.match(sql, /v_event_type := 'entered_tracking'/);
assert.match(sql, /v_event_type := 'assigned'/);
assert.match(sql, /v_event_type := 'blocked'/);
assert.match(sql, /v_event_type := 'unblocked'/);
assert.match(sql, /v_event_type := 'tracking_updated'/);
assert.match(sql, /v_event_type := case p_internal_status when 'nueva' then 'returned_to_radar' when 'descartada' then 'discarded' when 'convertida_oportunidad' then 'converted' end/);

for (const functionName of ['psi_update_tender_tracking', 'psi_transition_tender_tracking']) {
  const body = sql.slice(sql.indexOf(`create or replace function public.${functionName}`), sql.indexOf(`grant execute on function public.${functionName}`));
  assert.match(body, /update public\.psi_public_tenders/);
  assert.match(body, /insert into public\.psi_tender_tracking_events/);
  assert.match(body, /return to_jsonb\(v_updated\)/);
}

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

console.log('tender tracking migration RPC contract passed');
