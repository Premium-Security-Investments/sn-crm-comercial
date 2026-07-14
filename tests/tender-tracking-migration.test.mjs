import { existsSync, readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const migrationPath = new URL('../supabase/migrations/017_tender_tracking_workflow.sql', import.meta.url);
assert.equal(
  existsSync(migrationPath),
  true,
  'La migración debe usar la siguiente versión disponible (017); 014 ya pertenece a SIIO.'
);

const sql = readFileSync(migrationPath, 'utf8').toLowerCase().replace(/\s+/g, ' ');

for (const [column, definition] of [
  ['tracking_owner_id', 'uuid references public.psi_sales_profiles(id)'],
  ['tracking_status', 'text'],
  ['tracking_next_action', 'text'],
  ['tracking_due_at', 'timestamptz'],
  ['tracking_blocker', 'text'],
  ['tracking_last_note', 'text'],
  ['tracking_started_at', 'timestamptz'],
  ['tracking_updated_at', 'timestamptz'],
]) {
  assert.ok(
    sql.includes(`add column if not exists ${column} ${definition}`),
    `Debe agregar idempotentemente ${column}`
  );
}

assert.match(sql, /create table if not exists public\.psi_tender_tracking_events/);
for (const definition of [
  'id uuid primary key default gen_random_uuid()',
  'tender_id uuid not null references public.psi_public_tenders(id) on delete cascade',
  "event_type text not null check (event_type in ('entered_tracking','tracking_updated','assigned','blocked','unblocked','returned_to_radar','converted','discarded'))",
  'assigned_to uuid references public.psi_sales_profiles(id)',
  'created_by uuid references public.psi_sales_profiles(id)',
  'created_at timestamptz not null default now()',
]) {
  assert.match(sql, new RegExp(definition.replace(/[()]/g, '\\$&')));
}

assert.match(sql, /alter table public\.psi_tender_tracking_events enable row level security/);
assert.match(sql, /create index if not exists idx_tender_tracking_events_tender_created on public\.psi_tender_tracking_events\(tender_id, created_at desc\)/);
assert.match(sql, /create index if not exists idx_public_tenders_tracking_queue on public\.psi_public_tenders\(internal_status, tracking_due_at, tracking_updated_at desc\)/);

for (const policy of ['psi_tender_tracking_events_select', 'psi_tender_tracking_events_modify']) {
  assert.match(sql, new RegExp(`drop policy if exists ${policy} on public\\.psi_tender_tracking_events`));
  assert.match(sql, new RegExp(`create policy ${policy} on public\\.psi_tender_tracking_events`));
}
assert.match(sql, /for select to authenticated using \( exists \( select 1 from public\.psi_sales_profiles p/);
assert.match(sql, /for all to authenticated using \( exists \( select 1 from public\.psi_sales_profiles p/);
assert.match(sql, /with check \( exists \( select 1 from public\.psi_sales_profiles p/);
assert.match(sql, /lower\(p\.microsoft_email\) = lower\(auth\.jwt\(\) ->> 'email'\)/);
assert.match(sql, /p\.active = true/);
assert.match(sql, /p\.role in \('admin','director','gerencia'\)/);
assert.match(sql, /lower\(p\.microsoft_email\) = 'directora\.licitaciones@seguridadnacional\.co'/);
assert.match(sql, /grant select, insert, update, delete on public\.psi_tender_tracking_events to authenticated/);

console.log('tender tracking migration contract passed');
