import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { callTenderGoNoGoDecision } from '../tender-go-no-go-rpc.js';
import { registerAgt002ContextVersion } from '../tender-analysis-foundation.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';
import { buildAgt002DocumentChunks } from '../agt002-document-chunks.js';
import { buildAgt002DocumentRetrieval } from '../agt002-document-retrieval.js';
import {
  buildAgt002LegalSource, buildAgt002LegalCitation, validateAgt002LegalConclusion,
} from '../agt002-legal-corpus.js';
import { validateAgt002TenderAnalysisEnvelope, buildAgt002WorkbenchContinuityReference } from '../agt002-tender-adapter.js';
import { buildAgt002WorkbenchContinuityContext } from '../agt002-workbench-context.js';
import { runAgt002WorkbenchWorker } from '../agt002-workbench-worker.js';
import {
  claimAgt002WorkbenchJob, appendAgt002WorkbenchJobEvent, completeAgt002WorkbenchJob,
} from '../agt002-workbench-persistence.js';
import { createSyntheticAgt002Responder } from './fixtures/agt002-workbench-synthetic-responder.mjs';

// Ciclo de vida completo E1-E6 de AGT-002/Vig-IA en un único PGlite aislado, sin
// red y sin agente real: conversión (estado durable oportunidad↔licitación) →
// documentos/evidencia → snapshot → chunks/recuperación → corpus jurídico con
// abstención → análisis Vig-IA canónico → GO exclusivamente humano →
// continuidad en la Mesa por referencias → respuesta humana → nueva versión de
// contexto → nueva ejecución append-only, sin reescribir historia ni decisión.

const strip = value => value.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const migrationSource = name => strip(readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
const migration038 = migrationSource('038_tender_question_responses.sql');
const migration040 = migrationSource('040_tender_dossier_workspace.sql');
const migration045 = migrationSource('045_agt002_dossier_workbench.sql');
const migration050 = migrationSource('050_agt002_canonical_analysis.sql');
const migration051 = migrationSource('051_agt002_context_versions.sql');
const migration052 = migrationSource('052_tender_document_chunks.sql');
const migration053 = migrationSource('053_agt002_legal_corpus.sql');

const ids = Object.freeze({
  human: '11111111-1111-4111-8111-111111111111',
  agent: '11111111-1111-4111-8111-111111111112',
  opportunity: '22222222-2222-4222-8222-222222222222',
  tender: '33333333-3333-4333-8333-333333333333',
  snapshot: '44444444-4444-4444-8444-444444444444',
  pliego: '55555555-5555-4555-8555-555555555551',
  adenda: '55555555-5555-4555-8555-555555555552',
});

function jsonb(value) { return { __jsonb: value }; }

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'null';
  if (value && typeof value === 'object' && Object.hasOwn(value, '__jsonb')) return `'${JSON.stringify(value.__jsonb).replace(/'/g, "''")}'::jsonb`;
  if (Array.isArray(value)) return `array[${value.map(item => `'${String(item).replace(/'/g, "''")}'`).join(',')}]::text[]`;
  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function callFn(pg, name, args) {
  const literals = args.map(sqlLiteral).join(',');
  const result = await pg.query(`select public.${name}(${literals}) as r`);
  return result.rows[0].r;
}

