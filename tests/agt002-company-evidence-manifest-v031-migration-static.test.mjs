import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration061 = readFileSync(new URL('../supabase/migrations/061_agt002_company_evidence_registry.sql', import.meta.url), 'utf8');
const migration075 = readFileSync(new URL('../supabase/migrations/075_agt002_company_evidence_manifest_v031.sql', import.meta.url), 'utf8');
const rollback075 = readFileSync(new URL('../supabase/rollbacks/075_agt002_company_evidence_manifest_v031_rollback.sql', import.meta.url), 'utf8');

const TABLE = 'public.psi_agt002_company_evidence_registry';
const V02 = 'v0.2-provisional-20260801';
const V031 = 'v0.3.1-approved-20260829';
const OLD_OVERTIME_HASH = '253da91361c53bcbcbdf7655c65f217c864d64ba116222583c14b3ef4c60ebfa';

const SPECIAL_ENTRIES = ['communications_license', 'financial_and_tax_pack', 'overtime_authorization', 'corporate_background_checks'];
const ALL_ENTRIES = [
  'supervigilancia_operating_license', 'rup', 'rut', 'communications_license',
  'uniforms_resolution', 'no_fines_sanctions_certificate', 'authorized_weapons_list',
  'rce_policy', 'collective_life_policy', 'accredited_experience',
  'financial_and_tax_pack', 'bank_certificate', 'overtime_authorization',
  'corporate_background_checks', 'legal_representative_vault',
  'personnel_credentials_vault', 'differential_scoring_support',
];
const DIRECT_ENTRIES = ALL_ENTRIES.filter((e) => !SPECIAL_ENTRIES.includes(e));

function stripTxn(sql) {
  return sql.replace(/^\s*begin\s*;/i, '').replace(/commit\s*;\s*$/i, '').trim();
}

