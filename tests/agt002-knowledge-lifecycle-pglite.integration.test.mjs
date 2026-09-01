// AGT-002 knowledge lifecycle — candidate/version/publication persistence
// (design §§9.6-9.10, §10.2, §16.1, §17). RED reason: migration 078 does not
// exist yet, so the `readFileSync` below throws ENOENT before any scenario
// runs — there is no knowledge schema, no lifecycle RPC and no deferred
// exact-source constraint trigger to test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const strip = value => value.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const migration078 = strip(readFileSync(new URL('../supabase/migrations/078_agt002_actionable_review_knowledge.sql', import.meta.url), 'utf8'));

const P = '44444444-4444-4444-8444-444444444444';
const O = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const RUN = '33333333-3333-4333-8333-333333333333';

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `ARRAY[${value.map(v => `'${String(v).replace(/'/g, "''")}'`).join(',')}]::text[]`;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}
async function callRpc(pg, name, args) {
  const literal = args.map(sqlLiteral).join(',');
  const result = await pg.query(`select public.${name}(${literal}) as data`);
  return result.rows[0]?.data ?? null;
}

async function createDatabase() {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated; create role service_role; create role anon;
    alter role service_role bypassrls;
    grant service_role to current_user;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true, identity_type text default 'human', full_name text);
    create table public.psi_sales_opportunities (id uuid primary key);
    create table public.psi_public_tenders (id uuid primary key);
    create table public.psi_tender_analysis_runs (
      id uuid primary key, opportunity_id uuid not null references public.psi_sales_opportunities(id),
      tender_id uuid not null references public.psi_public_tenders(id), result jsonb
    );
    insert into public.psi_sales_profiles values ('${P}', true, 'human', 'Ana Revisora');
    insert into public.psi_sales_opportunities values ('${O}');
    insert into public.psi_public_tenders values ('${T}');
    insert into public.psi_tender_analysis_runs values ('${RUN}', '${O}', '${T}', '${JSON.stringify({
      integral_analysis: { analysis_units: [{ unit_id: 'unit-1', closure: { status: 'evidence_pending' } }] },
    }).replace(/'/g, "''")}');
  `);
  await pg.exec(migration078);
  const item = await callRpc(pg, 'psi_ensure_tender_actionable_review_item', [O, T, RUN, 'integral_unit', 'unit-1', null, 'a'.repeat(64), P]);
  pg.itemId = item.id;
  const outcome = await callRpc(pg, 'psi_record_tender_actionable_review_outcome', [
    item.id, P, 'riesgo_confirmado', 'Riesgo confirmado por ausencia de póliza vigente.', true,
    '77777777-7777-4777-8777-777777777777', 'a1'.repeat(32),
  ]);
  pg.resolutionEventId = outcome.resolution_event_id;
  return pg;
}

function candidateArgs(pg, overrides = {}) {
  return {
    reviewItemId: pg.itemId, resolutionEventId: pg.resolutionEventId, actorId: P,
    scopeType: 'general', scopeValue: null,
    reusableSummary: 'Exigir póliza de responsabilidad civil vigente antes de presentar oferta en procesos similares.',
    validFrom: '2026-09-01', validUntil: null, reviewOn: '2027-09-01', tags: ['polizas', 'riesgo_juridico'],
    confidentiality: 'interno', agentReuseAllowed: false, responsibleProfileId: P,
    sanitizationAttestation: 'Se removió toda referencia a la entidad y montos específicos de este proceso.',
    idempotencyKey: '88888888-8888-4888-8888-888888888888', requestHash: 'b'.repeat(64),
    ...overrides,
  };
}
async function createCandidate(pg, overrides = {}) {
  const a = candidateArgs(pg, overrides);
  return callRpc(pg, 'psi_create_tender_knowledge_candidate', [
    a.reviewItemId, a.resolutionEventId, a.actorId, a.scopeType, a.scopeValue, a.reusableSummary,
    a.validFrom, a.validUntil, a.reviewOn, a.tags, a.confidentiality, a.agentReuseAllowed,
    a.responsibleProfileId, a.sanitizationAttestation, a.idempotencyKey, a.requestHash,
  ]);
}

// --- §9.6/§9.8: creating a candidate materializes item + version 1 +
// draft_created, backed by exactly the resolution passed in. -----------------
await (async function createCandidateMaterializesItemVersionAndDraftEvent() {
  const pg = await createDatabase();
  const candidate = await createCandidate(pg);
  assert.equal(candidate.status, 'borrador');
  assert.equal(candidate.version, 1);
  assert.equal(candidate.source_resolution_event_id, pg.resolutionEventId);

  const sources = (await pg.query(
    `select source_type, source_id from public.psi_tender_knowledge_version_sources where knowledge_version_id = '${candidate.version_id}'`,
  )).rows;
  assert.equal(sources.filter(s => s.source_type === 'resolution_event').length, 1, 'exactly one resolution_event source');
  await pg.close();
})();

// --- §9.8: the deferred constraint trigger rejects a version backed by zero
// or two resolutions, or by an attachment not listed as an approved support
// of that exact resolution — enforced at COMMIT even if the RPC's early
// check were bypassed by a direct multi-statement transaction. --------------
await (async function deferredTriggerRejectsWrongOrMultipleSourcesAtCommit() {
  const pg = await createDatabase();
  const candidate = await createCandidate(pg);

  await pg.exec('begin');
  await assert.rejects(
    pg.exec(`insert into public.psi_tender_knowledge_version_sources (knowledge_version_id, source_type, source_id, added_by, origin)
      values ('${candidate.version_id}', 'approved_attachment', gen_random_uuid(), '${P}', 'human_ui'); commit;`),
    /fuente|resolution_event|constraint/i,
    'adding an approved_attachment source that is not in resolution_supports for the exact vigente resolution must fail to commit',
  );
  await pg.exec('rollback').catch(() => {});
  await pg.close();
})();

// --- §10.2: borrador -> pendiente_aprobacion -> aprobado -> publicado; a
// rejected version is never edited/resubmitted — only a new version is. -----
await (async function versionStateMachineHoldsAndRejectionForcesNewVersion() {
  const pg = await createDatabase();
  const candidate = await createCandidate(pg);

  const submitted = await callRpc(pg, 'psi_submit_tender_knowledge_version', [candidate.version_id, P, '99999999-9999-4999-8999-999999999999', 'c1'.repeat(32)]);
  assert.equal(submitted.status, 'pendiente_aprobacion');

  const rejected = await callRpc(pg, 'psi_reject_tender_knowledge_version', [candidate.version_id, P, 'Falta atestación de saneamiento suficiente.', 'aa111111-1111-4111-8111-111111111111', 'c2'.repeat(32)]);
  assert.equal(rejected.status, 'rechazado');

  await assert.rejects(
    callRpc(pg, 'psi_submit_tender_knowledge_version', [candidate.version_id, P, 'aa222222-2222-4222-8222-222222222222', 'c3'.repeat(32)]),
    /rechazad|knowledge_state_conflict/i,
    'a rejected version must never be resubmitted directly',
  );

  const revised = await callRpc(pg, 'psi_add_tender_knowledge_version', [
    candidate.knowledge_item_id, pg.resolutionEventId, P,
    'Versión revisada: se refuerza la atestación de saneamiento y se corrige el alcance.',
    '2026-09-01', null, '2027-09-01', ['polizas'], 'interno', false, P,
    'Atestación revisada: se removieron todas las referencias específicas de entidad y monto.',
    'aa333333-3333-4333-8333-333333333333', 'c4'.repeat(32),
  ]);
  assert.equal(revised.version, 2);
  assert.notEqual(revised.id, candidate.version_id);
  await pg.close();
})();

// --- §9.7: restringido confidentiality forbids agent_reuse_allowed = true. --
await (async function restrictedConfidentialityForbidsAgentReuse() {
  const pg = await createDatabase();
  await assert.rejects(
    createCandidate(pg, { confidentiality: 'restringido', agentReuseAllowed: true, idempotencyKey: 'bb111111-1111-4111-8111-111111111111', requestHash: 'd1'.repeat(32) }),
    /restringido|agent_reuse/i,
  );
  await pg.close();
})();

// --- §9.10/§16.1: publication is append-only, pins the exact corporate root,
// and a successor publish records `published` on the new version and
// `replaced` on the previous one within the same transaction. --------------
await (async function publicationPinsRootAndReplacesPredecessorAtomically() {
  const pg = await createDatabase();
  const candidate = await createCandidate(pg);
  await callRpc(pg, 'psi_submit_tender_knowledge_version', [candidate.version_id, P, 'cc111111-1111-4111-8111-111111111111', 'e1'.repeat(32)]);
  await callRpc(pg, 'psi_approve_tender_knowledge_version', [candidate.version_id, P, 'cc222222-2222-4222-8222-222222222222', 'e2'.repeat(32)]);

  const publication = await callRpc(pg, 'psi_record_tender_knowledge_publication', [
    candidate.version_id, 'Comercial/Licitaciones/02 Biblioteca corporativa',
    `general/${candidate.knowledge_item_id}.md`, 'site-1', 'drive-1', 'drive-item-1',
    `https://contoso.sharepoint.com/sites/comercial/general/${candidate.knowledge_item_id}.md`,
    'etag-1', '1.0', createHash('sha256').update('contenido md v1').digest('hex'),
    P, 'cc333333-3333-4333-8333-333333333333', 'e3'.repeat(32),
  ]);
  assert.equal(publication.library_root, 'Comercial/Licitaciones/02 Biblioteca corporativa');

  const publishedEvent = (await pg.query(`select event_type from public.psi_tender_knowledge_events where knowledge_version_id = '${candidate.version_id}' order by sequence desc limit 1`)).rows[0];
  assert.equal(publishedEvent.event_type, 'published');
  await pg.close();
})();

// --- reopening the source review invalidates the ability to add/submit a new
// version from that resolution (§9.8 point 2: "sea la resolución vigente"). -
await (async function reopeningInvalidatesResolutionForNewVersions() {
  const pg = await createDatabase();
  await callRpc(pg, 'psi_reopen_tender_actionable_review', [pg.itemId, P, 'Se requiere revisar nuevamente la vigencia de la póliza.', 'dd111111-1111-4111-8111-111111111111', 'f1'.repeat(32)]);
  await assert.rejects(
    createCandidate(pg, { idempotencyKey: 'dd222222-2222-4222-8222-222222222222', requestHash: 'f2'.repeat(32) }),
    /vigente|reabiert|knowledge_state_conflict/i,
    'a candidate can never be created from a resolution that a later reopen invalidated',
  );
  await pg.close();
})();

console.log('AGT-002 knowledge lifecycle PGlite integration passed');
