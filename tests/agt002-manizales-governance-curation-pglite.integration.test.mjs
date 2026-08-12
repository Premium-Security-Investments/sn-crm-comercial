import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration064 = readFileSync(new URL('../supabase/migrations/064_agt002_integral_governance_overrides.sql', import.meta.url), 'utf8');
const migration066 = readFileSync(new URL('../supabase/migrations/066_agt002_manizales_integral_governance.sql', import.meta.url), 'utf8');
const rollback066 = readFileSync(new URL('../supabase/rollbacks/066_agt002_manizales_integral_governance_rollback.sql', import.meta.url), 'utf8');
const O = '54190e51-15fb-46af-b0aa-8f13461a3110';
const P = '60b26173-1226-476b-a958-cf2917661432';

function stripTxn(sql) {
  return sql.replace(/^\s*begin\s*;/i, '').replace(/commit\s*;\s*$/i, '').trim();
}

async function fixture() {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated; create role service_role; create role anon;
    grant service_role to current_user;
    create function public.psi_sales_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true);
    create table public.psi_sales_opportunities (id uuid primary key);
    insert into public.psi_sales_profiles values ('${P}', true);
    insert into public.psi_sales_opportunities values ('${O}');
  `);
  await pg.exec(stripTxn(migration064));
  return pg;
}

{
  const pg = await fixture();
  await pg.exec(stripTxn(migration066));
  let { rows } = await pg.query(`
    select requirement_id, override_kind, category_value, evidence_class_id, curated_by::text, version, current
    from public.psi_agt002_integral_governance_overrides
    where opportunity_id='${O}' order by requirement_id, override_kind
  `);
  assert.equal(rows.length, 6);
  assert.ok(rows.every(row => row.curated_by === P && row.version === 3 && row.current === true));
  assert.deepEqual(rows.map(row => `${row.requirement_id}:${row.override_kind}`), [
    'financial-working-capital:category_override',
    'financial-working-capital:evidence_class_link',
    'legal-collective-life-policy:category_override',
    'legal-collective-life-policy:evidence_class_link',
    'legal-rce-policy:category_override',
    'legal-rce-policy:evidence_class_link',
  ]);

  await pg.exec(stripTxn(migration066));
  ({ rows } = await pg.query(`select count(*)::int n from public.psi_agt002_integral_governance_overrides where opportunity_id='${O}'`));
  assert.equal(rows[0].n, 6, 'apply/apply must be an exact no-op');

  await pg.exec(stripTxn(rollback066));
  ({ rows } = await pg.query(`select count(*)::int n from public.psi_agt002_integral_governance_overrides where opportunity_id='${O}'`));
  assert.equal(rows[0].n, 0, 'rollback removes exactly the six release rows');
  await pg.exec(stripTxn(rollback066));
  await pg.close();
}

{
  const pg = await fixture();
  await pg.exec(`
    insert into public.psi_agt002_integral_governance_overrides
      (opportunity_id, requirement_id, override_kind, category_value, rationale, source_reference, curated_by)
    values ('${O}', 'unexpected', 'category_override', 'technical', 'drift', 'manual', '${P}')
  `);
  await assert.rejects(pg.exec(stripTxn(migration066)), /AGT002_MANIZALES_GOVERNANCE_DRIFT/);
  const { rows } = await pg.query(`select count(*)::int n from public.psi_agt002_integral_governance_overrides where opportunity_id='${O}'`);
  assert.equal(rows[0].n, 1, 'failed release must not partially insert approved rows');
  await pg.close();
}

console.log('AGT-002 migration 066 (Manizales governed curation) PGlite integration passed');
