import { strict as assert } from 'node:assert';
import { AGT002_CONTEXT_V2_MAX_CHARS, buildAgt002ContextV2 } from '../agt002-context-v2.js';

const source = (reference, overrides = {}) => ({ type: 'database', reference, observed_at: '2026-07-29T12:00:00.000Z', ...overrides });
const value = (content, reference, overrides = {}) => ({ status: 'verified', value: content, source: source(reference), ...overrides });

const input = {
  snapshot_id: '55555555-5555-4555-8555-555555555555',
  opportunity: {
    authorized_notes: value('Contacto juan@example.com · Bearer abcdefghijklmnop', 'psi_sales_opportunities:notes'),
    official_source: value('SECOP II', 'psi_public_tenders:source'),
    conversion_reason: value('Coincide con vigilancia física.', 'psi_sales_opportunities:conversion_reason'),
    owner_name: value('Líder Licitaciones', 'psi_sales_profiles:owner'),
    owner_id: value('44444444-4444-4444-8444-444444444444', 'psi_sales_opportunities:owner_id'),
    status: value('en_revision', 'psi_sales_opportunities:status'),
    duration: value('12 meses', 'psi_public_tenders:duration'),
    place: value('Bogotá D.C.', 'psi_public_tenders:place'),
    submission_deadline: value('2026-08-15T17:00:00-05:00', 'psi_public_tenders:deadline'),
    published_at: value('2026-07-20T00:00:00-05:00', 'psi_public_tenders:published'),
    currency: value('COP', 'psi_public_tenders:currency'),
    budget: value(1500000000, 'psi_public_tenders:value'),
    modality: value('Licitación pública', 'psi_public_tenders:modality'),
    entity: value('Entidad contratante', 'psi_public_tenders:entity'),
    title: value('Servicio integral de vigilancia', 'psi_sales_opportunities:title'),
    tender_id: value('33333333-3333-4333-8333-333333333333', 'psi_public_tenders:id'),
    opportunity_id: value('22222222-2222-4222-8222-222222222222', 'psi_sales_opportunities:id'),
    source_url: value('https://secop.example/proceso?token=secret-value', 'psi_public_tenders:url'),
  },
  company_dossier: {
    restrictions: { status: 'not_verified', value: null, source: source('psi_company_procurement_profile:disqualifications_notes') },
    recurring_documents: value(['RUT', 'Cámara de Comercio'], 'psi_company_procurement_profile:recurring_documents'),
    certifications: value(['ISO 9001', 'BASC'], 'psi_company_procurement_profile:certifications'),
    experience: value('Contratos de vigilancia privada.', 'psi_company_procurement_profile:experience_summary'),
    organizational_capacity: value('Estructura nacional.', 'psi_company_procurement_profile:organizational_capacity'),
    financial_capacity: value('Indicadores vigentes.', 'psi_company_procurement_profile:financial_capacity'),
    licenses: value(['Supervigilancia vigente'], 'psi_company_procurement_profile:supervigilancia_license', { source: source('psi_company_procurement_profile:supervigilancia_license', { expires_at: '2027-01-01T00:00:00.000Z' }) }),
    services: value(['Vigilancia fija', 'Vigilancia móvil'], 'psi_company_procurement_profile:authorized_services'),
    unspsc_codes: value(['92121500', '92121700'], 'psi_company_procurement_profile:rup_unspsc_codes'),
    rup_updated_at: value('2026-06-30T00:00:00.000Z', 'psi_company_procurement_profile:rup_updated_at'),
    rup_status: value('vigente', 'psi_company_procurement_profile:rup_status'),
    nit: value('NIT 900.123.456-7', 'psi_company_procurement_profile:nit'),
    legal_name: value('Seguridad Nacional Ltda.', 'psi_company_procurement_profile:legal_name'),
  },
  commercial_context: {
    authorized_notes: value('Respuesta humana autorizada para análisis.', 'psi_sales_interactions:authorized_note', { status: 'reported' }),
    due_at: value('2026-08-01T12:00:00.000Z', 'psi_sales_opportunities:next_action_at'),
    next_action: value('Validar pólizas.', 'psi_sales_opportunities:next_action'),
    account_relationship: value('Cliente nuevo', 'psi_sales_opportunities:relationship'),
    commercial_owner: value('Ejecutivo asignado', 'psi_sales_profiles:commercial_owner'),
    opportunity_status: value('en_revision', 'psi_sales_opportunities:status'),
  },
  human_evidence: [
    {
      answer_id: 'answer-b', question_id: 'q-b', question_text: '¿Existe licencia?', status: 'resolved', response: 'Sí, ver documento.', evidence_notes: 'Licencia 2026.',
      responded_by: 'Directora de Licitaciones', responded_at: '2026-07-29T13:00:00.000Z', analysis_run_id: 'run-1', source: source('psi_tender_question_responses:answer-b', { type: 'human' }),
    },
    {
      answer_id: 'answer-a', question_id: 'q-a', question_text: '¿Existe RUP?', status: 'pending', response: 'Pendiente de validación.', evidence_notes: null,
      responded_by: 'Directora de Licitaciones', responded_at: '2026-07-29T12:30:00.000Z', analysis_run_id: 'run-1', source: source('psi_tender_question_responses:answer-a', { type: 'human' }),
    },
  ],
};

