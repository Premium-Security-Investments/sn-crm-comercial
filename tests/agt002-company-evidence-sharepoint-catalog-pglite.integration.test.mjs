// AGT-002 — migration 080 (governed SharePoint company-evidence catalog) against a real
// Postgres (PGlite): privilege posture, the seeded live-safe facts of the adjudicated Rama
// Judicial Pereira historical folder, the single safe snapshot RPC, and the determinism /
// sensitivity of catalog_snapshot_hash.
//
// RED reason: `supabase/migrations/080_agt002_company_evidence_sharepoint_catalog.sql`, its
// rollback and the reviewed fixture do not exist on this branch, so `readFileSync` throws
// ENOENT before any database is created.
//
// PGlite ships no pgcrypto, so the fixture pre-creates the `extensions` schema and a real
// sha256-backed `extensions.digest` before applying 080, and strips only the CREATE EXTENSION
// statement (asserted present in the production SQL above). Every hash asserted below is a
// genuine sha256.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration061 = readFileSync(new URL('../supabase/migrations/061_agt002_company_evidence_registry.sql', import.meta.url), 'utf8');
const migration075 = readFileSync(new URL('../supabase/migrations/075_agt002_company_evidence_manifest_v031.sql', import.meta.url), 'utf8');
const migration080Production = readFileSync(new URL('../supabase/migrations/080_agt002_company_evidence_sharepoint_catalog.sql', import.meta.url), 'utf8');
const rollback080 = readFileSync(new URL('../supabase/rollbacks/080_agt002_company_evidence_sharepoint_catalog_rollback.sql', import.meta.url), 'utf8');
const fixture = JSON.parse(readFileSync(new URL('../fixtures/agt002/company-evidence/pereira-sharepoint-safe-catalog-v1.json', import.meta.url), 'utf8'));

assert.match(migration080Production, /create extension if not exists pgcrypto with schema extensions;/i,
  'production 080 must declare the pgcrypto prerequisite even though PGlite cannot install it');
const migration080 = migration080Production.replace(/create extension if not exists pgcrypto with schema extensions;/i, '');

const SOURCE_FILES = 'public.psi_agt002_company_evidence_source_files';
const LINKS = 'public.psi_agt002_company_evidence_source_file_links';
const RPC = 'public.psi_get_agt002_company_evidence_inventory_snapshot';
const ALL_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
const ISO_MS_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function stripTxn(sql) {
  return sql.replace(/^\s*begin\s*;/i, '').replace(/commit\s*;\s*$/i, '').trim();
}

