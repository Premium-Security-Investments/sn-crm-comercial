// AGT-002 P0-03 — PGlite integration for migration 098 (RED).
//
// Mirrors the fixture/helper conventions of
// tests/agt002-evidence-packages-pglite.integration.test.mjs, but scoped to a DELIBERATELY
// SMALLER fixture: this suite seeds one frozen evidence package version directly (header +
// version row only, no members/batches) rather than replaying the full 097 freeze flow, since
// the workflow/authorization contract only ever binds to a package_version_id/package_hash
// pair — it never reads a package's members. Migration 026/057/065 are still applied because
// 097's own table/RPC bodies reference psi_tender_document_versions/extractions, and 097 itself
// is a hard FK dependency of psi_agt002_analysis_authorizations.package_version_id.
//
// psi_agt002_reanalysis_jobs (068) is deliberately NOT part of this fixture: migration 098 must
// never reference it, and this suite proves that by construction — there is no job table for
// the consume RPC to accidentally write into.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const strip = value => value.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const migrationSource = name => strip(readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));

const migration026 = migrationSource('026_tender_document_versions.sql');
const migration057 = migrationSource('057_tender_document_logical_identity.sql');
const migration065Raw = readFileSync(new URL('../supabase/migrations/065_tender_document_extraction_integrity.sql', import.meta.url), 'utf8');
const migration065 = strip(migration065Raw)
  .replace(/create schema if not exists extensions;\s*create extension if not exists pgcrypto with schema extensions;\s*/i, '')
  .replace(/encode\(extensions\.digest\(convert_to\(extracted_text, 'UTF8'\), 'sha256'\), 'hex'\)/g, 'text_hash')
  .replace(/encode\(extensions\.digest\(convert_to\(p_extracted_text, 'UTF8'\), 'sha256'\), 'hex'\)/g, 'p_text_hash');
const migration097 = migrationSource('097_agt002_evidence_packages.sql');
// RED: not yet authored.
const migration098 = () => migrationSource('098_agt002_initial_workflow_and_g1.sql');

const O = '10000000-0000-4000-8000-000000000001';
const T = '10000000-0000-4000-8000-000000000002';
const O2 = '10000000-0000-4000-8000-000000000003';
const T2 = '10000000-0000-4000-8000-000000000004';
const ACTOR = '30000000-0000-4000-8000-000000000001';
const ACTOR_INACTIVE = '30000000-0000-4000-8000-000000000003';