const context = buildAgt002ContextV2(input);
assert.equal(context.context_version, 2);
assert.equal(context.snapshot_id, input.snapshot_id);
assert.deepEqual(Object.keys(context), ['context_version', 'snapshot_id', 'opportunity', 'company_dossier', 'commercial_context', 'human_evidence']);
assert.deepEqual(context.human_evidence.map(item => item.answer_id), ['answer-a', 'answer-b'], 'human evidence must be deterministically ordered');
assert.deepEqual(context.company_dossier.certifications.value, ['BASC', 'ISO 9001'], 'primitive arrays must be deterministically ordered');
assert.match(context.opportunity.authorized_notes.value, /\[REDACTED_EMAIL\].*Bearer \[REDACTED_SECRET\]/);
assert.match(context.opportunity.source_url.value, /token=\[REDACTED_SECRET\]/);
assert.equal(context.company_dossier.nit.value, '[REDACTED_ID]');
assert.equal(context.company_dossier.restrictions.status, 'not_verified');
assert.equal(context.company_dossier.restrictions.value, null);
assert.ok(JSON.stringify(context).length <= AGT002_CONTEXT_V2_MAX_CHARS);

const reversed = buildAgt002ContextV2({
  ...input,
  opportunity: Object.fromEntries(Object.entries(input.opportunity).reverse()),
  company_dossier: Object.fromEntries(Object.entries(input.company_dossier).reverse()),
  commercial_context: Object.fromEntries(Object.entries(input.commercial_context).reverse()),
  human_evidence: [...input.human_evidence].reverse(),
});
assert.equal(JSON.stringify(reversed), JSON.stringify(context), 'equivalent context must serialize deterministically');

assert.throws(() => buildAgt002ContextV2({ ...input, recommendation: 'GO' }), /no permitida|desconocida/i);
assert.throws(() => buildAgt002ContextV2({ ...input, opportunity: { ...input.opportunity, go_no_go: value('GO', 'forbidden') } }), /no permitid[oa]|desconocid[oa]/i);
assert.throws(() => buildAgt002ContextV2({ ...input, opportunity: { ...input.opportunity, title: { ...input.opportunity.title, secret: 'x' } } }), /no permitida|desconocida/i);
assert.throws(() => buildAgt002ContextV2({ ...input, opportunity: { ...input.opportunity, title: value('x'.repeat(4001), 'too-long') } }), /límite|longitud/i);
assert.throws(() => buildAgt002ContextV2({ ...input, human_evidence: Array.from({ length: 101 }, (_, index) => ({ ...input.human_evidence[0], answer_id: `a-${index}` })) }), /límite|máximo/i);
assert.throws(() => buildAgt002ContextV2({ ...input, company_dossier: { ...input.company_dossier, restrictions: { ...input.company_dossier.restrictions, value: 'invented' } } }), /not_verified/i);

console.log('AGT-002 context v2 closed contract passed');