async function baseDatabase() {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated; create role service_role; create role anon;
    grant service_role to current_user;
    -- Deliberately hostile default: anything the migration forgets to revoke stays visible.
    alter default privileges in schema public grant all on tables to anon;
    create function public.psi_sales_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true);
    create schema if not exists extensions;
    create function extensions.digest(data bytea, algo text) returns bytea language sql immutable as $$ select sha256(data) $$;
  `);
  await pg.exec(stripTxn(migration061));
  await pg.exec(stripTxn(migration075));
  return pg;
}

const one = async (pg, sql) => (await pg.query(sql)).rows[0];

async function relationExists(pg, qualified) {
  return (await one(pg, `select to_regclass('${qualified}') is not null ok`)).ok === true;
}

async function functionExists(pg) {
  return (await one(pg, `select to_regprocedure('${RPC}()') is not null ok`)).ok === true;
}

async function snapshotOf(pg) {
  return (await one(pg, `select ${RPC}() snapshot`)).snapshot;
}

// ===========================================================================
// A. Structure, privileges, seed, RPC contract, idempotent apply and rollback.
// ===========================================================================
{
  const pg = await baseDatabase();
  assert.equal(await relationExists(pg, SOURCE_FILES), false, 'pre-080 fixture must not have the catalog tables yet');

  await pg.exec(stripTxn(migration080));
  assert.equal(await relationExists(pg, SOURCE_FILES), true);
  assert.equal(await relationExists(pg, LINKS), true);
  assert.equal(await functionExists(pg), true);

  // --- RLS on, and NO privileges at all for any role: the RPC is the only read path. ---
  for (const table of [SOURCE_FILES, LINKS]) {
    const { rows } = await pg.query(`
      select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = '${table.replace('public.', '')}'
    `);
    assert.equal(rows[0]?.relrowsecurity, true, `${table}: RLS must be enabled`);
    for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
      for (const priv of ALL_PRIVS) {
        const { ok } = await one(pg, `select has_table_privilege('${role}', '${table}', '${priv}') ok`);
        assert.equal(ok, false, `${table}: ${role} must have no ${priv} privilege`);
      }
    }
  }

  // --- Only service_role may execute the security-definer snapshot RPC. ---
  assert.equal((await one(pg, `select has_function_privilege('service_role', '${RPC}()', 'EXECUTE') ok`)).ok, true);
  for (const role of ['public', 'anon', 'authenticated']) {
    assert.equal(
      (await one(pg, `select has_function_privilege('${role}', '${RPC}()', 'EXECUTE') ok`)).ok,
      false,
      `${role} must not be able to execute the snapshot RPC`,
    );
  }
  assert.equal(
    (await one(pg, `select prosecdef from pg_proc where oid = '${RPC}()'::regprocedure`)).prosecdef,
    true,
    'the snapshot RPC must be SECURITY DEFINER',
  );

  // --- Opaque metadata only: no column may name or locate a SharePoint item. ---
  {
    const { rows } = await pg.query(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'psi_agt002_company_evidence_source_files'
    `);
    const columns = rows.map(r => r.column_name);
    for (const column of columns) {
      assert.doesNotMatch(
        column,
        /name|path|url|etag|title|folder|display|item/i,
        `${column}: the source-file table stores opaque metadata only — never a name, path, URL, eTag or item id`,
      );
    }
    for (const required of ['disposition', 'governed_state', 'source_fingerprint', 'source_revision', 'last_modified_at']) {
      assert.ok(columns.includes(required), `the source-file table must carry an opaque ${required} column`);
    }
  }

  // --- Seeded live-safe facts of the adjudicated Pereira historical folder. ---
  assert.equal((await one(pg, `select count(*)::int n from ${SOURCE_FILES}`)).n, 93, '93 source rows');
  assert.equal((await one(pg, `select count(*)::int n from ${SOURCE_FILES} where disposition = 'evidence'`)).n, 92, '92 evidence rows');
  assert.equal((await one(pg, `select count(*)::int n from ${SOURCE_FILES} where disposition = 'excluded_non_evidence'`)).n, 1, '1 excluded non-evidence row');
  const expectedStates = {
    current_valid: 0, historical_update_required: 25, reported_unverified: 50, absent_unknown: 0, process_specific_template: 17,
  };
  for (const [state, expected] of Object.entries(expectedStates)) {
    assert.equal(
      (await one(pg, `select count(*)::int n from ${SOURCE_FILES} where disposition = 'evidence' and governed_state = '${state}'`)).n,
      expected,
      `evidence rows in ${state}`,
    );
  }
  assert.equal(
    (await one(pg, `select count(distinct entry_id)::int n from ${LINKS}`)).n, 17,
    'all 17 technical classes must be represented by at least one linked source file',
  );
  assert.equal(
    (await one(pg, `select count(*)::int n from ${SOURCE_FILES} f where f.disposition = 'evidence' and not exists (select 1 from ${LINKS} l where l.source_file_id = f.id)`)).n,
    0,
    'every evidence source file must be linked to at least one class — never silently orphaned',
  );
  assert.equal(
    (await one(pg, `select count(*)::int n from ${LINKS} l join public.psi_agt002_company_evidence_registry r on r.entry_id = l.entry_id and r.version = l.entry_version where not r.current`)).n,
    0,
    'links must point at the CURRENT (v0.3.1-approved) registry version, never a superseded one',
  );

  // --- The RPC returns exactly one safe snapshot, in the closed JS contract shape. ---
  const snapshot = await snapshotOf(pg);
  assert.deepEqual(
    Object.keys(snapshot).sort(),
    ['catalog_snapshot_hash', 'classes', 'excluded_non_evidence_count', 'inventory_version', 'source_file_count', 'state_counts'].sort(),
  );
  assert.equal(snapshot.inventory_version, 'agt002-company-evidence-sharepoint-catalog-v1');
  assert.match(snapshot.catalog_snapshot_hash, /^[0-9a-f]{64}$/, 'catalog_snapshot_hash must be a 64-char lowercase sha256 digest');
  assert.equal(snapshot.source_file_count, 93);
  assert.equal(snapshot.excluded_non_evidence_count, 1);
  assert.deepEqual(snapshot.state_counts, expectedStates);
  assert.equal(snapshot.classes.length, 17);
  for (const cls of snapshot.classes) {
    assert.deepEqual(
      Object.keys(cls).sort(),
      ['effective_state', 'entry_id', 'last_reconciled_at', 'source_file_count', 'state_counts'].sort(),
      'a snapshot class may expose only the five safe fields',
    );
    if (cls.last_reconciled_at !== null) {
      assert.match(cls.last_reconciled_at, ISO_MS_UTC, 'last_reconciled_at must be canonical ISO-8601 UTC with milliseconds');
    }
  }
  // Nothing identifying may ride along: no row id, no locator, no free text.
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, UUID_ANYWHERE, 'the snapshot must never carry a source-file row id');
  assert.doesNotMatch(serialized, /https?:\/\/|sharepoint|\/sites\/|\.pdf|\.docx|\.zip/i);

  // --- Fixture and seed are the same reviewed catalog, hash included. ---
  assert.deepEqual(
    snapshot, fixture,
    'fixtures/agt002/company-evidence/pereira-sharepoint-safe-catalog-v1.json must be exactly what the seeded RPC returns',
  );

  // --- Deterministic: the same catalog always fingerprints the same. ---
  assert.equal((await snapshotOf(pg)).catalog_snapshot_hash, snapshot.catalog_snapshot_hash);

  // --- apply/apply is idempotent in content AND identity. ---
  await pg.exec(stripTxn(migration080));
  assert.equal((await one(pg, `select count(*)::int n from ${SOURCE_FILES}`)).n, 93, 're-applying 080 must not duplicate source rows');
  assert.deepEqual(await snapshotOf(pg), snapshot, 're-applying 080 must converge to the identical snapshot');
  for (const priv of ALL_PRIVS) {
    assert.equal((await one(pg, `select has_table_privilege('anon', '${SOURCE_FILES}', '${priv}') ok`)).ok, false, 'apply/apply must not restore default anon privileges');
  }

  // --- rollback, and rollback/rollback. ---
  await pg.exec(stripTxn(rollback080));
  assert.equal(await relationExists(pg, SOURCE_FILES), false);
  assert.equal(await relationExists(pg, LINKS), false);
  assert.equal(await functionExists(pg), false);
  assert.equal(
    (await one(pg, `select count(*)::int n from public.psi_agt002_company_evidence_registry where current`)).n, 17,
    'the rollback must leave the governed 17-class registry untouched',
  );

  await pg.exec(stripTxn(rollback080));
  assert.equal(await relationExists(pg, SOURCE_FILES), false, 'rollback/rollback must stay a no-op');
  assert.equal(await functionExists(pg), false);
}