function asObject(jsonbValue) {
  return typeof jsonbValue === 'string' ? JSON.parse(jsonbValue) : jsonbValue;
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

async function totalRowCount(pg) {
  const { rows } = await pg.query(`select count(*)::int n from ${TABLE}`);
  return rows[0].n;
}

async function currentRows(pg, sourceVersion) {
  const { rows } = await pg.query(`
    select entry_id, version, hash, hash_contrastado_corpus_index hc, existence_status, human_review_status,
           applicability_status, decision_humana, decision_humana_fecha::text dhf, estado_posterior_decision,
           allowed_use, notes, vigencia_text, expiry::text expiry
    from ${TABLE} where current and source_manifest_version = $1 order by entry_id
  `, [sourceVersion]);
  return rows;
}

async function assertV031State(pg, label) {
  const rows = await currentRows(pg, V031);
  assert.equal(rows.length, 17, `${label}: exactly 17 current v0.3.1 rows`);
  assert.deepEqual(rows.map((r) => r.entry_id).sort(), [...ALL_ENTRIES].sort(), `${label}: all 17 entry_ids present as current v0.3.1`);

  for (const r of rows) {
    const allowedUse = asObject(r.allowed_use);
    assert.equal(r.version, 2, `${label}: ${r.entry_id} must be version 2`);
    assert.equal(r.human_review_status, 'pending_human_review', `${label}: ${r.entry_id} human_review_status`);
    assert.equal(r.applicability_status, 'pending_case_validation', `${label}: ${r.entry_id} applicability_status`);
    assert.equal(r.decision_humana, null, `${label}: ${r.entry_id} decision_humana must be null`);
    assert.equal(r.dhf, null, `${label}: ${r.entry_id} decision_humana_fecha must be null`);
    assert.equal(r.estado_posterior_decision, null, `${label}: ${r.entry_id} estado_posterior_decision must be null`);
    assert.equal(allowedUse.internal_decision_support, true, `${label}: ${r.entry_id} allowed_use.internal_decision_support`);
    assert.equal(allowedUse.external_submission_authority, false, `${label}: ${r.entry_id} allowed_use.external_submission_authority`);
    assert.equal(allowedUse.automatic_final_approval, false, `${label}: ${r.entry_id} allowed_use.automatic_final_approval`);
    assert.notEqual(r.hash, OLD_OVERTIME_HASH, `${label}: ${r.entry_id} must never carry the old overtime_authorization hash`);
  }

  const v02Rows = await pg.query(`select entry_id, hash, hash_contrastado_corpus_index hc, existence_status from ${TABLE} where version = 1 and source_manifest_version = $1`, [V02]);
  const v02ByEntry = Object.fromEntries(v02Rows.rows.map((r) => [r.entry_id, r]));
  const byEntry = Object.fromEntries(rows.map((r) => [r.entry_id, r]));

  for (const entryId of DIRECT_ENTRIES) {
    assert.equal(byEntry[entryId].hash, v02ByEntry[entryId].hash, `${label}: ${entryId} hash preserved from v0.2`);
    assert.equal(byEntry[entryId].existence_status, v02ByEntry[entryId].existence_status, `${label}: ${entryId} existence_status preserved from v0.2`);
    assert.equal(byEntry[entryId].hc, v02ByEntry[entryId].hc, `${label}: ${entryId} hash_contrastado preserved from v0.2`);
  }

  const cl = byEntry.communications_license;
  assert.equal(cl.existence_status, 'reported', `${label}: communications_license existence_status`);
  assert.equal(cl.hash, '8e1f0b37b48d1de7128e2b7f4b29a29ac308f6baceb5c555b9554ce5d9881ace', `${label}: communications_license hash`);
  assert.equal(cl.hc, true, `${label}: communications_license hash_contrastado`);
  assert.match(cl.notes, /cinco/i, `${label}: communications_license notes must mention the five-permit composite`);
  assert.match(cl.notes, /firmeza/i, `${label}: communications_license notes must mention the firmeza gate`);
  assert.match(cl.notes, /titularidad/i, `${label}: communications_license notes must mention the titularidad gate`);
  assert.match(cl.notes, /territorio/i, `${label}: communications_license notes must mention the territorio gate`);
  assert.doesNotMatch(cl.notes, /suficient(e|es) para|suficiencia (confirmada|acreditada)/i, `${label}: communications_license notes must not assert sufficiency`);

  const fp = byEntry.financial_and_tax_pack;
  assert.equal(fp.existence_status, 'not_verified', `${label}: financial_and_tax_pack existence_status`);
  assert.equal(fp.hash, null, `${label}: financial_and_tax_pack hash`);
  assert.notEqual(fp.hc, true, `${label}: financial_and_tax_pack hash_contrastado must not be true`);
  assert.match(fp.notes, /incompleto/i, `${label}: financial_and_tax_pack notes must state the pack is incomplete`);
  assert.match(fp.notes, /corporate_tax_return|declaración de renta/i, `${label}: financial_and_tax_pack notes must address corporate_tax_return`);

  const ot = byEntry.overtime_authorization;
  assert.equal(ot.existence_status, 'not_verified', `${label}: overtime_authorization existence_status`);
  assert.equal(ot.hash, null, `${label}: overtime_authorization hash`);
  assert.notEqual(ot.hc, true, `${label}: overtime_authorization hash_contrastado must not be true`);
  assert.match(ot.notes, /MinTrabajo|Ministerio del Trabajo/i, `${label}: overtime_authorization notes must address MinTrabajo authorization`);

  const cbc = byEntry.corporate_background_checks;
  assert.equal(cbc.existence_status, 'reported', `${label}: corporate_background_checks existence_status`);
  assert.equal(cbc.hash, '5cf1e715b51d18dc6a4643308447f7c238c0c73471c8eb81598f39da7dcf90bf', `${label}: corporate_background_checks hash`);
  assert.equal(cbc.hc, true, `${label}: corporate_background_checks hash_contrastado`);
  assert.equal(cbc.expiry, '2026-08-29', `${label}: corporate_background_checks expiry`);
  assert.match(cbc.notes + cbc.vigencia_text, /tres|3 consultas/i, `${label}: corporate_background_checks must mention three queries`);
  assert.match(cbc.notes + cbc.vigencia_text, /89 días/i, `${label}: corporate_background_checks must mention the 89-day window`);
  assert.match(cbc.notes + cbc.vigencia_text, /(no (constituye|afirma)|sin afirmar) vigencia contractual/i, `${label}: corporate_background_checks must not assert contractual currency`);
}

async function assertV02Deactivated(pg, label) {
  const { rows: activeV02 } = await pg.query(`select count(*)::int n from ${TABLE} where current and source_manifest_version = $1`, [V02]);
  assert.equal(activeV02[0].n, 0, `${label}: no v0.2 row may still be current`);
  const { rows: preservedV02 } = await pg.query(`select count(*)::int n from ${TABLE} where version = 1 and source_manifest_version = $1`, [V02]);
  assert.equal(preservedV02[0].n, 17, `${label}: all 17 v0.2 rows must still exist (append-only, no delete)`);
}

// --- Static safety: append-only, no destructive statements, no leaked old hash. ---
for (const [name, sql] of [['migration', migration075], ['rollback', rollback075]]) {
  assert.doesNotMatch(sql, /\bdelete\s+from\b/i, `${name} must never DELETE`);
  assert.doesNotMatch(sql, /\btruncate\b/i, `${name} must never TRUNCATE`);
  assert.doesNotMatch(sql, /\bdrop\s+table\b/i, `${name} must never DROP TABLE`);
  assert.doesNotMatch(sql, new RegExp(OLD_OVERTIME_HASH, 'i'), `${name} must never reference the old overtime_authorization hash`);
}
assert.match(migration075, /fail-closed|refusing to promote|refusing to roll back/i, 'migration must document the fail-closed guard');
assert.match(rollback075, /fail-closed|refusing to promote|refusing to roll back/i, 'rollback must document the fail-closed guard');

// --- Full lifecycle: 061 apply -> 075 apply -> apply/apply idempotent -> rollback -> ---
// --- rollback/rollback idempotent -> reapply, all against a real PGlite database.   ---
{
  const pg = await baseDatabase();
  await pg.exec(stripTxn(migration061));
  assert.equal(await totalRowCount(pg), 17, 'after 061: 17 seed rows');

  await pg.exec(stripTxn(migration075));
  assert.equal(await totalRowCount(pg), 34, 'after 075: 17 v0.2 (deactivated) + 17 v0.3.1 (current) rows, append-only');
  await assertV031State(pg, 'after 075 apply');
  await assertV02Deactivated(pg, 'after 075 apply');

  // Idempotent re-run: must not create version=3 rows, duplicate anything, or change content.
  await pg.exec(stripTxn(migration075));
  assert.equal(await totalRowCount(pg), 34, 'after 075 apply/apply: row count unchanged');
  await assertV031State(pg, 'after 075 apply/apply');
  const { rows: versions } = await pg.query(`select distinct version from ${TABLE} order by version`);
  assert.deepEqual(versions.map((r) => r.version), [1, 2], 'no version beyond 2 must ever be created by a bare re-run');

  // Rollback: deactivates v0.3.1, restores v0.2 current, deletes nothing.
  await pg.exec(stripTxn(rollback075));
  assert.equal(await totalRowCount(pg), 34, 'after rollback: row count unchanged (append-only, nothing deleted)');
  const { rows: v031AfterRollback } = await pg.query(`select count(*)::int n from ${TABLE} where current and source_manifest_version = $1`, [V031]);
  assert.equal(v031AfterRollback[0].n, 0, 'after rollback: no v0.3.1 row may still be current');
  const { rows: v031StillPresent } = await pg.query(`select count(*)::int n from ${TABLE} where version = 2 and source_manifest_version = $1`, [V031]);
  assert.equal(v031StillPresent[0].n, 17, 'after rollback: v0.3.1 rows must still exist, only deactivated');
  const { rows: v02CurrentAfterRollback } = await pg.query(`select count(*)::int n from ${TABLE} where current and source_manifest_version = $1`, [V02]);
  assert.equal(v02CurrentAfterRollback[0].n, 17, 'after rollback: v0.2 current must be restored');

  // Rollback/rollback idempotent.
  await pg.exec(stripTxn(rollback075));
  assert.equal(await totalRowCount(pg), 34, 'after rollback/rollback: row count unchanged');
  const { rows: v02CurrentAfterRollback2 } = await pg.query(`select count(*)::int n from ${TABLE} where current and source_manifest_version = $1`, [V02]);
  assert.equal(v02CurrentAfterRollback2[0].n, 17, 'after rollback/rollback: v0.2 still current');

  // Reapply after rollback: must restore v0.3.1 as current without creating new rows/versions.
  await pg.exec(stripTxn(migration075));
  assert.equal(await totalRowCount(pg), 34, 'after reapply: row count unchanged, existing v0.3.1 rows reused');
  await assertV031State(pg, 'after reapply');
  await assertV02Deactivated(pg, 'after reapply');
  const { rows: versionsAfterReapply } = await pg.query(`select distinct version from ${TABLE} order by version`);
  assert.deepEqual(versionsAfterReapply.map((r) => r.version), [1, 2], 'reapply must never create a version beyond 2');
}

// --- Fail-closed: an unrecognized current source_manifest_version blocks 075 entirely. ---
{
  const pg = await baseDatabase();
  await pg.exec(stripTxn(migration061));
  await pg.query(`update ${TABLE} set source_manifest_version = 'v0.9-rogue-future' where entry_id = 'rup' and current`);

  await assert.rejects(
    pg.exec(stripTxn(migration075)),
    /unexpected source_manifest_version|refusing to promote/i,
    '075 must refuse to run when a current row carries an unrecognized source_manifest_version',
  );
  const { rows: untouched } = await pg.query(`select count(*)::int n from ${TABLE} where current and source_manifest_version = $1`, [V031]);
  assert.equal(untouched[0].n, 0, 'fail-closed guard must prevent any v0.3.1 row from being created');
  assert.equal(await totalRowCount(pg), 17, 'fail-closed guard must leave the table untouched');
}

// --- Fail-closed: an unrecognized current source_manifest_version blocks rollback too. ---
{
  const pg = await baseDatabase();
  await pg.exec(stripTxn(migration061));
  await pg.exec(stripTxn(migration075));
  await pg.query(`update ${TABLE} set source_manifest_version = 'v0.9-rogue-future' where entry_id = 'rup' and current`);

  await assert.rejects(
    pg.exec(stripTxn(rollback075)),
    /unexpected source_manifest_version|refusing to roll back/i,
    'rollback must refuse to run when a current row carries an unrecognized source_manifest_version',
  );
  const { rows: stillV031 } = await pg.query(`select count(*)::int n from ${TABLE} where current and source_manifest_version = $1`, [V031]);
  assert.equal(stillV031[0].n, 16, 'fail-closed guard must leave the other 16 v0.3.1 rows untouched (only rup was rogue-tagged)');
}

console.log('AGT-002 company evidence manifest v0.3.1 (075) migration static/PGlite safety passed');
