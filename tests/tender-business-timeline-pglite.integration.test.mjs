import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/039_tender_business_timeline.sql', import.meta.url), 'utf8');
const db = new PGlite();
const actor = '11111111-1111-4111-8111-111111111111';
const opportunity = '22222222-2222-4222-8222-222222222222';
const tender = '33333333-3333-4333-8333-333333333333';
const preparation = '44444444-4444-4444-8444-444444444444';

await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.psi_tender_tracking_events (
    id uuid primary key default gen_random_uuid(), tender_id uuid not null, event_type text not null,
    actor_kind text not null, created_by uuid, source_ref_type text, source_ref_id uuid,
    metadata jsonb, note text, unique(event_type, source_ref_type, source_ref_id)
  );
  create function public.psi_append_tender_tracking_event(uuid,text,text,uuid,text,uuid,jsonb,text,boolean)
  returns jsonb language plpgsql security definer as $$
  declare v_id uuid;
  begin
    insert into public.psi_tender_tracking_events(tender_id,event_type,actor_kind,created_by,source_ref_type,source_ref_id,metadata,note)
    values ($1,$2,$3,$4,$5,$6,$7,$8)
    on conflict(event_type,source_ref_type,source_ref_id) do nothing returning id into v_id;
    return jsonb_build_object('id',v_id);
  end $$;
  create function public.psi_record_tender_go_no_go(uuid,uuid,uuid,text,uuid,text,jsonb,text)
  returns jsonb language plpgsql security definer as $$
  begin
    return jsonb_build_object(
      'decision_id', gen_random_uuid(), 'decision', $4,
      'preparation_id', case when $4='go' then '${preparation}'::uuid else null end,
      'preparation_created', $4='go',
      'tender_offer_status', case when $4='go' then 'en_preparacion' else 'cerrada_no_go' end
    );
  end $$;
  grant execute on function public.psi_record_tender_go_no_go(uuid,uuid,uuid,text,uuid,text,jsonb,text) to service_role;
`);

await db.exec(migration);
await db.exec(migration);
await db.exec('set role service_role');
await assert.rejects(
  () => db.query(`select public.psi_record_tender_go_no_go_core_039($1,$2,$3,'go',null,'x','{}'::jsonb,repeat('a',64))`, [opportunity, tender, actor]),
  /permission denied/i,
  'service_role no debe poder omitir el wrapper auditable',
);
const go = (await db.query(`select public.psi_record_tender_go_no_go($1,$2,$3,'go',null,'Aprobado','{}'::jsonb,repeat('a',64)) as result`, [opportunity, tender, actor])).rows[0].result;
assert.equal(go.tender_offer_status, 'en_preparacion');
const noGo = (await db.query(`select public.psi_record_tender_go_no_go($1,$2,$3,'no_go',null,'Descartado',null,repeat('a',64)) as result`, [opportunity, tender, actor])).rows[0].result;
assert.equal(noGo.tender_offer_status, 'cerrada_no_go');
await db.exec('reset role');

const events = (await db.query('select event_type, actor_kind, created_by, source_ref_type, note from public.psi_tender_tracking_events order by event_type')).rows;
assert.deepEqual(events.map(row => row.event_type), ['go_decided', 'no_go_decided', 'offer_preparation_started']);
assert.ok(events.every(row => row.actor_kind === 'human' && row.created_by === actor));
assert.equal(events.find(row => row.event_type === 'offer_preparation_started').source_ref_type, 'tender_offer_preparation');
assert.equal(events.find(row => row.event_type === 'go_decided').note, 'Aprobado');

await db.close();
console.log('PGlite tender business timeline migration passed');