// ===========================================================================
// B. catalog_snapshot_hash is a real fingerprint of source revision, state and links —
// a stale identity here would let a corrected/re-uploaded file silently reuse a run.
// ===========================================================================
{
  const pg = await baseDatabase();
  await pg.exec(stripTxn(migration080));

  const initial = await snapshotOf(pg);

  // (a) a source file revised in SharePoint (same counts, new revision/content fingerprint)
  await pg.exec(`
    update ${SOURCE_FILES}
    set source_revision = encode(extensions.digest(convert_to('revised-rev:' || source_revision, 'UTF8'), 'sha256'), 'hex'),
        source_fingerprint = encode(extensions.digest(convert_to('revised:' || source_fingerprint, 'UTF8'), 'sha256'), 'hex')
    where ctid = (select ctid from ${SOURCE_FILES} where disposition = 'evidence' order by source_fingerprint limit 1)
  `);
  const afterRevision = await snapshotOf(pg);
  assert.notEqual(afterRevision.catalog_snapshot_hash, initial.catalog_snapshot_hash,
    'a revised source file must change catalog_snapshot_hash even though every count is identical');
  assert.deepEqual(afterRevision.state_counts, initial.state_counts, 'precondition: only the revision changed, not the state counts');

  // (b) a governed state re-classified by human review
  await pg.exec(`
    update ${SOURCE_FILES}
    set governed_state = 'historical_update_required'
    where ctid = (select ctid from ${SOURCE_FILES} where disposition = 'evidence' and governed_state = 'reported_unverified' order by source_fingerprint limit 1)
  `);
  const afterState = await snapshotOf(pg);
  assert.notEqual(afterState.catalog_snapshot_hash, afterRevision.catalog_snapshot_hash, 'a re-classified state must change catalog_snapshot_hash');
  assert.equal(afterState.state_counts.reported_unverified, initial.state_counts.reported_unverified - 1);
  assert.equal(afterState.state_counts.historical_update_required, initial.state_counts.historical_update_required + 1);

  // (c) a link removed (the file is no longer curated onto that class)
  const { rows: linkTarget } = await pg.query(`
    select entry_id from ${LINKS} group by entry_id having count(*) > 1 order by entry_id limit 1
  `);
  assert.ok(linkTarget.length === 1, 'precondition: at least one class carries more than one linked source file');
  const targetEntryId = linkTarget[0].entry_id;
  const before = afterState.classes.find(cls => cls.entry_id === targetEntryId).source_file_count;
  await pg.exec(`delete from ${LINKS} where ctid = (select ctid from ${LINKS} where entry_id = '${targetEntryId}' limit 1)`);
  const afterLink = await snapshotOf(pg);
  assert.notEqual(afterLink.catalog_snapshot_hash, afterState.catalog_snapshot_hash, 'a changed class link must change catalog_snapshot_hash');
  assert.equal(afterLink.classes.find(cls => cls.entry_id === targetEntryId).source_file_count, before - 1);

  // The per-class totals stay internally consistent after every mutation above.
  for (const cls of afterLink.classes) {
    assert.equal(
      Object.values(cls.state_counts).reduce((sum, value) => sum + value, 0),
      cls.source_file_count,
      `${cls.entry_id}: state counts must always add up to its own source_file_count`,
    );
    assert.equal(
      cls.effective_state,
      cls.source_file_count === 0
        ? 'absent_unknown'
        : ['current_valid', 'historical_update_required', 'reported_unverified', 'process_specific_template']
          .find(state => cls.state_counts[state] > 0) ?? 'absent_unknown',
      `${cls.entry_id}: effective_state must always follow the closed precedence rule`,
    );
  }
  assert.equal(
    Object.values(afterLink.state_counts).reduce((sum, value) => sum + value, 0) + afterLink.excluded_non_evidence_count,
    afterLink.source_file_count,
    'the global totals must always reconcile',
  );
}

console.log('AGT-002 SharePoint company-evidence catalog migration 080 PGlite integration passed');
