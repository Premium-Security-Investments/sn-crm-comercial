import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const profileMigration = readFileSync(new URL('../supabase/migrations/012_company_procurement_profile.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/026_tender_document_versions.sql', import.meta.url), 'utf8');
const ids = {
  actor: '11111111-1111-4111-8111-111111111111',
  inactiveActor: '22222222-2222-4222-8222-222222222222',
  agentActor: '33333333-3333-4333-8333-333333333333',
};
const hash = character => character.repeat(64);
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated;
    create role service_role;
    alter role service_role bypassrls;
    grant service_role to current_user;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
    create function public.psi_sales_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
    create table public.psi_sales_profiles (
      id uuid primary key,
      active boolean not null default true,
      role text not null default 'admin',
      microsoft_email text not null default 'test@example.test',
      identity_type text default 'human'
    );
    insert into public.psi_sales_profiles (id, active, identity_type) values
      ('${ids.actor}', true, 'human'),
      ('${ids.inactiveActor}', false, 'human'),
      ('${ids.agentActor}', true, 'agent');
  `);
  await db.exec(profileMigration);
  await db.exec(migration);
  return db;
}

async function record(db, overrides = {}) {
  const input = {
    documentType: 'rup', displayName: 'RUP vigente', issuedAt: '2026-01-01', expiresAt: '2026-12-31',
    contentHash: hash('a'), storagePath: 'company-profile/rup-v1.pdf', mimeType: 'application/pdf',
    sizeBytes: 1024, uploadedBy: ids.actor, replaceDocumentId: null, ...overrides,
  };
  return (await one(db, `select public.psi_record_company_procurement_document(
    $1::text,$2::text,$3::date,$4::date,$5::text,$6::text,$7::text,$8::bigint,$9::uuid,$10::uuid
  ) as result`, [
    input.documentType, input.displayName, input.issuedAt, input.expiresAt, input.contentHash,
    input.storagePath, input.mimeType, input.sizeBytes, input.uploadedBy, input.replaceDocumentId,
  ])).result;
}

await (async function rupVersionsRemainAuditableAndOnlyNewestIsCurrent() {
  const db = await createDatabase();
  const first = await record(db);
  const second = await record(db, {
    displayName: 'RUP renovado', issuedAt: '2027-01-01', expiresAt: '2027-12-31',
    contentHash: hash('b'), storagePath: 'company-profile/rup-v2.pdf',
  });
  assert.equal(first.version, 1);
  assert.equal(second.version, 2);
  const rows = (await db.query(`select version, current from public.psi_company_procurement_documents where document_type='rup' order by version`)).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows.filter(row => row.current).length, 1);
  assert.equal(rows.find(row => row.current).version, 2);
  await db.close();
})();

await (async function retryingAnExistingTypeAndHashReturnsTheOriginalVersionWithoutChangingCurrentRows() {
  const db = await createDatabase();
  const first = await record(db);
  const latest = await record(db, {
    displayName: 'RUP renovado', issuedAt: '2027-01-01', expiresAt: '2027-12-31',
    contentHash: hash('b'), storagePath: 'company-profile/rup-v2.pdf',
  });
  const retry = await record(db, { contentHash: hash('a') });
  assert.equal(retry.id, first.id);
  assert.equal(retry.version, first.version);
  assert.equal(retry.current, false);
  assert.deepEqual((await db.query(`select id, version, current from public.psi_company_procurement_documents where document_type='rup' order by version`)).rows, [
    { id: first.id, version: 1, current: false },
    { id: latest.id, version: 2, current: true },
  ]);
  await db.close();
})();

await (async function expiredRupIsRecordedAsLatestCurrentVersionWithExpiryPreserved() {
  const db = await createDatabase();
  const expired = await record(db, {
    displayName: 'RUP histórico expirado',
    issuedAt: '2000-01-01',
    expiresAt: '2000-12-31',
    contentHash: hash('f'),
    storagePath: 'company-profile/rup-expired.pdf',
  });
  assert.equal(expired.version, 1);
  assert.equal(expired.current, true);
  assert.equal(expired.expires_at, '2000-12-31');
  assert.deepEqual((await db.query(`select version, current, expires_at::text as expires_at from public.psi_company_procurement_documents where id = $1`, [expired.id])).rows, [
    { version: 1, current: true, expires_at: '2000-12-31' },
  ]);
  await db.close();
})();

await (async function categoriesCanRemainCurrentUnlessAnExplicitReplacementIsProvided() {
  const db = await createDatabase();
  const certificate = await record(db, {
    documentType: 'certificate', displayName: 'Certificado vigente', contentHash: hash('c'), storagePath: 'company-profile/certificate-v1.pdf',
  });
  const insurance = await record(db, {
    documentType: 'insurance', displayName: 'Póliza vigente', contentHash: hash('d'), storagePath: 'company-profile/insurance-v1.pdf',
  });
  assert.equal(certificate.current, true);
  assert.equal(insurance.current, true);
  assert.equal(Number((await one(db, 'select count(*)::int as count from public.psi_company_procurement_documents where current')).count), 2);
  const replacement = await record(db, {
    documentType: 'certificate', displayName: 'Certificado renovado', contentHash: hash('e'), storagePath: 'company-profile/certificate-v2.pdf', replaceDocumentId: certificate.id,
  });
  assert.equal(replacement.version, 2);
  const certificateRows = (await db.query(`select version, current from public.psi_company_procurement_documents where document_type='certificate' order by version`)).rows;
  assert.deepEqual(certificateRows, [{ version: 1, current: false }, { version: 2, current: true }]);
  assert.equal((await one(db, `select current from public.psi_company_procurement_documents where id=$1`, [insurance.id])).current, true);
  await db.close();
})();

await (async function sameNonRupTypeCanKeepMultipleCurrentRowsWithoutAnExplicitReplacement() {
  const db = await createDatabase();
  const first = await record(db, {
    documentType: 'certificate', displayName: 'Certificado A', contentHash: hash('1'), storagePath: 'company-profile/certificate-a.pdf',
  });
  const second = await record(db, {
    documentType: 'certificate', displayName: 'Certificado B', contentHash: hash('2'), storagePath: 'company-profile/certificate-b.pdf',
  });
  assert.deepEqual([first.version, second.version], [1, 2]);
  assert.deepEqual((await db.query(`select version, current from public.psi_company_procurement_documents where document_type='certificate' order by version`)).rows, [
    { version: 1, current: true },
    { version: 2, current: true },
  ]);
  await db.close();
})();

await (async function rpcEnforcesRoleBoundaryAndRejectsInvalidInputs() {
  const db = await createDatabase();
  await assert.rejects(() => record(db, { contentHash: 'A'.repeat(64) }), /hash/i);
  await assert.rejects(() => record(db, { storagePath: 'other/rup.pdf' }), /ruta/i);
  await assert.rejects(() => record(db, { storagePath: 'company-profile/a/../rup.pdf' }), /ruta/i);
  await assert.rejects(() => record(db, { sizeBytes: 0 }), /tamaño/i);
  await assert.doesNotReject(() => record(db, { sizeBytes: 50 * 1024 * 1024 }));
  await assert.rejects(() => record(db, { sizeBytes: 50 * 1024 * 1024 + 1 }), /tamaño/i);
  await assert.rejects(() => record(db, { issuedAt: '2026-12-31', expiresAt: '2026-01-01' }), /fechas/i);
  await assert.rejects(() => record(db, { uploadedBy: ids.inactiveActor }), /actor/i);
  await assert.rejects(() => record(db, { uploadedBy: ids.agentActor }), /actor/i);
  await db.exec('set role service_role');
  const serviceRoleRecord = await record(db, { contentHash: hash('b'), storagePath: 'company-profile/service-role.pdf' });
  assert.equal(serviceRoleRecord.version, 2);
  await assert.rejects(() => db.query(`insert into public.psi_company_procurement_documents (document_type, display_name, issued_at, content_hash, storage_path, mime_type, size_bytes, uploaded_by) values ('rup', 'direct', '2026-01-01', '${hash('f')}', 'company-profile/direct.pdf', 'application/pdf', 1, '${ids.actor}')`), /permission denied/i);
  await db.exec('reset role; set role authenticated');
  await assert.rejects(() => record(db, { contentHash: hash('9'), storagePath: 'company-profile/authenticated.pdf' }), /permission denied/i);
  await assert.rejects(() => db.query(`insert into public.psi_company_procurement_documents (document_type, display_name, issued_at, content_hash, storage_path, mime_type, size_bytes, uploaded_by) values ('rup', 'direct', '2026-01-01', '${hash('f')}', 'company-profile/direct.pdf', 'application/pdf', 1, '${ids.actor}')`), /permission denied/i);
  await db.exec('reset role');
  await db.close();
})();

console.log('PGlite tender document versions integration passed');
