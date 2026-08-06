import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration061 = readFileSync(new URL('../supabase/migrations/061_agt002_company_evidence_registry.sql', import.meta.url), 'utf8');
const rollback061 = readFileSync(new URL('../supabase/rollbacks/061_agt002_company_evidence_registry_rollback.sql', import.meta.url), 'utf8');

const ALL_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
const TABLE = 'public.psi_agt002_company_evidence_registry';

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
    where n.nspname = 'public' and c.relname = 'psi_agt002_company_evidence_registry'
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

async function rowCount(pg) {
  const { rows } = await pg.query(`select count(*)::int n from ${TABLE}`);
  return rows[0].n;
}

async function assertIngestedContent(pg, label) {
  assert.equal(await rowCount(pg), 17, `${label}: must ingest exactly the 17 active entries`);

  const { rows: statusRows } = await pg.query(`
    select count(*)::int n from ${TABLE}
    where existence_status <> 'reported' or human_review_status <> 'pending_human_review' or applicability_status <> 'pending_case_validation'
  `);
  assert.equal(statusRows[0].n, 0, `${label}: every row must be reported/pending_human_review/pending_case_validation`);

  const { rows: currentRows } = await pg.query(`select count(*)::int n from ${TABLE} where current <> true`);
  assert.equal(currentRows[0].n, 0, `${label}: every ingested row must be current`);

  const { rows: distinctEntries } = await pg.query(`select count(distinct entry_id)::int n from ${TABLE}`);
  assert.equal(distinctEntries[0].n, 17, `${label}: entry_id must be distinct across the 17 rows`);

  const { rows: license } = await pg.query(`
    select source_reference, item_id, hash, expiry::text expiry, human_gate, metadata_only, vigente_para_habilitacion
    from ${TABLE} where entry_id = 'supervigilancia_operating_license'
  `);
  assert.equal(license.length, 1, `${label}: supervigilancia_operating_license must be ingested`);
  assert.equal(license[0].source_reference, 'LICENCIA DE FUNCIONAMIENTO SEGURIDAD NACIONAL (3 copias idénticas)');
  assert.equal(license[0].item_id, '01PXSUBJ3FM4EW7U2H35BZF3IFBM2PTWRA');
  assert.equal(license[0].hash, '45d9857f2a128853d53b6e7040dcff9551668b5e4e936dcc4e2c7249dce88255');
  assert.equal(license[0].expiry, '2029-05-10', `${label}: license expiry must be the observed 2029-05-10 date`);
  assert.equal(license[0].human_gate, 'juridico_y_comercial');
  assert.equal(license[0].metadata_only, false);
  assert.equal(license[0].vigente_para_habilitacion, true);

  const { rows: rce } = await pg.query(`select expiry::text expiry from ${TABLE} where entry_id = 'rce_policy'`);
  assert.equal(rce[0].expiry, '2027-02-06', `${label}: rce_policy expiry must be the observed policy end date`);

  const { rows: expiryCount } = await pg.query(`select count(*)::int n from ${TABLE} where expiry is not null`);
  assert.equal(expiryCount[0].n, 2, `${label}: only the two entries with an unambiguous end date get an expiry`);

  const { rows: hashNullCount } = await pg.query(`select count(*)::int n from ${TABLE} where hash is null`);
  assert.equal(hashNullCount[0].n, 5, `${label}: 5 entries never had a hash in the source manifest`);

  const { rows: itemIdNullCount } = await pg.query(`select count(*)::int n from ${TABLE} where item_id is null`);
  assert.equal(itemIdNullCount[0].n, 4, `${label}: 4 entries had an empty canonical_sharepoint_item_id in the source manifest`);
}

