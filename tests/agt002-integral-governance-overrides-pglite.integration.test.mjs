import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration064 = readFileSync(new URL('../supabase/migrations/064_agt002_integral_governance_overrides.sql', import.meta.url), 'utf8');
const rollback064 = readFileSync(new URL('../supabase/rollbacks/064_agt002_integral_governance_overrides_rollback.sql', import.meta.url), 'utf8');

const ALL_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
const TABLE = 'public.psi_agt002_integral_governance_overrides';
const O = '11111111-1111-4111-8111-111111111111';
const P = '44444444-4444-4444-8444-444444444444';

function stripTxn(sql) {
  return sql.replace(/^\s*begin\s*;/i, '').replace(/commit\s*;\s*$/i, '').trim();
}

async function baseDatabase() {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated; create role service_role; create role anon;
    grant service_role to current_user;
    alter default privileges in schema public grant all on tables to anon;
    create function public.psi_sales_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true);
    create table public.psi_sales_opportunities (id uuid primary key);
    insert into public.psi_sales_profiles values ('${P}', true);
    insert into public.psi_sales_opportunities values ('${O}');
  `);
  return pg;
}

async function tableExists(pg) {
  const { rows } = await pg.query(`select to_regclass('${TABLE}') is not null ok`);
  return rows[0].ok === true;
}

async function rlsEnabled(pg) {
  const { rows } = await pg.query(`
    select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'psi_agt002_integral_governance_overrides'
  `);
  return rows[0]?.relrowsecurity === true;
}

async function hasPriv(pg, role, priv) {
  const { rows } = await pg.query(`select has_table_privilege('${role}', '${TABLE}', '${priv}') ok`);
  return rows[0].ok === true;
}

async function assertExactServiceRoleSelectOnly(pg, label) {
  assert.equal(await rlsEnabled(pg), true, `${label}: RLS must remain enabled`);
  for (const priv of ALL_PRIVS) {
    const expected = priv === 'SELECT';
    assert.equal(await hasPriv(pg, 'service_role', priv), expected, `${label}: service_role ${priv} expected ${expected}`);
  }
  for (const role of ['public', 'anon', 'authenticated']) {
    for (const priv of ALL_PRIVS) {
      assert.equal(await hasPriv(pg, role, priv), false, `${label}: ${role} must not have ${priv}`);
    }
  }
}

function insertSql({
  requirementId = 'req-1', kind = 'category_override', categoryValue = 'habilitating', evidenceClassId = null,
  rationale = 'Rationale real y trazable.', sourceReference = 'pliego:seccion-1', curatedBy = P, opportunityId = O,
} = {}) {
  return `
    insert into ${TABLE} (opportunity_id, requirement_id, override_kind, category_value, evidence_class_id, rationale, source_reference, curated_by)
    values ('${opportunityId}', '${requirementId}', '${kind}', ${categoryValue ? `'${categoryValue}'` : 'null'}, ${evidenceClassId ? `'${evidenceClassId}'` : 'null'}, '${rationale}', '${sourceReference}', '${curatedBy}')
  `;
}

// Core lifecycle: apply -> apply/apply idempotent -> rollback -> rollback/rollback idempotent.
{
  const pg = await baseDatabase();
  assert.equal(await tableExists(pg), false, 'pre-064 fixture must not have the table yet');

  await pg.exec(stripTxn(migration064));
  assert.equal(await tableExists(pg), true, 'table must exist after apply');
  await assertExactServiceRoleSelectOnly(pg, 'after apply 064');

  await pg.exec(stripTxn(migration064));
  assert.equal(await tableExists(pg), true, 'apply/apply must not error');
  await assertExactServiceRoleSelectOnly(pg, 'after apply/apply 064');

  await pg.exec(stripTxn(rollback064));
  assert.equal(await tableExists(pg), false, 'table must be gone after rollback');

  await pg.exec(stripTxn(rollback064));
  assert.equal(await tableExists(pg), false, 'rollback/rollback must not error and must leave the same absent state');
}

// Client roles must never write or read directly; only service_role may SELECT, and even
// service_role gets no INSERT/UPDATE/DELETE — curation happens outside runtime queries.
{
  const pg = await baseDatabase();
  await pg.exec(stripTxn(migration064));

  await assert.rejects(
    pg.exec(`set role anon; ${insertSql()}; reset role;`),
    /permission denied|row-level security/i,
    'anon must not be able to INSERT',
  );
  await assert.rejects(
    pg.exec(`set role service_role; ${insertSql()}; reset role;`),
    /permission denied|row-level security/i,
    'service_role must not be able to INSERT either: this table is migration/human-curation-owned and read-only at runtime',
  );
}

// Cross-kind consistency check: a category_override row must carry category_value and no
// evidence_class_id, and vice versa.
{
  const pg = await baseDatabase();
  await pg.exec(stripTxn(migration064));

  await assert.rejects(
    pg.query(insertSql({ kind: 'category_override', categoryValue: 'habilitating', evidenceClassId: 'rup' })),
    /check constraint|violates check/i,
    'a category_override row must not also carry an evidence_class_id',
  );
  await assert.rejects(
    pg.query(insertSql({ kind: 'evidence_class_link', categoryValue: null, evidenceClassId: null })),
    /check constraint|violates check/i,
    'an evidence_class_link row must carry a real evidence_class_id',
  );
  await assert.rejects(
    pg.query(insertSql({ kind: 'category_override', categoryValue: 'compliant' })),
    /check constraint|violates check/i,
    'category_value is a closed enum — an unrecognized value must be rejected',
  );
  await assert.rejects(
    pg.query(insertSql({ kind: 'evidence_class_link', categoryValue: null, evidenceClassId: 'not_a_real_class' })),
    /check constraint|violates check/i,
    'evidence_class_id must be one of the 17-class closed catalog',
  );
  await assert.rejects(
    pg.query(insertSql({ rationale: '' })),
    /check constraint|violates check/i,
    'an empty rationale must never be accepted',
  );
  await assert.rejects(
    pg.query(insertSql({ sourceReference: '   ' })),
    /check constraint|violates check/i,
    'an empty/blank source_reference must never be accepted',
  );
}

// Versioning invariant: only one current=true row per (opportunity_id, requirement_id, override_kind).
{
  const pg = await baseDatabase();
  await pg.exec(stripTxn(migration064));
  await pg.query(insertSql());

  await assert.rejects(
    pg.query(insertSql()),
    /duplicate key|unique/i,
    'a second current=true row for the same opportunity/requirement/kind must be rejected',
  );

  // A superseding, non-current version is allowed to coexist.
  await pg.query(`
    insert into ${TABLE} (opportunity_id, requirement_id, override_kind, category_value, evidence_class_id, rationale, source_reference, curated_by, current, version)
    values ('${O}', 'req-1', 'category_override', 'technical', null, 'Reclasificación posterior con nueva evidencia.', 'pliego:seccion-1:addenda-1', '${P}', false, 2)
  `);
  const { rows } = await pg.query(`select count(*)::int n from ${TABLE} where requirement_id = 'req-1'`);
  assert.equal(rows[0].n, 2, 'a non-current version may coexist with the current one');

  // The same requirement_id may carry both a category_override and an evidence_class_link
  // row (they govern independent maps) without tripping the one-current-per-kind index.
  await pg.query(insertSql({ requirementId: 'req-1', kind: 'evidence_class_link', categoryValue: null, evidenceClassId: 'rup' }));
  const { rows: bothKinds } = await pg.query(`select count(*)::int n from ${TABLE} where requirement_id = 'req-1' and current`);
  assert.equal(bothKinds[0].n, 2, 'req-1 may have one current category_override row and one current evidence_class_link row simultaneously');
}

// A row referencing a nonexistent opportunity or curator must be rejected (real FK
// integrity, not a loosely-typed text column).
{
  const pg = await baseDatabase();
  await pg.exec(stripTxn(migration064));
  await assert.rejects(
    pg.query(insertSql({ opportunityId: '99999999-9999-4999-8999-999999999999' })),
    /foreign key|violates/i,
  );
  await assert.rejects(
    pg.query(insertSql({ curatedBy: '99999999-9999-4999-8999-999999999999' })),
    /foreign key|violates/i,
  );
}

console.log('AGT-002 migration 064 (integral governance overrides) PGlite integration passed');