// Shim mínimo estilo Supabase sobre PGlite, reutilizado únicamente para invocar
// la lógica productiva real (hash/idempotencia) de registerAgt002ContextVersion.
function pgliteDatabase(pg) {
  return {
    rpc: async (name, params = {}) => {
      try {
        const data = await callFn(pg, name, Object.values(params));
        return { data, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
  };
}

const ARG_ORDER = Object.freeze({
  psi_claim_agt002_workbench_job: ['p_worker_id', 'p_daily_max_jobs', 'p_max_concurrent', 'p_lease_seconds'],
  psi_complete_agt002_workbench_job: ['p_job_id', 'p_claim_id', 'p_agent_id', 'p_result'],
  psi_append_agt002_workbench_job_event: ['p_job_id', 'p_claim_id', 'p_event_type', 'p_metadata'],
});
function makeWorkerPersistence(pg) {
  const database = {
    rpc: async (name, args) => {
      const order = ARG_ORDER[name];
      const data = await callFn(pg, name, order.map(key => args[key]));
      return { data, error: null };
    },
  };
  return {
    claimAgt002WorkbenchJob: args => claimAgt002WorkbenchJob(database, args),
    appendAgt002WorkbenchJobEvent: args => appendAgt002WorkbenchJobEvent(database, args),
    completeAgt002WorkbenchJob: args => completeAgt002WorkbenchJob(database, args),
  };
}

async function freshDb() {
  const pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true, identity_type text default 'human', role text, full_name text);
    create table public.psi_access_permissions (code text primary key, active boolean not null default true);
    create table public.psi_profile_permissions (profile_id uuid not null, permission_code text not null);
    create table public.psi_sales_opportunities (id uuid primary key, tender_offer_status text);
    create table public.psi_public_tenders (id uuid primary key, converted_opportunity_id uuid);
    create table public.psi_tender_document_versions (
      id uuid primary key, opportunity_id uuid not null references public.psi_sales_opportunities(id),
      tender_id uuid not null references public.psi_public_tenders(id),
      document_type text not null, name text not null, version integer not null,
      content_hash text not null, extracted_text text not null, current boolean not null default true
    );
    create table public.psi_tender_document_snapshots (
      id uuid primary key, opportunity_id uuid not null references public.psi_sales_opportunities(id),
      tender_id uuid not null references public.psi_public_tenders(id), document_hash text not null
    );
    create table public.psi_tender_analysis_runs (
      id uuid primary key default gen_random_uuid(), snapshot_id uuid not null references public.psi_tender_document_snapshots(id),
      opportunity_id uuid not null references public.psi_sales_opportunities(id), tender_id uuid not null references public.psi_public_tenders(id),
      producer text not null, method text not null, status text not null, result jsonb, critical_open_count integer not null default 0,
      idempotency_key text not null unique, schema_version text not null, policy_version text not null, model text, usage jsonb,
      created_at timestamptz not null default now(), completed_at timestamptz
    );
    create table public.psi_tender_go_no_go_decisions (
      id uuid primary key default gen_random_uuid(), opportunity_id uuid not null, tender_id uuid not null,
      decision text not null, analysis_run_id uuid, justification text, decided_by uuid,
      decided_at timestamptz not null default now(), supersedes_decision_id uuid
    );
    insert into public.psi_access_permissions(code) values ('licitaciones'),('licitaciones_custodia');
    insert into public.psi_sales_profiles (id, identity_type, role, full_name) values
      ('${ids.human}', 'human', 'director', 'Encargada Comercial'),
      ('${ids.agent}', 'agent', 'comercial', 'AGT-002');
    insert into public.psi_profile_permissions(profile_id,permission_code) values
      ('${ids.human}','licitaciones'),('${ids.human}','licitaciones_custodia');
    insert into public.psi_sales_opportunities (id, tender_offer_status) values ('${ids.opportunity}', 'en_preparacion');
    insert into public.psi_public_tenders (id, converted_opportunity_id) values ('${ids.tender}', '${ids.opportunity}');
  `);
  await pg.exec(migration038);
  await pg.exec(migration040);
  await pg.exec(migration045);
  await pg.exec(migration050);
  await pg.exec(migration051);
  await pg.exec(migration052);
  await pg.exec(migration053);
  return pg;
}

const pg = await freshDb();
const database = pgliteDatabase(pg);

// ---------------------------------------------------------------------------
// 1) Conversión: la licitación ya está vinculada de forma durable a la
// oportunidad (estado post-conversión); la propia RPC de conversión tiene su
// suite dedicada (tender-tracking-rpc.test.mjs) — aquí se parte de su salida.
// ---------------------------------------------------------------------------
assert.equal((await pg.query('select converted_opportunity_id from public.psi_public_tenders where id=$1', [ids.tender])).rows[0].converted_opportunity_id, ids.opportunity);

// ---------------------------------------------------------------------------
// 2) Documentos/evidencia + 3) snapshot.
// ---------------------------------------------------------------------------
const pliegoText = 'Se exige póliza de cumplimiento vigente por el término del contrato.\n\nSe exige certificado de experiencia de al menos 5 contratos similares.';
const adendaText = 'La póliza de cumplimiento exigida se amplía a cubrir responsabilidad civil extracontractual.';
function hashOf(text) { return createHash('sha256').update(text).digest('hex'); }

const pliegoHash = hashOf(pliegoText);
const adendaHash = hashOf(adendaText);
await pg.exec(`
  insert into public.psi_tender_document_versions (id, opportunity_id, tender_id, document_type, name, version, content_hash, extracted_text, current) values
    ('${ids.pliego}', '${ids.opportunity}', '${ids.tender}', 'pliego_condiciones', 'Pliego de condiciones', 1, '${pliegoHash}', '${pliegoText.replace(/'/g, "''")}', true),
    ('${ids.adenda}', '${ids.opportunity}', '${ids.tender}', 'adenda', 'Adenda No. 1', 1, '${adendaHash}', '${adendaText.replace(/'/g, "''")}', true);
  insert into public.psi_tender_document_snapshots (id, opportunity_id, tender_id, document_hash) values
    ('${ids.snapshot}', '${ids.opportunity}', '${ids.tender}', '${hashOf(pliegoHash + adendaHash)}');
`);

// ---------------------------------------------------------------------------
// 4) Chunks + recuperación acotada.
// ---------------------------------------------------------------------------
const { chunks, gaps } = buildAgt002DocumentChunks([
  { document_id: ids.pliego, document_version_id: ids.pliego, opportunity_id: ids.opportunity, snapshot_id: ids.snapshot, document_type: 'pliego_condiciones', name: 'Pliego de condiciones', version: 1, content_hash: pliegoHash, current: true, extracted_text: pliegoText },
  { document_id: ids.adenda, document_version_id: ids.adenda, opportunity_id: ids.opportunity, snapshot_id: ids.snapshot, document_type: 'adenda', name: 'Adenda No. 1', version: 1, content_hash: adendaHash, current: true, extracted_text: adendaText },
]);
assert.equal(gaps.length, 0, 'ningún documento legible debe reportarse como hueco');
assert.ok(chunks.length >= 3, 'ambos documentos deben producir cobertura de chunks');
assert.equal(chunks.some(chunk => chunk.document_type === 'adenda' && chunk.precedence === 'addendum'), true);
assert.equal(chunks.filter(chunk => chunk.document_type === 'pliego_condiciones').every(chunk => chunk.superseded_by_addendum === true), true, 'la adenda debe marcar el pliego base como superseded');

for (const chunk of chunks) {
  const persisted = await callFn(pg, 'psi_record_tender_document_chunk', [
    ids.opportunity, ids.tender, chunk.document_version_id, chunk.snapshot_id, chunk.chunk_id, chunk.evidence_ref,
    chunk.document_type, chunk.name, chunk.version, chunk.content_hash, chunk.page, chunk.section, chunk.chunk_index,
    chunk.text, chunk.chunk_hash, chunk.current, chunk.precedence, chunk.superseded_by_addendum, ids.human,
  ]);
  assert.equal(persisted.chunk_id, chunk.chunk_id);
}
// Reintentar la persistencia del mismo chunk_id no debe duplicar filas (idempotencia).
await callFn(pg, 'psi_record_tender_document_chunk', [
  ids.opportunity, ids.tender, chunks[0].document_version_id, chunks[0].snapshot_id, chunks[0].chunk_id, chunks[0].evidence_ref,
  chunks[0].document_type, chunks[0].name, chunks[0].version, chunks[0].content_hash, chunks[0].page, chunks[0].section, chunks[0].chunk_index,
  chunks[0].text, chunks[0].chunk_hash, chunks[0].current, chunks[0].precedence, chunks[0].superseded_by_addendum, ids.human,
]);
assert.equal(Number((await pg.query('select count(*)::int as n from public.psi_tender_document_chunks')).rows[0].n), chunks.length, 'reintentar la misma clave de chunk no debe duplicar filas');

const retrieval = buildAgt002DocumentRetrieval({
  snapshot_id: ids.snapshot,
  chunks, gaps,
  requirements: [{ requirement_id: 'poliza_cumplimiento', terms: ['póliza', 'cumplimiento'] }],
  max_chunks: 10, max_chars: 20000, max_tokens: 20000,
});
assert.ok(retrieval.selected_chunks.length > 0);
assert.deepEqual(retrieval.citation_allowlist, [...retrieval.selected_chunks.map(chunk => chunk.evidence_ref)].sort());

// ---------------------------------------------------------------------------
// 5) Corpus jurídico versionado con citas y abstención explícita.
// ---------------------------------------------------------------------------
const corpusDraft = await callFn(pg, 'psi_create_agt002_legal_corpus_draft', ['v1-test', 'Corpus de prueba del ciclo de vida', ids.human, null]);

const eligibleSource = buildAgt002LegalSource({
  source_id: 'ley-80-1993-art-2', norm_type: 'Ley', norm_number: '80', year: 1993, article_or_section: 'Artículo 2',
  current_text: 'Se denominan entidades estatales, para los efectos de esta ley...',
  issuing_authority: 'Congreso de Colombia', issued_at: '1993-10-28', effective_from: '1993-10-28', effective_to: null,
  modifications: [], official_url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=304',
  topic: ['contratacion_publica'], sector: ['seguridad_privada'], verified_at: '2026-07-01T00:00:00.000Z',
  corpus_version: 'v1-test', verification_status: 'verified', validity_status: 'confirmed', applicability_status: 'applicable',
});
const uncertainSource = buildAgt002LegalSource({
  source_id: 'resolucion-vigencia-incierta', norm_type: 'Resolución', norm_number: '9999', year: 2024, article_or_section: 'Artículo 1',
  current_text: 'Disposición transitoria sobre supervisión de servicios de vigilancia.',
  issuing_authority: 'Superintendencia de Vigilancia y Seguridad Privada', issued_at: '2024-01-15', effective_from: '2024-02-01', effective_to: null,
  modifications: [], official_url: 'https://www.supervigilancia.gov.co/normativa/resolucion-9999',
  topic: ['vigilancia_privada'], sector: ['seguridad_privada'], verified_at: '2026-06-01T00:00:00.000Z',
  corpus_version: 'v1-test', verification_status: 'verified', validity_status: 'confirmed', applicability_status: 'uncertain',
});

for (const source of [eligibleSource, uncertainSource]) {
  await callFn(pg, 'psi_add_agt002_legal_source', [
    corpusDraft.id, source.source_id, source.norm_type, source.norm_number, source.year, source.article_or_section,
    source.current_text, source.issuing_authority, source.issued_at, source.effective_from, source.effective_to,
    jsonb(source.modifications), source.official_url, source.topic, source.sector, source.verified_at,
    source.verification_status, source.validity_status, source.applicability_status, ids.human,
  ]);
}
const corpusVersion = await callFn(pg, 'psi_publish_agt002_legal_corpus', [corpusDraft.id, ids.human]);
assert.equal(corpusVersion.status, 'published');

const verifiedConclusion = validateAgt002LegalConclusion(
  { status: 'verified_law', statement: 'La Ley 80 de 1993 aplica a la contratación estatal analizada.', citations: [buildAgt002LegalCitation(eligibleSource)], reasons: [] },
  { sources: [eligibleSource, uncertainSource], as_of: '2026-07-30T00:00:00.000Z' },
);
assert.equal(verifiedConclusion.status, 'verified_law');
assert.equal(verifiedConclusion.citations[0].source_id, 'ley-80-1993-art-2');

const abstentionConclusion = validateAgt002LegalConclusion(
  { status: 'requires_human_legal_review', statement: 'No verificado jurídicamente; requiere revisión humana', citations: [buildAgt002LegalCitation(uncertainSource)], reasons: [] },
  { sources: [eligibleSource, uncertainSource], as_of: '2026-07-30T00:00:00.000Z' },
);
assert.equal(abstentionConclusion.status, 'requires_human_legal_review');
assert.ok(abstentionConclusion.reasons.includes('applicability_uncertain'));

// ---------------------------------------------------------------------------
// 6) Contexto v2 (versión 1) y análisis Vig-IA canónico.
// ---------------------------------------------------------------------------
function contextSections() {
  return {
    ...buildAgt002OpportunityContextV2({
      opportunity: { id: ids.opportunity, owner_id: ids.human, owner_name: 'Encargada Comercial', updated_at: '2026-07-29T10:00:00.000Z' },
      tender: { id: ids.tender, title: 'Vigilancia y seguridad privada', entity: 'Entidad Pública', source: 'SECOP II', updated_at: '2026-07-29T10:00:00.000Z' },
    }),
    company_dossier: buildAgt002CompanyDossier({ profile: { legal_name: 'Seguridad Nacional Ltda.', updated_at: '2026-07-29T10:00:00.000Z' }, documents: [] }),
  };
}
const contextVersion1 = await registerAgt002ContextVersion(database, {
  opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot, actor_id: ids.human,
  context: { snapshot_id: ids.snapshot, ...contextSections(), human_evidence: [] },
});
assert.equal(contextVersion1.human_evidence_count, 0);

const questionEvidenceRef = retrieval.selected_chunks[0].evidence_ref;
const findings = () => ({
  strengths: [], weaknesses: [], blockers: [],
  questions: [{ id: 'q-poliza-vigencia', text: '¿Cuál es la vigencia exacta exigida para la póliza de cumplimiento tras la adenda?', critical: true, evidence_refs: [questionEvidenceRef] }],
  unverified: [],
});
const canonicalRun = await callFn(pg, 'psi_record_agt002_canonical_analysis_run', [
  ids.snapshot, ids.opportunity, ids.tender,
  {
    recommendation: 'advance_conditionally', summary: 'Requisitos habilitantes identificables; una pregunta abierta sobre vigencia de póliza.',
    ...findings(), next_action: 'Confirmar vigencia de póliza con el área jurídica antes del GO.', human_review_required: true,
    evidence_coverage: { citation_allowlist: retrieval.citation_allowlist, material_omissions: retrieval.material_omissions },
    legal_conclusion: abstentionConclusion,
  },
  0, 'lifecycle-run-1', 'schema-1', 'policy-1', 'model-1', { input_tokens: 500, output_tokens: 200 },
  contextVersion1.id, corpusVersion.id,
]);
assert.equal(canonicalRun.producer, 'AGT-002');
assert.equal(canonicalRun.canonical, true);
assert.equal(canonicalRun.context_version_id, contextVersion1.id);
assert.equal(canonicalRun.legal_corpus_version_id, corpusVersion.id);

// Ausencia de runs duplicados: repetir la misma clave de idempotencia con el
// mismo payload no crea una segunda fila.
const canonicalRunRetry = await callFn(pg, 'psi_record_agt002_canonical_analysis_run', [
  ids.snapshot, ids.opportunity, ids.tender,
  {
    recommendation: 'advance_conditionally', summary: 'Requisitos habilitantes identificables; una pregunta abierta sobre vigencia de póliza.',
    ...findings(), next_action: 'Confirmar vigencia de póliza con el área jurídica antes del GO.', human_review_required: true,
    evidence_coverage: { citation_allowlist: retrieval.citation_allowlist, material_omissions: retrieval.material_omissions },
    legal_conclusion: abstentionConclusion,
  },
  0, 'lifecycle-run-1', 'schema-1', 'policy-1', 'model-1', { input_tokens: 500, output_tokens: 200 },
  contextVersion1.id, corpusVersion.id,
]);
assert.equal(canonicalRunRetry.id, canonicalRun.id);
assert.equal(Number((await pg.query('select count(*)::int as n from public.psi_tender_analysis_runs')).rows[0].n), 1);

// ---------------------------------------------------------------------------
// 7) GO registrado exclusivamente por humano.
// ---------------------------------------------------------------------------
function poisonedDatabase() {
  return { from() { throw new Error('no debe tocarse la base de datos para un actor de agente'); }, rpc() { throw new Error('no debe tocarse la base de datos para un actor de agente'); } };
}
await assert.rejects(
  () => callTenderGoNoGoDecision(poisonedDatabase(), { opportunity_id: ids.opportunity, decision: 'go', analysis_run_id: canonicalRun.id, justification: 'intento de agente' }, {
    id: ids.agent, active: true, identity_type: 'agent', role: 'admin', permissions: ['licitaciones'],
  }),
  error => { assert.equal(error.status, 403); return true; },
  'un actor de agente no puede registrar GO/NO-GO ni siquiera sobre este mismo caso',
);
// El GO humano se registra (estado durable que consume la Mesa post-GO); la
// propia RPC psi_record_tender_go_no_go y su cadena de migraciones tienen su
// suite dedicada (tender-go-no-go-pglite.integration.test.mjs).
const goDecision = (await pg.query(
  `insert into public.psi_tender_go_no_go_decisions (opportunity_id, tender_id, decision, analysis_run_id, justification, decided_by)
   values ($1,$2,'go',$3,'Requisitos habilitantes verificados',$4) returning id`,
  [ids.opportunity, ids.tender, canonicalRun.id, ids.human],
)).rows[0];
await pg.exec(`update public.psi_sales_opportunities set tender_offer_status='go_authorized' where id='${ids.opportunity}'`);

// ---------------------------------------------------------------------------
// 8) Continuidad en la Mesa por referencias (sin duplicar documentos).
// ---------------------------------------------------------------------------
const envelope = {
  schema_version: '2.0-preview.1', agent_id: 'AGT-002', run_id: canonicalRun.id, policy_version: 'policy-1', snapshot_id: ids.snapshot,
  status: 'completed', method: 'agent_ai', recommendation: 'advance_conditionally',
  summary: 'Requisitos habilitantes identificables; una pregunta abierta sobre vigencia de póliza.',
  ...findings(), next_action: 'Confirmar vigencia de póliza con el área jurídica antes del GO.', human_review_required: true,
  usage: { provider: 'hetzner-bridge', model: 'model-1', input_tokens: 500, output_tokens: 200, cost_usd: 0.02 },
};
validateAgt002TenderAnalysisEnvelope(envelope);
const continuityReference = buildAgt002WorkbenchContinuityReference(envelope, {
  opportunity_id: ids.opportunity, tender_id: ids.tender,
  context_version_id: contextVersion1.id, legal_corpus_version_id: corpusVersion.id,
  evidence_coverage: { material_omissions: retrieval.material_omissions, omitted_count: retrieval.omitted_chunks.length },
});
const continuityContext = buildAgt002WorkbenchContinuityContext(continuityReference);
assert.equal(continuityContext.canonical_run_id, canonicalRun.id);
assert.equal(continuityContext.dossier_links.length, 4);
for (const link of continuityContext.dossier_links) {
  assert.equal(typeof link.resource_id, 'string');
  assert.doesNotMatch(JSON.stringify(link), /Se exige póliza|Congreso de Colombia/, 'la continuidad nunca debe portar texto crudo de documentos o normas, solo referencias');
}

const threadId = (await callFn(pg, 'psi_get_or_create_agt002_workbench_thread', [ids.opportunity, ids.human])).id;
const messageId = '66666666-6666-4666-8666-666666666601';
const contextLinksForMessage = continuityContext.dossier_links.map(link => ({ kind: link.link_kind, id: link.resource_id, label: link.label, source_ref: link.source_ref }));
const draftJob = await callFn(pg, 'psi_append_agt002_workbench_message', [
  ids.opportunity, ids.human, threadId, messageId, '¿Qué evidencia respalda la recomendación de Vig-IA sobre la póliza?',
  jsonb(contextLinksForMessage), hashOf('idem-key-0001-lifecycle'), 'agt002.dossier-workbench.v1', 'agt002.dossier-workbench.policy.v1',
  'agt002.dossier-workbench.reply.v1', ids.snapshot, null,
]);
assert.equal(draftJob.status, 'queued');

// ---------------------------------------------------------------------------
// 9) Respuesta humana (agente sintético cita solo referencias autorizadas).
// ---------------------------------------------------------------------------
const replyResponder = createSyntheticAgt002Responder({
  [messageId]: {
    kind: 'reply', visible_agent_name: 'Vig-IA', human_review_required: true,
    snapshot_id: ids.snapshot, base_version_id: null,
    content_text: 'La recomendación se basa en el pliego y la adenda que amplía la cobertura de la póliza.',
    source_links: [contextLinksForMessage[0].id],
    missing_information: [], required_actions: ['La encargada debe confirmar la vigencia exacta con el área jurídica.'],
  },
});
const persistence = makeWorkerPersistence(pg);
const workerOutcome = await runAgt002WorkbenchWorker({
  persistence, responder: replyResponder,
  limits: { workerId: 'worker-lifecycle', dailyMaxJobs: 5, maxConcurrent: 1, leaseSeconds: 300, responderTimeoutMs: 1000, agentId: ids.agent },
});
assert.deepEqual(workerOutcome, { status: 'completed', job_id: draftJob.job_id });
assert.equal(Number((await pg.query('select count(*)::int as n from public.psi_agt002_workbench_jobs')).rows[0].n), 1, 'un único mensaje humano no debe producir jobs duplicados');

// ---------------------------------------------------------------------------
// 10) Nueva versión de contexto a partir de evidencia humana.
// ---------------------------------------------------------------------------
const answer = await callFn(pg, 'psi_record_tender_question_response', [
  ids.opportunity, canonicalRun.id, 'q-poliza-vigencia', '¿Cuál es la vigencia exacta exigida para la póliza tras la adenda?',
  'resolved', 'La póliza debe mantenerse vigente durante la ejecución y 5 años más, incluyendo responsabilidad civil extracontractual.', null, ids.human,
]);
const contextVersion2 = await registerAgt002ContextVersion(database, {
  opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot, actor_id: ids.human,
  context: {
    snapshot_id: ids.snapshot, ...contextSections(),
    human_evidence: [{
      answer_id: answer.id, question_id: answer.question_id, question_text: answer.question_text, status: answer.status,
      response: answer.response, evidence_notes: answer.evidence_notes, responded_by: answer.responded_by_name,
      responded_at: answer.responded_at, analysis_run_id: answer.analysis_run_id,
      source: { type: 'human', reference: `psi_tender_question_responses:${answer.id}`, observed_at: answer.responded_at },
    }],
  },
});
assert.equal(contextVersion1.context_version, 2, 'la ejecución inicial usa el contrato de contexto v2');
assert.equal(contextVersion2.context_version, 2, 'el reanálisis conserva el contrato de contexto v2');
assert.notEqual(contextVersion2.id, contextVersion1.id, 'la respuesta humana crea una nueva versión histórica append-only');
assert.equal(Number((await pg.query('select count(*)::int as n from public.psi_agt002_context_versions')).rows[0].n), 2);
assert.equal(contextVersion2.human_evidence_count, 1);
// Append-only: releer la versión 1 tras crear la versión 2 debe mostrar exactamente lo que existía entonces.
const rereadVersion1 = (await pg.query('select human_evidence_count from public.psi_agt002_context_versions where id=$1', [contextVersion1.id])).rows[0];
assert.equal(rereadVersion1.human_evidence_count, 0);

// ---------------------------------------------------------------------------
// 11) Nueva ejecución canónica append-only: no reescribe la anterior ni la decisión.
// ---------------------------------------------------------------------------
const reanalysisRun = await callFn(pg, 'psi_record_agt002_canonical_analysis_run', [
  ids.snapshot, ids.opportunity, ids.tender,
  {
    recommendation: 'advance', summary: 'Vigencia de póliza confirmada por evidencia humana; sin bloqueos habilitantes abiertos.',
    strengths: [], weaknesses: [], blockers: [], questions: [], unverified: [],
    next_action: 'Continuar con la preparación de la oferta.', human_review_required: true,
    evidence_coverage: { citation_allowlist: retrieval.citation_allowlist, material_omissions: retrieval.material_omissions },
    legal_conclusion: abstentionConclusion,
  },
  0, 'lifecycle-run-2', 'schema-1', 'policy-1', 'model-1', { input_tokens: 300, output_tokens: 150 },
  contextVersion2.id, corpusVersion.id,
]);
assert.notEqual(reanalysisRun.id, canonicalRun.id);
assert.equal(reanalysisRun.context_version_id, contextVersion2.id);
assert.equal(Number((await pg.query('select count(*)::int as n from public.psi_tender_analysis_runs')).rows[0].n), 2, 'debe existir exactamente el run original más el reanálisis, sin duplicados');

const originalRunAfterReanalysis = (await pg.query('select result, context_version_id from public.psi_tender_analysis_runs where id=$1', [canonicalRun.id])).rows[0];
assert.equal(originalRunAfterReanalysis.context_version_id, contextVersion1.id, 'el run original no debe migrar a la nueva versión de contexto');
assert.equal(originalRunAfterReanalysis.result.summary, 'Requisitos habilitantes identificables; una pregunta abierta sobre vigencia de póliza.');

const decisionAfterReanalysis = (await pg.query('select decision, analysis_run_id from public.psi_tender_go_no_go_decisions where id=$1', [goDecision.id])).rows[0];
assert.equal(decisionAfterReanalysis.decision, 'go');
assert.equal(decisionAfterReanalysis.analysis_run_id, canonicalRun.id, 'el reanálisis nunca debe reescribir la decisión GO ya tomada');
assert.equal(Number((await pg.query('select count(*)::int as n from public.psi_tender_go_no_go_decisions')).rows[0].n), 1, 'ninguna decisión duplicada debe surgir del reanálisis');

await pg.close();
console.log('AGT-002 Vig-IA full lifecycle (PGlite) passed');
