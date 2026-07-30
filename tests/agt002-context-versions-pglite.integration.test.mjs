import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { registerAgt002ContextVersion } from '../tender-analysis-foundation.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';

const strip = value => value.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const migration050 = strip(readFileSync(new URL('../supabase/migrations/050_agt002_canonical_analysis.sql', import.meta.url), 'utf8'));
const migration038 = strip(readFileSync(new URL('../supabase/migrations/038_tender_question_responses.sql', import.meta.url), 'utf8'));
const migration051 = strip(readFileSync(new URL('../supabase/migrations/051_agt002_context_versions.sql', import.meta.url), 'utf8'));
const rollback051 = strip(readFileSync(new URL('../supabase/rollbacks/051_agt002_context_versions_rollback.sql', import.meta.url), 'utf8'));

const O = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const S = '33333333-3333-4333-8333-333333333333';
const P = '44444444-4444-4444-8444-444444444444';

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

// A minimal supabase-rpc-shaped shim over a raw PGlite connection: enough for the
// exported tender-analysis-foundation.js functions to run their real code path,
// including jsonb/uuid argument literals (bind params are unreliable across the
// pglite wire protocol for jsonb function arguments).
function pgliteDatabase(db) {
  return {
    rpc: async (name, params = {}) => {
      const args = Object.values(params).map(sqlLiteral).join(',');
      try {
        const result = await db.query(`select public.${name}(${args}) as data`);
        return { data: result.rows[0]?.data ?? null, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
  };
}

const pg = new PGlite();
await pg.exec(`
  create role authenticated; create role service_role; create role anon;
  create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true, identity_type text default 'human', full_name text);
  create table public.psi_sales_opportunities (id uuid primary key);
  create table public.psi_public_tenders (id uuid primary key);
  create table public.psi_tender_document_snapshots (id uuid primary key, opportunity_id uuid not null references public.psi_sales_opportunities(id), tender_id uuid not null references public.psi_public_tenders(id));
  create table public.psi_tender_analysis_runs (
    id uuid primary key default gen_random_uuid(), snapshot_id uuid not null references public.psi_tender_document_snapshots(id),
    opportunity_id uuid not null references public.psi_sales_opportunities(id), tender_id uuid not null references public.psi_public_tenders(id),
    producer text not null, method text not null, status text not null, result jsonb, critical_open_count integer not null default 0,
    idempotency_key text not null unique, schema_version text not null, policy_version text not null, model text, usage jsonb,
    created_at timestamptz not null default now(), completed_at timestamptz
  );
  insert into public.psi_sales_profiles values ('${P}', true, 'human', 'Ana Revisora');
  insert into public.psi_sales_opportunities values ('${O}');
  insert into public.psi_public_tenders values ('${T}');
  insert into public.psi_tender_document_snapshots values ('${S}','${O}','${T}');
  insert into public.psi_tender_analysis_runs (snapshot_id,opportunity_id,tender_id,producer,method,status,result,idempotency_key,schema_version,policy_version,completed_at)
  values ('${S}','${O}','${T}','siio_rules_v1','rules','completed','{"summary":"histórico"}','legacy','legacy','legacy',now());
`);
await pg.exec(migration050);
await pg.exec(migration038);
await pg.exec(migration051);

const database = pgliteDatabase(pg);

async function answerQuestion(questionId, questionText, response, analysisRunId) {
  return (await pg.query(`select public.psi_record_tender_question_response(
    '${O}','${analysisRunId}','${questionId}','${questionText}','resolved','${response}',null,'${P}'
  ) r`)).rows[0].r;
}

function contextSections(legalName) {
  return {
    ...buildAgt002OpportunityContextV2({
      opportunity: { id: 'opp-1', owner_id: 'owner-1', owner_name: 'Ana', updated_at: '2026-07-29T10:00:00.000Z' },
      tender: { id: 'tender-1', title: 'Vigilancia', entity: 'Entidad', source: 'SECOP II', updated_at: '2026-07-29T10:00:00.000Z' },
    }),
    company_dossier: buildAgt002CompanyDossier({
      profile: { legal_name: legalName, updated_at: '2026-07-29T10:00:00.000Z' },
      documents: [],
    }),
  };
}

// Since 051, every new canonical run must reference the immutable context it consumed.
await assert.rejects(pg.query(`select public.psi_record_agt002_canonical_analysis_run(
  '${S}','${O}','${T}','{"summary":"sin contexto"}'::jsonb,0,'no-context','schema-1','policy-1','model-1',null
)`), /requiere una versión de contexto/i);

const initialContext = await registerAgt002ContextVersion(database, {
  opportunity_id: O, tender_id: T, snapshot_id: S, actor_id: P,
  context: { snapshot_id: S, ...contextSections('Seguridad Nacional Ltda.'), human_evidence: [] },
});
assert.equal(initialContext.context_version, 2);

// Seed run whose questions the two human answers below respond to.
const seedRun = (await pg.query(`select public.psi_record_agt002_canonical_analysis_run(
  '${S}','${O}','${T}','{"summary":"Vig-IA seed"}'::jsonb,0,'seed-run','schema-1','policy-1','model-1',null,'${initialContext.id}'
) r`)).rows[0].r;

function humanEvidenceItem(answer) {
  return {
    answer_id: answer.id,
    question_id: answer.question_id,
    question_text: answer.question_text,
    status: answer.status,
    response: answer.response,
    evidence_notes: answer.evidence_notes,
    responded_by: answer.responded_by_name,
    responded_at: answer.responded_at,
    analysis_run_id: answer.analysis_run_id,
    source: { type: 'human', reference: `psi_tender_question_responses:${answer.id}`, observed_at: answer.responded_at },
  };
}

// First human answer, then the first context version (one answer effective at that time).
const answer1 = await answerQuestion('q-poliza', '¿Vigencia de la póliza?', 'La póliza vence en 2027.', seedRun.id);

const version1 = await registerAgt002ContextVersion(database, {
  opportunity_id: O, tender_id: T, snapshot_id: S, actor_id: P,
  context: { snapshot_id: S, ...contextSections('Seguridad Nacional Ltda.'), human_evidence: [humanEvidenceItem(answer1)] },
});
assert.equal(version1.context_version, 2);
assert.equal(version1.human_evidence_count, 1);
assert.equal(version1.context.human_evidence.length, 1);

const analysis1 = (await pg.query(`select public.psi_record_agt002_canonical_analysis_run(
  '${S}','${O}','${T}','{"summary":"Vig-IA con contexto v1"}'::jsonb,0,'analysis-1','schema-1','policy-1','model-1',null,'${version1.id}'
) r`)).rows[0].r;
assert.equal(analysis1.context_version_id, version1.id);

// Second human answer arrives; the second context version and analysis reference
// BOTH answers effective at this later point in time.
const answer2 = await answerQuestion('q-cctv', '¿Cuántas cámaras se exigen?', 'Se exigen 12 cámaras.', analysis1.id);

const version2 = await registerAgt002ContextVersion(database, {
  opportunity_id: O, tender_id: T, snapshot_id: S, actor_id: P,
  context: { snapshot_id: S, ...contextSections('Seguridad Nacional Ltda.'), human_evidence: [humanEvidenceItem(answer1), humanEvidenceItem(answer2)] },
});
assert.equal(version2.human_evidence_count, 2);

const analysis2 = (await pg.query(`select public.psi_record_agt002_canonical_analysis_run(
  '${S}','${O}','${T}','{"summary":"Vig-IA con contexto v2"}'::jsonb,0,'analysis-2','schema-1','policy-1','model-1',null,'${version2.id}'
) r`)).rows[0].r;
assert.equal(analysis2.context_version_id, version2.id);

// Reproducibility: re-reading version1 after version2/analysis2 exist must still show
// exactly the one answer effective when it was created — creating a newer version never
// mutates an older one.
const rereadVersion1 = (await pg.query(`select context, human_evidence_count from public.psi_agt002_context_versions where id = '${version1.id}'`)).rows[0];
assert.equal(rereadVersion1.human_evidence_count, 1);
assert.equal(rereadVersion1.context.human_evidence.length, 1);
assert.equal(rereadVersion1.context.human_evidence[0].question_id, 'q-poliza');

// Append-only: direct UPDATE/DELETE are rejected even for service_role-owned data.
await assert.rejects(pg.exec(`update public.psi_agt002_context_versions set human_evidence_count = 99 where id = '${version1.id}'`), /append-only/i);
await assert.rejects(pg.exec(`delete from public.psi_agt002_context_versions where id = '${version1.id}'`), /append-only/i);

// Idempotent re-registration with the exact same context returns the same row, not a duplicate.
const version1Again = await registerAgt002ContextVersion(database, {
  opportunity_id: O, tender_id: T, snapshot_id: S, actor_id: P,
  context: { snapshot_id: S, ...contextSections('Seguridad Nacional Ltda.'), human_evidence: [humanEvidenceItem(answer1)] },
});
assert.equal(version1Again.id, version1.id);
assert.equal((await pg.query('select count(*)::int count from public.psi_agt002_context_versions')).rows[0].count, 3);

// A context version cannot be linked to a canonical run from a different snapshot/opportunity.
const otherSnapshotId = '55555555-5555-4555-8555-555555555555';
await pg.exec(`insert into public.psi_sales_opportunities values ('66666666-6666-4666-8666-666666666666');
  insert into public.psi_public_tenders values ('77777777-7777-4777-8777-777777777777');
  insert into public.psi_tender_document_snapshots values ('${otherSnapshotId}','66666666-6666-4666-8666-666666666666','77777777-7777-4777-8777-777777777777');`);
await assert.rejects(pg.query(`select public.psi_record_agt002_canonical_analysis_run(
  '${otherSnapshotId}','66666666-6666-4666-8666-666666666666','77777777-7777-4777-8777-777777777777','{"summary":"x"}'::jsonb,0,'mismatched-context','schema-1','policy-1',null,null,'${version1.id}'
)`), /no coincide/i);

// Historical rows created before this migration keep context_version_id null.
const legacy = (await pg.query("select context_version_id from public.psi_tender_analysis_runs where idempotency_key='legacy'")).rows[0];
assert.equal(legacy.context_version_id, null);

const preRollbackCounts = {
  runs: (await pg.query('select count(*)::int count from public.psi_tender_analysis_runs')).rows[0].count,
  responses: (await pg.query('select count(*)::int count from public.psi_tender_question_responses')).rows[0].count,
};

await pg.exec(rollback051);

// Rollback safety: historical and canonical analysis runs and the preserved
// question-response table survive; only the context-versioning surface is removed.
assert.equal((await pg.query('select count(*)::int count from public.psi_tender_analysis_runs')).rows[0].count, preRollbackCounts.runs);
assert.equal((await pg.query('select count(*)::int count from public.psi_tender_question_responses')).rows[0].count, preRollbackCounts.responses);
assert.equal((await pg.query("select count(*)::int count from information_schema.columns where table_name='psi_tender_analysis_runs' and column_name='context_version_id'")).rows[0].count, 0);
assert.equal((await pg.query("select to_regclass('public.psi_agt002_context_versions') is null removed")).rows[0].removed, true);

// The original (050) canonical-run RPC still works after rollback: recording remains
// possible, it simply no longer accepts a context version.
const postRollback = (await pg.query(`select public.psi_record_agt002_canonical_analysis_run(
  '${S}','${O}','${T}','{"summary":"post-rollback"}'::jsonb,0,'post-rollback','schema-1','policy-1',null,null
) r`)).rows[0].r;
assert.equal(postRollback.canonical, true);
assert.equal(Object.hasOwn(postRollback, 'context_version_id'), false);

console.log('AGT-002 context versions migration apply/rollback passed');