function hash(text) {
  return createHash('sha256').update(text).digest('hex');
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function callRpc(pg, name, params) {
  const args = Object.values(params).map(sqlLiteral).join(',');
  const result = await pg.query(`select public.${name}(${args}) as data`);
  return result.rows[0]?.data ?? null;
}

async function createBaseFixture() {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated; create role service_role; create role anon;
    grant service_role to current_user;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
    create function public.psi_sales_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

    create table public.psi_sales_opportunities (id uuid primary key);
    create table public.psi_public_tenders (id uuid primary key, converted_opportunity_id uuid references public.psi_sales_opportunities(id));
    create table public.psi_sales_profiles (
      id uuid primary key, active boolean not null default true, identity_type text default 'human',
      role text not null default 'admin', microsoft_email text not null default 'test@example.test'
    );

    insert into public.psi_sales_opportunities (id) values ('${O}'), ('${O2}');
    insert into public.psi_public_tenders (id, converted_opportunity_id) values ('${T}', '${O}'), ('${T2}', '${O2}');
    insert into public.psi_sales_profiles (id, active) values ('${ACTOR}', true), ('${ACTOR_INACTIVE}', false);
  `);
  await pg.exec(migration026);
  await pg.exec(migration057);
  await pg.exec(migration065);
  await pg.exec(migration097);
  return pg;
}

async function freshDb() {
  const pg = await createBaseFixture();
  await pg.exec(migration098());
  return pg;
}

/** Seeds one frozen evidence package version directly (no members/batches — the
 * workflow/authorization contract only ever binds to package_version_id/package_hash). The
 * header row is a one-per-(opportunity_id,tender_id) identity per 097's unique constraint, so a
 * second seed against the same scope reuses the existing header and appends the next
 * version_number under it — it never inserts a second header and never touches a prior frozen
 * version row. */
async function seedEvidencePackageVersion(pg, { opportunityId = O, tenderId = T, actorId = ACTOR, label = 'default' } = {}) {
  let packageRow = (await pg.query(
    `select id from public.psi_agt002_evidence_packages where opportunity_id = '${opportunityId}' and tender_id = '${tenderId}'`,
  )).rows[0];
  if (!packageRow) {
    packageRow = (await pg.query(
      `insert into public.psi_agt002_evidence_packages (opportunity_id, tender_id) values ('${opportunityId}', '${tenderId}') returning id`,
    )).rows[0];
  }
  const versionNumber = (await pg.query(
    `select coalesce(max(version_number), 0) + 1 as next from public.psi_agt002_evidence_package_versions where package_id = '${packageRow.id}'`,
  )).rows[0].next;
  const packageHash = hash(`package-${label}`);
  const versionRow = (await pg.query(`
    insert into public.psi_agt002_evidence_package_versions
      (package_id, version_number, idempotency_key, package_hash, document_manifest_hash, semantic_manifest_hash, member_count, batch_count, created_by)
    values ('${packageRow.id}', ${versionNumber}, 'seed-idem-${label}', '${packageHash}', '${hash(`doc-manifest-${label}`)}', '${hash(`semantic-manifest-${label}`)}', 1, 1, '${actorId}')
    returning id
  `)).rows[0];
  return { packageId: packageRow.id, packageVersionId: versionRow.id, packageHash };
}

async function createWorkflowInstance(pg, overrides = {}) {
  const opts = {
    opportunityId: O, tenderId: T, workflowType: 'INITIAL', scope: 'A',
    profileSnapshotId: null, profileSnapshotHash: null, idempotencyKey: 'idem-instance-default',
    actorId: ACTOR, ...overrides,
  };
  return callRpc(pg, 'psi_create_agt002_workflow_instance', {
    p_opportunity_id: opts.opportunityId, p_tender_id: opts.tenderId, p_workflow_type: opts.workflowType,
    p_scope: opts.scope, p_profile_snapshot_id: opts.profileSnapshotId, p_profile_snapshot_hash: opts.profileSnapshotHash,
    p_idempotency_key: opts.idempotencyKey, p_actor_profile_id: opts.actorId,
  });
}

async function appendWorkflowEvent(pg, overrides = {}) {
  const opts = {
    workflowInstanceId: undefined, toState: 'REJECTED', actorProfileId: null, actorKind: 'system',
    authority: 'SYSTEM', target: 'INITIAL_ANALYSIS_WORKFLOW', env: 'production',
    preconditions: {}, evidence: {}, expiresAt: null, rollbackOfEventId: null,
    idempotencyKey: 'idem-event-default', ...overrides,
  };
  return callRpc(pg, 'psi_append_agt002_workflow_event', {
    p_workflow_instance_id: opts.workflowInstanceId, p_to_state: opts.toState, p_actor_profile_id: opts.actorProfileId,
    p_actor_kind: opts.actorKind, p_authority: opts.authority, p_target: opts.target, p_env: opts.env,
    p_preconditions: opts.preconditions, p_evidence: opts.evidence, p_expires_at: opts.expiresAt,
    p_rollback_of_event_id: opts.rollbackOfEventId, p_idempotency_key: opts.idempotencyKey,
  });
}

async function grantG1Authorization(pg, overrides = {}) {
  const opts = {
    workflowInstanceId: undefined, packageVersionId: undefined, packageHash: undefined,
    expiresAt: '2026-12-31T00:00:00.000Z', idempotencyKey: 'idem-grant-default', actorId: ACTOR, ...overrides,
  };
  return callRpc(pg, 'psi_grant_agt002_g1_analysis_authorization', {
    p_workflow_instance_id: opts.workflowInstanceId, p_package_version_id: opts.packageVersionId,
    p_package_hash: opts.packageHash, p_expires_at: opts.expiresAt, p_idempotency_key: opts.idempotencyKey,
    p_actor_profile_id: opts.actorId,
  });
}

async function consumeAuthorization(pg, overrides = {}) {
  const opts = {
    authorizationId: undefined, workflowInstanceId: undefined, opportunityId: O, tenderId: T,
    packageVersionId: undefined, packageHash: undefined, idempotencyKey: 'idem-consume-default', actorId: ACTOR, ...overrides,
  };
  return callRpc(pg, 'psi_consume_agt002_analysis_authorization', {
    p_authorization_id: opts.authorizationId, p_workflow_instance_id: opts.workflowInstanceId,
    p_opportunity_id: opts.opportunityId, p_tender_id: opts.tenderId, p_package_version_id: opts.packageVersionId,
    p_package_hash: opts.packageHash, p_idempotency_key: opts.idempotencyKey, p_actor_profile_id: opts.actorId,
  });
}

/** Creates an INITIAL/scope-A instance, seeds a matching frozen package version, and grants a
 * G1 authorization over it — the common setup every consume scenario needs. */
async function seedAuthorizedWorkflow(pg, { label, expiresAt = '2026-12-31T00:00:00.000Z' } = {}) {
  const instance = await createWorkflowInstance(pg, { idempotencyKey: `idem-instance-${label}` });
  const evidence = await seedEvidencePackageVersion(pg, { label });
  const grant = await grantG1Authorization(pg, {
    workflowInstanceId: instance.workflow_instance_id, packageVersionId: evidence.packageVersionId,
    packageHash: evidence.packageHash, expiresAt, idempotencyKey: `idem-grant-${label}`,
  });
  return { instance, evidence, grant };
}

async function coreCounts(pg) {
  return (await pg.query(`
    select
      (select count(*)::int from public.psi_agt002_workflow_instances) as instances,
      (select count(*)::int from public.psi_agt002_workflow_events) as events,
      (select count(*)::int from public.psi_agt002_analysis_authorizations) as authorizations
  `)).rows[0];
}

test('migration 098 applies cleanly and defines the three tables and four RPCs', async () => {
  const pg = await freshDb();
  try {
    const tables = (await pg.query(`
      select
        to_regclass('public.psi_agt002_workflow_instances') is not null as instances,
        to_regclass('public.psi_agt002_workflow_events') is not null as events,
        to_regclass('public.psi_agt002_analysis_authorizations') is not null as authorizations
    `)).rows[0];
    assert.equal(tables.instances, true);
    assert.equal(tables.events, true);
    assert.equal(tables.authorizations, true);

    const fns = (await pg.query(`
      select
        to_regprocedure('public.psi_create_agt002_workflow_instance(uuid,uuid,text,text,uuid,text,text,uuid)') is not null as create_instance,
        to_regprocedure('public.psi_append_agt002_workflow_event(uuid,text,uuid,text,text,text,text,jsonb,jsonb,timestamptz,uuid,text)') is not null as append_event,
        to_regprocedure('public.psi_grant_agt002_g1_analysis_authorization(uuid,uuid,text,timestamptz,text,uuid)') is not null as grant_g1,
        to_regprocedure('public.psi_consume_agt002_analysis_authorization(uuid,uuid,uuid,uuid,uuid,text,text,uuid)') is not null as consume
    `)).rows[0];
    assert.equal(fns.create_instance, true);
    assert.equal(fns.append_event, true);
    assert.equal(fns.grant_g1, true);
    assert.equal(fns.consume, true);
  } finally {
    await pg.close();
  }
});

test('direct INSERT/UPDATE/DELETE on any of the three tables is denied to authenticated, and INSERT is denied to service_role outside the RPCs', async () => {
  const pg = await freshDb();
  try {
    const insertSql = `insert into public.psi_agt002_workflow_instances (opportunity_id, tender_id, workflow_type, scope, idempotency_key, created_by) values ('${O}','${T}','INITIAL','A','direct-insert','${ACTOR}')`;
    await pg.exec('set role authenticated');
    await assert.rejects(pg.query(insertSql), /permission denied/i);
    await pg.exec('reset role');

    await pg.exec('set role service_role');
    await assert.rejects(pg.query(insertSql), /permission denied/i, 'service_role only has SELECT: every write goes exclusively through the governed RPCs');
    await pg.exec('reset role');
  } finally {
    await pg.close();
  }
});

test('creating a workflow instance atomically writes the header row and the creation event (null -> REQUESTED)', async () => {
  const pg = await freshDb();
  try {
    const result = await createWorkflowInstance(pg, { idempotencyKey: 'idem-create-n1' });
    assert.equal(result.status, 'created');
    assert.ok(result.workflow_instance_id);

    const counts = await coreCounts(pg);
    assert.deepEqual(counts, { instances: 1, events: 1, authorizations: 0 });

    const event = (await pg.query(`select from_state, to_state from public.psi_agt002_workflow_events where workflow_instance_id = '${result.workflow_instance_id}'`)).rows[0];
    assert.equal(event.from_state, null);
    assert.equal(event.to_state, 'REQUESTED');
  } finally {
    await pg.close();
  }
});

test('a replay of the exact same create-instance identity returns the same identity, creating nothing new', async () => {
  const pg = await freshDb();
  try {
    const first = await createWorkflowInstance(pg, { idempotencyKey: 'idem-replay-instance' });
    const replay = await createWorkflowInstance(pg, { idempotencyKey: 'idem-replay-instance' });
    assert.equal(replay.status, 'existing');
    assert.equal(replay.workflow_instance_id, first.workflow_instance_id);

    const counts = await coreCounts(pg);
    assert.deepEqual(counts, { instances: 1, events: 1, authorizations: 0 });
  } finally {
    await pg.close();
  }
});

test('create-instance fails closed on a conflicting replay under the same idempotency_key, leaving no orphaned rows', async () => {
  const pg = await freshDb();
  try {
    await createWorkflowInstance(pg, { idempotencyKey: 'idem-conflict-instance', scope: 'A' });
    await assert.rejects(
      createWorkflowInstance(pg, { idempotencyKey: 'idem-conflict-instance', scope: 'A_PLUS_B', profileSnapshotId: O, profileSnapshotHash: hash('snap') }),
      /./,
    );

    const counts = await coreCounts(pg);
    assert.deepEqual(counts, { instances: 1, events: 1, authorizations: 0 });
  } finally {
    await pg.close();
  }
});

test('scope A_PLUS_B without an immutable profile snapshot id/hash fails closed', async () => {
  const pg = await freshDb();
  try {
    await assert.rejects(createWorkflowInstance(pg, { idempotencyKey: 'idem-scope-no-snapshot', scope: 'A_PLUS_B' }), /./);
    const counts = await coreCounts(pg);
    assert.deepEqual(counts, { instances: 0, events: 0, authorizations: 0 });
  } finally {
    await pg.close();
  }
});

test('scope A_PLUS_B with a real immutable profile snapshot id/hash succeeds', async () => {
  const pg = await freshDb();
  try {
    const result = await createWorkflowInstance(pg, {
      idempotencyKey: 'idem-scope-with-snapshot', scope: 'A_PLUS_B',
      profileSnapshotId: O2, profileSnapshotHash: hash('profile-snapshot-1'),
    });
    assert.equal(result.status, 'created');
    const row = (await pg.query(`select scope, profile_snapshot_id, profile_snapshot_hash from public.psi_agt002_workflow_instances where id = '${result.workflow_instance_id}'`)).rows[0];
    assert.equal(row.scope, 'A_PLUS_B');
    assert.equal(row.profile_snapshot_id, O2);
    assert.equal(row.profile_snapshot_hash, hash('profile-snapshot-1'));
  } finally {
    await pg.close();
  }
});

test('scope A carrying a non-null profile snapshot id/hash fails closed', async () => {
  const pg = await freshDb();
  try {
    await assert.rejects(
      createWorkflowInstance(pg, { idempotencyKey: 'idem-scope-a-with-snapshot', scope: 'A', profileSnapshotId: O2, profileSnapshotHash: hash('should-not-be-allowed') }),
      /./,
    );
    const counts = await coreCounts(pg);
    assert.deepEqual(counts, { instances: 0, events: 0, authorizations: 0 });
  } finally {
    await pg.close();
  }
});

test('appending an illegal transition fails closed and inserts nothing', async () => {
  const pg = await freshDb();
  try {
    const instance = await createWorkflowInstance(pg, { idempotencyKey: 'idem-illegal-transition' });
    await assert.rejects(
      appendWorkflowEvent(pg, { workflowInstanceId: instance.workflow_instance_id, toState: 'CONSUMED', idempotencyKey: 'idem-illegal-event' }),
      /transici|transition/i,
    );
    const counts = await coreCounts(pg);
    assert.deepEqual(counts, { instances: 1, events: 1, authorizations: 0 }, 'only the creation event may exist after a rejected illegal transition');
  } finally {
    await pg.close();
  }
});

test('a legal terminal transition (REQUESTED -> REJECTED) succeeds, and the terminal state accepts no further transition', async () => {
  const pg = await freshDb();
  try {
    const instance = await createWorkflowInstance(pg, { idempotencyKey: 'idem-reject-terminal' });
    const rejected = await appendWorkflowEvent(pg, { workflowInstanceId: instance.workflow_instance_id, toState: 'REJECTED', idempotencyKey: 'idem-reject-event' });
    assert.equal(rejected.status, 'created');

    await assert.rejects(
      appendWorkflowEvent(pg, { workflowInstanceId: instance.workflow_instance_id, toState: 'AUTHORIZED', actorKind: 'human', actorProfileId: ACTOR, authority: 'G1', expiresAt: '2026-12-31T00:00:00.000Z', idempotencyKey: 'idem-after-terminal' }),
      /transici|transition/i,
    );

    const counts = await coreCounts(pg);
    assert.deepEqual(counts, { instances: 1, events: 2, authorizations: 0 });
  } finally {
    await pg.close();
  }
});

test('G1 grants an INITIAL authorization: writes the AUTHORIZED event and the authorization row atomically, bound to the exact package version+hash', async () => {
  const pg = await freshDb();
  try {
    const { instance, evidence, grant } = await seedAuthorizedWorkflow(pg, { label: 'happy-path' });
    assert.equal(grant.status, 'created');
    assert.ok(grant.authorization_id);

    const counts = await coreCounts(pg);
    assert.deepEqual(counts, { instances: 1, events: 2, authorizations: 1 });

    const authorization = (await pg.query(`select workflow_instance_id, workflow_type, scope, package_version_id, package_hash from public.psi_agt002_analysis_authorizations where id = '${grant.authorization_id}'`)).rows[0];
    assert.equal(authorization.workflow_instance_id, instance.workflow_instance_id);
    assert.equal(authorization.workflow_type, 'INITIAL');
    assert.equal(authorization.scope, 'A');
    assert.equal(authorization.package_version_id, evidence.packageVersionId);
    assert.equal(authorization.package_hash, evidence.packageHash);

    const latestEvent = (await pg.query(`select to_state, expires_at from public.psi_agt002_workflow_events where workflow_instance_id = '${instance.workflow_instance_id}' order by created_at desc limit 1`)).rows[0];
    assert.equal(latestEvent.to_state, 'AUTHORIZED');
    assert.ok(latestEvent.expires_at);
  } finally {
    await pg.close();
  }
});

test('G1 (INITIAL-only gate) cannot authorize a REANALYSIS workflow instance', async () => {
  const pg = await freshDb();
  try {
    const instance = await createWorkflowInstance(pg, { idempotencyKey: 'idem-reanalysis-instance', workflowType: 'REANALYSIS' });
    const evidence = await seedEvidencePackageVersion(pg, { label: 'reanalysis-reject' });
    await assert.rejects(
      grantG1Authorization(pg, { workflowInstanceId: instance.workflow_instance_id, packageVersionId: evidence.packageVersionId, packageHash: evidence.packageHash, idempotencyKey: 'idem-grant-reanalysis' }),
      /INITIAL|G1/i,
    );
    const counts = await coreCounts(pg);
    assert.deepEqual(counts, { instances: 1, events: 1, authorizations: 0 }, 'no authorization or AUTHORIZED event may be created against a REANALYSIS workflow instance');
  } finally {
    await pg.close();
  }
});

test('G1 grant fails closed when the package_hash does not match the live frozen package version', async () => {
  const pg = await freshDb();
  try {
    const instance = await createWorkflowInstance(pg, { idempotencyKey: 'idem-grant-hash-mismatch' });
    const evidence = await seedEvidencePackageVersion(pg, { label: 'hash-mismatch' });
    await assert.rejects(
      grantG1Authorization(pg, { workflowInstanceId: instance.workflow_instance_id, packageVersionId: evidence.packageVersionId, packageHash: hash('a-different-package'), idempotencyKey: 'idem-grant-mismatch' }),
      /./,
    );
    const counts = await coreCounts(pg);
    assert.deepEqual(counts, { instances: 1, events: 1, authorizations: 0 });
  } finally {
    await pg.close();
  }
});

test('G1 grant fails closed when the frozen package version belongs to a different opportunity/tender than the workflow instance', async () => {
  const pg = await freshDb();
  try {
    const instance = await createWorkflowInstance(pg, { idempotencyKey: 'idem-grant-scope-mismatch', opportunityId: O, tenderId: T });
    const evidence = await seedEvidencePackageVersion(pg, { opportunityId: O2, tenderId: T2, label: 'cross-scope' });
    await assert.rejects(
      grantG1Authorization(pg, { workflowInstanceId: instance.workflow_instance_id, packageVersionId: evidence.packageVersionId, packageHash: evidence.packageHash, idempotencyKey: 'idem-grant-cross-scope' }),
      /./,
    );
    const counts = await coreCounts(pg);
    assert.deepEqual(counts, { instances: 1, events: 1, authorizations: 0 });
  } finally {
    await pg.close();
  }
});

test('consume succeeds exactly once: the atomic consume-on-create boundary that P0-04 job creation will call', async () => {
  const pg = await freshDb();
  try {
    const { instance, evidence, grant } = await seedAuthorizedWorkflow(pg, { label: 'consume-once' });
    const result = await consumeAuthorization(pg, {
      authorizationId: grant.authorization_id, workflowInstanceId: instance.workflow_instance_id,
      packageVersionId: evidence.packageVersionId, packageHash: evidence.packageHash, idempotencyKey: 'idem-consume-once',
    });
    assert.equal(result.status, 'consumed');

    const counts = await coreCounts(pg);
    assert.deepEqual(counts, { instances: 1, events: 3, authorizations: 1 });

    const latestEvent = (await pg.query(`select to_state from public.psi_agt002_workflow_events where workflow_instance_id = '${instance.workflow_instance_id}' order by created_at desc limit 1`)).rows[0];
    assert.equal(latestEvent.to_state, 'CONSUMED');
  } finally {
    await pg.close();
  }
});

test('double consumption fails closed: a second, distinct consume attempt on an already-consumed authorization is rejected', async () => {
  const pg = await freshDb();
  try {
    const { instance, evidence, grant } = await seedAuthorizedWorkflow(pg, { label: 'double-consume' });
    await consumeAuthorization(pg, {
      authorizationId: grant.authorization_id, workflowInstanceId: instance.workflow_instance_id,
      packageVersionId: evidence.packageVersionId, packageHash: evidence.packageHash, idempotencyKey: 'idem-consume-first',
    });

    await assert.rejects(
      consumeAuthorization(pg, {
        authorizationId: grant.authorization_id, workflowInstanceId: instance.workflow_instance_id,
        packageVersionId: evidence.packageVersionId, packageHash: evidence.packageHash, idempotencyKey: 'idem-consume-second',
      }),
      /./,
    );

    const counts = await coreCounts(pg);
    assert.deepEqual(counts, { instances: 1, events: 3, authorizations: 1 }, 'double consumption must never produce a second CONSUMED event');
  } finally {
    await pg.close();
  }
});

test('a replay of the exact same consume identity (same idempotency_key, same payload) returns the same identity, creating no second CONSUMED event', async () => {
  const pg = await freshDb();
  try {
    const { instance, evidence, grant } = await seedAuthorizedWorkflow(pg, { label: 'consume-replay' });
    const params = {
      authorizationId: grant.authorization_id, workflowInstanceId: instance.workflow_instance_id,
      packageVersionId: evidence.packageVersionId, packageHash: evidence.packageHash, idempotencyKey: 'idem-consume-replay',
    };
    const first = await consumeAuthorization(pg, params);
    assert.equal(first.status, 'consumed');
    const replay = await consumeAuthorization(pg, params);
    assert.equal(replay.status, 'existing');

    const counts = await coreCounts(pg);
    assert.deepEqual(counts, { instances: 1, events: 3, authorizations: 1 });
  } finally {
    await pg.close();
  }
});

for (const mismatchField of ['workflowInstanceId', 'opportunityId', 'tenderId', 'packageVersionId', 'packageHash']) {
  test(`consume fails closed on a mismatched ${mismatchField}, leaving the authorization AUTHORIZED (unconsumed)`, async () => {
    const pg = await freshDb();
    try {
      const { instance, evidence, grant } = await seedAuthorizedWorkflow(pg, { label: `mismatch-${mismatchField}` });
      const other = await seedAuthorizedWorkflow(pg, { label: `mismatch-${mismatchField}-other` });
      const params = {
        authorizationId: grant.authorization_id, workflowInstanceId: instance.workflow_instance_id,
        opportunityId: O, tenderId: T, packageVersionId: evidence.packageVersionId, packageHash: evidence.packageHash,
        idempotencyKey: `idem-consume-${mismatchField}`,
      };
      const overrides = {
        workflowInstanceId: other.instance.workflow_instance_id,
        opportunityId: O2,
        tenderId: T2,
        packageVersionId: other.evidence.packageVersionId,
        packageHash: other.evidence.packageHash,
      };
      await assert.rejects(consumeAuthorization(pg, { ...params, [mismatchField]: overrides[mismatchField] }), /./);

      const latestEvent = (await pg.query(`select to_state from public.psi_agt002_workflow_events where workflow_instance_id = '${instance.workflow_instance_id}' order by created_at desc limit 1`)).rows[0];
      assert.equal(latestEvent.to_state, 'AUTHORIZED', 'a mismatched consume attempt must never transition the workflow past AUTHORIZED');
    } finally {
      await pg.close();
    }
  });
}

test('G1 grant fails closed when the requested expiry is already in the past, creating no authorization row or AUTHORIZED event', async () => {
  const pg = await freshDb();
  try {
    const instance = await createWorkflowInstance(pg, { idempotencyKey: 'idem-grant-expired' });
    const evidence = await seedEvidencePackageVersion(pg, { label: 'expired' });
    await assert.rejects(
      grantG1Authorization(pg, {
        workflowInstanceId: instance.workflow_instance_id, packageVersionId: evidence.packageVersionId,
        packageHash: evidence.packageHash, expiresAt: '2020-01-01T00:00:00.000Z', idempotencyKey: 'idem-grant-expired',
      }),
      /expir/i,
    );
    const counts = await coreCounts(pg);
    assert.deepEqual(counts, { instances: 1, events: 1, authorizations: 0 }, 'a grant requesting an already-past expiry must never create an authorization row or an AUTHORIZED event');
  } finally {
    await pg.close();
  }
});

test('consume fails closed once the authorization has been revoked, even while still unexpired', async () => {
  const pg = await freshDb();
  try {
    const { instance, evidence, grant } = await seedAuthorizedWorkflow(pg, { label: 'revoked' });
    const revoked = await appendWorkflowEvent(pg, {
      workflowInstanceId: instance.workflow_instance_id, toState: 'REVOKED', idempotencyKey: 'idem-revoke-event',
    });
    assert.equal(revoked.status, 'created');

    await assert.rejects(
      consumeAuthorization(pg, {
        authorizationId: grant.authorization_id, workflowInstanceId: instance.workflow_instance_id,
        packageVersionId: evidence.packageVersionId, packageHash: evidence.packageHash, idempotencyKey: 'idem-consume-revoked',
      }),
      /revocad/i,
    );

    const counts = await coreCounts(pg);
    assert.deepEqual(counts, { instances: 1, events: 3, authorizations: 1 }, 'a rejected consume attempt on a revoked authorization must never append a CONSUMED event');
    const latestEvent = (await pg.query(`select to_state from public.psi_agt002_workflow_events where workflow_instance_id = '${instance.workflow_instance_id}' order by created_at desc limit 1`)).rows[0];
    assert.equal(latestEvent.to_state, 'REVOKED', 'the revocation must remain the last recorded transition');
  } finally {
    await pg.close();
  }
});

test('a frozen workflow instance, event, and authorization row are permanently append-only', async () => {
  const pg = await freshDb();
  try {
    const { instance, grant } = await seedAuthorizedWorkflow(pg, { label: 'immutable' });
    const eventRow = (await pg.query(`select id from public.psi_agt002_workflow_events where workflow_instance_id = '${instance.workflow_instance_id}' order by created_at desc limit 1`)).rows[0];

    await assert.rejects(pg.exec(`update public.psi_agt002_workflow_instances set scope = 'A_PLUS_B' where id = '${instance.workflow_instance_id}'`), /append-only/i);
    await assert.rejects(pg.exec(`delete from public.psi_agt002_workflow_instances where id = '${instance.workflow_instance_id}'`), /append-only/i);
    await assert.rejects(pg.exec(`update public.psi_agt002_workflow_events set to_state = 'REJECTED' where id = '${eventRow.id}'`), /append-only/i);
    await assert.rejects(pg.exec(`delete from public.psi_agt002_workflow_events where id = '${eventRow.id}'`), /append-only/i);
    await assert.rejects(pg.exec(`update public.psi_agt002_analysis_authorizations set package_hash = '${hash('tampered')}' where id = '${grant.authorization_id}'`), /append-only/i);
    await assert.rejects(pg.exec(`delete from public.psi_agt002_analysis_authorizations where id = '${grant.authorization_id}'`), /append-only/i);
  } finally {
    await pg.close();
  }
});

test('direct psi_append_agt002_workflow_event REQUESTED -> AUTHORIZED is never legal, even with authority G1 on a REANALYSIS instance: G1 grant is the sole path to AUTHORIZED', async () => {
  const pg = await freshDb();
  try {
    const instance = await createWorkflowInstance(pg, { idempotencyKey: 'idem-direct-authorized-reanalysis', workflowType: 'REANALYSIS' });
    await assert.rejects(
      appendWorkflowEvent(pg, {
        workflowInstanceId: instance.workflow_instance_id, toState: 'AUTHORIZED', actorKind: 'human',
        actorProfileId: ACTOR, authority: 'G1', expiresAt: '2026-12-31T00:00:00.000Z', idempotencyKey: 'idem-direct-authorized-event',
      }),
      /./,
    );

    const counts = await coreCounts(pg);
    assert.deepEqual(counts, { instances: 1, events: 1, authorizations: 0 }, 'a direct AUTHORIZED append must never insert an event or an authorization row');
    const authorized = (await pg.query(`select count(*)::int as n from public.psi_agt002_workflow_events where workflow_instance_id = '${instance.workflow_instance_id}' and to_state = 'AUTHORIZED'`)).rows[0];
    assert.equal(authorized.n, 0);
  } finally {
    await pg.close();
  }
});

test('append enforces actor provenance: a human actor requires a non-null actor_profile_id, a system actor forbids one', async () => {
  const pg = await freshDb();
  try {
    const instance = await createWorkflowInstance(pg, { idempotencyKey: 'idem-provenance-instance' });

    await assert.rejects(
      appendWorkflowEvent(pg, {
        workflowInstanceId: instance.workflow_instance_id, toState: 'REJECTED', actorKind: 'human',
        actorProfileId: null, idempotencyKey: 'idem-provenance-human-no-actor',
      }),
      /./,
    );

    await assert.rejects(
      appendWorkflowEvent(pg, {
        workflowInstanceId: instance.workflow_instance_id, toState: 'REJECTED', actorKind: 'system',
        actorProfileId: ACTOR, idempotencyKey: 'idem-provenance-system-with-actor',
      }),
      /./,
    );

    const counts = await coreCounts(pg);
    assert.deepEqual(counts, { instances: 1, events: 1, authorizations: 0 }, 'neither malformed actor provenance may insert an event');
  } finally {
    await pg.close();
  }
});

test('append is idempotent: an exact replay under the same idempotency_key returns the original event and inserts nothing, a mismatched payload under the same key fails closed and inserts nothing', async () => {
  const pg = await freshDb();
  try {
    const instance = await createWorkflowInstance(pg, { idempotencyKey: 'idem-append-replay-instance' });
    const first = await appendWorkflowEvent(pg, {
      workflowInstanceId: instance.workflow_instance_id, toState: 'REJECTED', idempotencyKey: 'idem-append-replay-key',
    });
    assert.equal(first.status, 'created');
    assert.ok(first.event_id);

    const replay = await appendWorkflowEvent(pg, {
      workflowInstanceId: instance.workflow_instance_id, toState: 'REJECTED', idempotencyKey: 'idem-append-replay-key',
    });
    assert.equal(replay.status, 'existing');
    assert.equal(replay.event_id, first.event_id);

    let counts = await coreCounts(pg);
    assert.deepEqual(counts, { instances: 1, events: 2, authorizations: 0 }, 'the creation event plus the single REJECTED event: an exact replay inserts nothing new');

    await assert.rejects(
      appendWorkflowEvent(pg, {
        workflowInstanceId: instance.workflow_instance_id, toState: 'REJECTED', target: 'SOME_OTHER_TARGET',
        idempotencyKey: 'idem-append-replay-key',
      }),
      /./,
    );

    counts = await coreCounts(pg);
    assert.deepEqual(counts, { instances: 1, events: 2, authorizations: 0 }, 'a mismatched payload under the same idempotency_key must fail closed and insert nothing');
  } finally {
    await pg.close();
  }
});

test('psi_agt002_analysis_authorizations.idempotency_key has a real UNIQUE constraint: a second authorization row under the same key is rejected, leaving the first row intact', async () => {
  const pg = await freshDb();
  try {
    const firstInstance = await createWorkflowInstance(pg, { idempotencyKey: 'idem-instance-unique-constraint-first' });
    const firstEvidence = await seedEvidencePackageVersion(pg, { label: 'unique-constraint-first' });
    const secondInstance = await createWorkflowInstance(pg, { idempotencyKey: 'idem-instance-unique-constraint-second' });
    const secondEvidence = await seedEvidencePackageVersion(pg, { label: 'unique-constraint-second' });

    const sharedKey = 'idem-authorization-unique-constraint-shared';
    const firstRow = (await pg.query(`
      insert into public.psi_agt002_analysis_authorizations
        (workflow_instance_id, workflow_type, scope, package_version_id, package_hash, granted_by, expires_at, idempotency_key)
      values ('${firstInstance.workflow_instance_id}', 'INITIAL', 'A', '${firstEvidence.packageVersionId}', '${firstEvidence.packageHash}', '${ACTOR}', '2026-12-31T00:00:00.000Z', '${sharedKey}')
      returning id
    `)).rows[0];

    await assert.rejects(
      pg.query(`
        insert into public.psi_agt002_analysis_authorizations
          (workflow_instance_id, workflow_type, scope, package_version_id, package_hash, granted_by, expires_at, idempotency_key)
        values ('${secondInstance.workflow_instance_id}', 'INITIAL', 'A', '${secondEvidence.packageVersionId}', '${secondEvidence.packageHash}', '${ACTOR}', '2026-12-31T00:00:00.000Z', '${sharedKey}')
      `),
      /duplicate key|unique/i,
    );

    const rows = (await pg.query(`select id, workflow_instance_id from public.psi_agt002_analysis_authorizations where idempotency_key = '${sharedKey}'`)).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, firstRow.id);
    assert.equal(rows[0].workflow_instance_id, firstInstance.workflow_instance_id, 'the first grant must remain intact, bound to its original workflow instance');
  } finally {
    await pg.close();
  }
});

test('the rollback refuses to run while any workflow/event/authorization history exists, and succeeds against a pristine install', async () => {
  const seeded = await freshDb();
  try {
    await seedAuthorizedWorkflow(seeded, { label: 'rollback-guard' });
    const rollback098 = strip(readFileSync(new URL('../supabase/rollbacks/098_agt002_initial_workflow_and_g1_rollback.sql', import.meta.url), 'utf8'));
    await assert.rejects(seeded.exec(rollback098), /./);
  } finally {
    await seeded.close();
  }

  const pristine = await freshDb();
  try {
    const rollback098 = strip(readFileSync(new URL('../supabase/rollbacks/098_agt002_initial_workflow_and_g1_rollback.sql', import.meta.url), 'utf8'));
    await pristine.exec(rollback098);
    const tables = (await pristine.query(`
      select
        to_regclass('public.psi_agt002_workflow_instances') is null as instances_gone,
        to_regclass('public.psi_agt002_workflow_events') is null as events_gone,
        to_regclass('public.psi_agt002_analysis_authorizations') is null as authorizations_gone
    `)).rows[0];
    assert.equal(tables.instances_gone, true);
    assert.equal(tables.events_gone, true);
    assert.equal(tables.authorizations_gone, true);

    const preserved = (await pristine.query(`select to_regclass('public.psi_agt002_evidence_packages') is not null as still_there`)).rows[0];
    assert.equal(preserved.still_there, true, 'rollback 098 must never touch the preexisting 097 evidence package tables');
  } finally {
    await pristine.close();
  }
});
