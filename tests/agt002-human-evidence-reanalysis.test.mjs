import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { registerAgt002ContextVersion } from '../tender-analysis-foundation.js';
import { registerAgt002PreviewAnalysis } from '../agt002-preview-persistence.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';
import { buildSyntheticAgt002TenderAnalysis } from './fixtures/agt002-synthetic-responder.mjs';

const strip = value => value.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const migration050 = strip(readFileSync(new URL('../supabase/migrations/050_agt002_canonical_analysis.sql', import.meta.url), 'utf8'));
const migration038 = strip(readFileSync(new URL('../supabase/migrations/038_tender_question_responses.sql', import.meta.url), 'utf8'));
const migration051 = strip(readFileSync(new URL('../supabase/migrations/051_agt002_context_versions.sql', import.meta.url), 'utf8'));

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

// Same minimal supabase-rpc-shaped shim used by the other AGT-002 PGlite integration tests.
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

function contextSections() {
  return {
    ...buildAgt002OpportunityContextV2({
      opportunity: { id: 'opp-1', owner_id: 'owner-1', owner_name: 'Ana', updated_at: '2026-07-29T10:00:00.000Z' },
      tender: { id: 'tender-1', title: 'Vigilancia', entity: 'Entidad', source: 'SECOP II', updated_at: '2026-07-29T10:00:00.000Z' },
    }),
    company_dossier: buildAgt002CompanyDossier({ profile: { legal_name: 'Seguridad Nacional Ltda.', updated_at: '2026-07-29T10:00:00.000Z' }, documents: [] }),
  };
}

function humanEvidenceItem(answer) {
  return {
    answer_id: answer.id, question_id: answer.question_id, question_text: answer.question_text,
    status: answer.status, response: answer.response, evidence_notes: answer.evidence_notes,
    responded_by: answer.responded_by_name || 'Ana Revisora', responded_at: answer.responded_at,
    analysis_run_id: answer.analysis_run_id,
    source: { type: 'human', reference: `psi_tender_question_responses:${answer.id}`, observed_at: answer.responded_at },
  };
}

const snapshotForEnvelope = {
  snapshot_id: S, opportunity_id: O, tender_id: T,
  document_hash: 'a'.repeat(64), profile_hash: 'b'.repeat(64),
  documents: [{ document_id: 'doc-001', name: 'Pliego', document_type: 'pliego', content: 'Contenido.', content_sha256: 'c'.repeat(64), current: true }],
  company_profile: { profile_version: 'rup-2026-07', fields: [{ key: 'annual_revenue', label: 'Ingresos anuales', value: '500000000', source: 'RUP' }] },
};

// Initial canonical run consumes an immutable context version with no human evidence.
const initialContextVersion = await registerAgt002ContextVersion(database, {
  opportunity_id: O, tender_id: T, snapshot_id: S, actor_id: P,
  context: { snapshot_id: S, ...contextSections(), human_evidence: [] },
});
const initialEnvelope = buildSyntheticAgt002TenderAnalysis(snapshotForEnvelope);
const initialRun = await registerAgt002PreviewAnalysis(database, {
  opportunity_id: O, tender_id: T, snapshot_id: S,
  envelope: { ...initialEnvelope, producer: 'AGT-002' }, canonicalOnly: true,
  context_version_id: initialContextVersion.id,
});
assert.equal(initialRun.canonical, true);

// A human answers the open question the run raised: new evidence.
const answer = await answerQuestion('q-docs', 'Validar evidencia documental.', 'Se adjunta certificación vigente.', initialRun.run_id);

// The answer becomes a new, append-only AGT-002 context version.
const contextVersion = await registerAgt002ContextVersion(database, {
  opportunity_id: O, tender_id: T, snapshot_id: S, actor_id: P,
  context: { snapshot_id: S, ...contextSections(), human_evidence: [humanEvidenceItem(answer)] },
});

// Reanalysis: a new canonical run that consumes and references the new context version.
const reanalysisEnvelope = buildSyntheticAgt002TenderAnalysis(snapshotForEnvelope);
const reanalysisRun = await registerAgt002PreviewAnalysis(database, {
  opportunity_id: O, tender_id: T, snapshot_id: S,
  envelope: { ...reanalysisEnvelope, producer: 'AGT-002' }, canonicalOnly: true,
  context_version_id: contextVersion.id,
});

assert.notEqual(reanalysisRun.run_id, initialRun.run_id, 'una respuesta humana debe producir una ejecución nueva, no reescribir la anterior');
assert.equal(reanalysisRun.context_version_id, contextVersion.id, 'la nueva ejecución debe referenciar la versión de contexto que incorpora la respuesta humana');

// The prior run stays exactly as it was: still readable and still linked to the
// initial immutable context that contained no human evidence.
const rereadInitial = (await pg.query(`select id, result, context_version_id from public.psi_tender_analysis_runs where id = '${initialRun.run_id}'`)).rows[0];
assert.equal(rereadInitial.context_version_id, initialContextVersion.id);
assert.equal(rereadInitial.result.summary, initialEnvelope.summary);

// Idempotent retry: re-registering the exact same reanalysis envelope + context version
// returns the SAME run, never a duplicate.
const retryRun = await registerAgt002PreviewAnalysis(database, {
  opportunity_id: O, tender_id: T, snapshot_id: S,
  envelope: { ...reanalysisEnvelope, producer: 'AGT-002' }, canonicalOnly: true,
  context_version_id: contextVersion.id,
});
assert.equal(retryRun.run_id, reanalysisRun.run_id);
const runCount = (await pg.query(`select count(*)::int c from public.psi_tender_analysis_runs where snapshot_id = '${S}'`)).rows[0].c;
assert.equal(runCount, 2, 'no debe crear una ejecución duplicada al reintentar con el mismo contexto');

// GO/NO-GO decisions are a wholly separate, untouched surface: this flow never creates or
// references that table.
assert.equal((await pg.query("select to_regclass('public.psi_tender_go_no_go_decisions') is null missing")).rows[0].missing, true);

console.log('AGT-002 human evidence reanalysis passed');
