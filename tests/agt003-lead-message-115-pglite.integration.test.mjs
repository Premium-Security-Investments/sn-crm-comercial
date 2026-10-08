// AGT-003 — migración 115: "Ya lo usé" / "Descartar" del mensaje sugerido; un evento por análisis, inmutable, privado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { STATE_SQL, statusOf } from '../scripts/agt003-lead-message-migration.mjs';
import { stripTopLevelTransactionWrapper } from '../scripts/agt002-initial-analysis-migrations.mjs';

const read = path => stripTopLevelTransactionWrapper(readFileSync(new URL(path, import.meta.url), 'utf8'));
const m114 = read('../supabase/migrations/114_agt003_lead_deep_analysis.sql');
const m115 = read('../supabase/migrations/115_agt003_lead_analysis_message_events.sql');
const r115 = read('../supabase/rollbacks/115_agt003_lead_analysis_message_events_rollback.sql');
const OPP = '00000000-0000-4000-8000-000000000001';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';

async function freshDb() {
  const pg = new PGlite();
  await pg.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.psi_sales_opportunities (id uuid primary key);
    create table public.psi_sales_profiles (id uuid primary key);
    insert into public.psi_sales_opportunities values ('${OPP}'); insert into public.psi_sales_profiles values ('${ACTOR}');
  `);
  await pg.exec(m114);
  await pg.exec(m115);
  const claim = (await pg.query(`select public.psi_claim_agt003_lead_analysis($1, $2, $3, '1.0', 5, now() - interval '1 day') as r`, [OPP, ACTOR, 'a'.repeat(64)])).rows[0].r;
  await pg.query(`select public.psi_finish_agt003_lead_analysis($1, 'completed', 'sonnet', null, 'leida', '{"ok":true}'::jsonb, null, null)`, [claim.id]);
  return { pg, analysisId: claim.id };
}

test('115: un evento por análisis, inmutable y sin acceso público', async () => {
  const { pg, analysisId } = await freshDb();
  assert.equal(statusOf((await pg.query(STATE_SQL)).rows[0]), 'applied');
  await pg.query(`insert into public.psi_agt003_lead_analysis_message_events (analysis_id, actor_id, action) values ($1, $2, 'used')`, [analysisId, ACTOR]);
  await assert.rejects(() => pg.query(`insert into public.psi_agt003_lead_analysis_message_events (analysis_id, actor_id, action) values ($1, $2, 'dismissed')`, [analysisId, ACTOR]), /duplicate key/);
  await assert.rejects(() => pg.query(`insert into public.psi_agt003_lead_analysis_message_events (analysis_id, actor_id, action) values (gen_random_uuid(), $1, 'otro')`, [ACTOR]), /check constraint|foreign key/);
  await assert.rejects(() => pg.query(`delete from public.psi_agt003_lead_analysis_message_events`), /solo inserción/);
  await assert.rejects(() => pg.query(`update public.psi_agt003_lead_analysis_message_events set action = 'dismissed'`), /solo inserción/);
  for (const role of ['anon', 'authenticated']) {
    await pg.exec(`set role ${role};`);
    await assert.rejects(() => pg.query(`select * from public.psi_agt003_lead_analysis_message_events`), /permission denied/);
    await pg.exec('reset role;');
  }
  await pg.exec(r115);
  assert.equal(statusOf((await pg.query(STATE_SQL)).rows[0]), 'absent');
  await pg.exec(m115); await pg.exec(m115);
  assert.equal(statusOf((await pg.query(STATE_SQL)).rows[0]), 'applied');
});