// Core lifecycle: apply -> apply/apply idempotent -> rollback -> rollback/rollback idempotent.
{
  const pg = await baseDatabase();
  assert.equal(await tableExists(pg), false, 'pre-061 fixture must not have the table yet');

  await pg.exec(stripTxn(migration061));
  assert.equal(await tableExists(pg), true, 'table must exist after apply');
  await assertIngestedContent(pg, 'after apply 061');
  await assertExactServiceRoleSelectOnly(pg, 'after apply 061');

  // apply/apply: re-applying against an already-applied database must not
  // error, must not duplicate rows, and must leave the same content/grants.
  await pg.exec(stripTxn(migration061));
  await assertIngestedContent(pg, 'after apply/apply 061');
  await assertExactServiceRoleSelectOnly(pg, 'after apply/apply 061');

  await pg.exec(stripTxn(rollback061));
  assert.equal(await tableExists(pg), false, 'table must be gone after rollback');

  // rollback/rollback: re-running rollback against an already-rolled-back
  // database must not error and must leave the same absent state.
  await pg.exec(stripTxn(rollback061));
  assert.equal(await tableExists(pg), false, 'table must still be gone after rollback/rollback');
}

// Client roles (anon/authenticated/public) must never be able to write or read
// directly; only service_role may SELECT, and even service_role gets no
// INSERT/UPDATE/DELETE — this is a migration-owned canonical registry.
{
  const pg = await baseDatabase();
  await pg.exec(stripTxn(migration061));

  await assert.rejects(
    pg.exec(`set role anon; insert into ${TABLE} (entry_id, version, document_class, classification, estado_integracion, sensibilidad, source_reference, zona_almacenamiento, utilidad_decisional, accion_humana, human_gate, control_de_uso, metadata_only, vigente_para_habilitacion, vigencia_text) values ('x', 1, 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', true, true, 'x'); reset role;`),
    /permission denied|row-level security/i,
    'anon must not be able to INSERT',
  );

  await assert.rejects(
    pg.exec(`set role authenticated; update ${TABLE} set notes = 'tampered'; reset role;`),
    /permission denied|row-level security/i,
    'authenticated must not be able to UPDATE',
  );

  await assert.rejects(
    pg.exec(`set role service_role; insert into ${TABLE} (entry_id, version, document_class, classification, estado_integracion, sensibilidad, source_reference, zona_almacenamiento, utilidad_decisional, accion_humana, human_gate, control_de_uso, metadata_only, vigente_para_habilitacion, vigencia_text) values ('x', 1, 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', true, true, 'x'); reset role;`),
    /permission denied|row-level security/i,
    'service_role must not be able to INSERT either: this table is migration-owned and read-only at runtime',
  );
}

// Versioning invariant: only one current=true row may ever exist per entry_id.
{
  const pg = await baseDatabase();
  await pg.exec(stripTxn(migration061));

  await assert.rejects(
    pg.query(`
      insert into ${TABLE} (entry_id, version, current, document_class, classification, estado_integracion, sensibilidad, source_reference, zona_almacenamiento, utilidad_decisional, accion_humana, human_gate, control_de_uso, metadata_only, vigente_para_habilitacion, vigencia_text)
      values ('rup', 2, true, 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', true, true, 'x')
    `),
    /duplicate key|unique/i,
    'a second current=true row for the same entry_id must be rejected by the partial unique index',
  );

  // A superseding, non-current version for the same entry_id is allowed to coexist.
  await pg.query(`
    insert into ${TABLE} (entry_id, version, current, document_class, classification, estado_integracion, sensibilidad, source_reference, zona_almacenamiento, utilidad_decisional, accion_humana, human_gate, control_de_uso, metadata_only, vigente_para_habilitacion, vigencia_text)
    values ('rup', 2, false, 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', true, true, 'x')
  `);
  const { rows } = await pg.query(`select count(*)::int n from ${TABLE} where entry_id = 'rup'`);
  assert.equal(rows[0].n, 2, 'a non-current version may coexist with the current one');
}

// Applicability may leave pending_case_validation only with an explicit human
// decision and a completed review state; document presence alone cannot promote it.
{
  const pg = await baseDatabase();
  await pg.exec(stripTxn(migration061));
  await assert.rejects(
    pg.query(`update ${TABLE} set applicability_status = 'applicable' where entry_id = 'supervigilancia_operating_license'`),
    /check constraint|violates check/i,
    'applicability cannot be promoted without a human decision',
  );
}

console.log('AGT-002 migration 061 (company evidence registry) PGlite integration passed');
