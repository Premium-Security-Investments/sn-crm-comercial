import { strict as assert } from 'node:assert';
import {
  AGT002_TENDER_CONTEXT_SELECT,
  buildAgt002OpportunityContextV2,
  loadAgt002OpportunityContextV2,
} from '../agt002-opportunity-context-v2.js';
import { AGT002_CONTEXT_V2_FIELDS } from '../agt002-context-v2.js';

const opportunity = {
  id: '11111111-1111-4111-8111-111111111111',
  owner_id: '22222222-2222-4222-8222-222222222222',
  owner_name: 'Líder Licitaciones',
  company_name: 'Entidad comercial',
  stage_code: 'PROPUESTA',
  stage_name: 'Propuesta',
  offer_value: 480000000,
  next_action_at: '2026-08-12T14:00:00.000Z',
  updated_at: '2026-07-29T15:00:00.000Z',
  ignored_secret: 'must-not-leak',
};
const tender = {
  id: '33333333-3333-4333-8333-333333333333',
  source: 'SECOP II',
  entity: 'Alcaldía de Ejemplo',
  dept: 'Cundinamarca',
  city: 'Bogotá D.C.',
  title: 'Servicio integral de vigilancia',
  value: 500000000,
  status: 'Publicado',
  published_at: '2026-07-20T12:00:00.000Z',
  deadline_at: '2026-08-15T22:00:00.000Z',
  url: 'https://www.secop.gov.co/proceso/123?token=secret-value',
  raw: { modalidad: 'Licitación pública', duracion: '12 meses', ignored_private: 'must-not-leak' },
  internal_status: 'convertida_oportunidad',
  tracking_status: 'en_revision',
  tracking_next_action: 'Validar RUP',
  tracking_due_at: '2026-08-10T14:00:00.000Z',
  tracking_last_note: 'Nota autorizada; contacto juan@example.com',
  reasons: ['Vigilancia física', 'Cobertura regional'],
  updated_at: '2026-07-29T16:00:00.000Z',
  ignored_secret: 'must-not-leak',
};

const built = buildAgt002OpportunityContextV2({ opportunity, tender });
assert.deepEqual(Object.keys(built.opportunity), AGT002_CONTEXT_V2_FIELDS.opportunity);
assert.deepEqual(Object.keys(built.commercial_context), AGT002_CONTEXT_V2_FIELDS.commercial_context);
assert.equal(built.opportunity.modality.value, 'Licitación pública');
assert.equal(built.opportunity.budget.value, 500000000);
assert.equal(built.opportunity.currency.value, 'COP');
assert.equal(built.opportunity.place.value, 'Bogotá D.C., Cundinamarca');
assert.equal(built.opportunity.duration.value, '12 meses');
assert.equal(built.opportunity.owner_name.value, 'Líder Licitaciones');
assert.equal(built.opportunity.conversion_reason.value, 'Cobertura regional · Vigilancia física');
assert.equal(built.commercial_context.next_action.value, 'Validar RUP');
assert.match(built.opportunity.authorized_notes.value, /\[REDACTED_EMAIL\]/);
assert.match(built.opportunity.source_url.value, /token=\[REDACTED_SECRET\]/);
assert.doesNotMatch(JSON.stringify(built), /ignored_secret|ignored_private|must-not-leak/);
for (const section of [built.opportunity, built.commercial_context]) {
  for (const item of Object.values(section)) {
    assert.ok(['verified', 'reported', 'not_verified'].includes(item.status));
    assert.ok(item.source.type);
    assert.ok(item.source.reference);
    assert.ok(item.source.observed_at);
  }
}

const missing = buildAgt002OpportunityContextV2({
  opportunity: { id: opportunity.id, updated_at: opportunity.updated_at },
  tender: { id: tender.id, updated_at: tender.updated_at },
});
assert.equal(missing.opportunity.modality.status, 'not_verified');
assert.equal(missing.opportunity.modality.value, null);
assert.equal(missing.commercial_context.authorized_notes.status, 'not_verified');

const calls = [];
const database = {
  from(table) {
    return {
      select(columns) {
        calls.push({ table, columns });
        const row = table === 'v_psi_sales_opportunity_enriched' ? opportunity : tender;
        const chain = {
          eq() { return chain; },
          single: async () => ({ data: row, error: null }),
        };
        return chain;
      },
    };
  },
};
const loaded = await loadAgt002OpportunityContextV2(database, {
  opportunityId: opportunity.id,
  tenderId: tender.id,
});
assert.equal(loaded.opportunity.tender_id.value, tender.id);
assert.equal(calls.length, 2);
assert.ok(calls.every(call => call.columns !== '*'));
assert.equal(calls.find(call => call.table === 'psi_public_tenders').columns, AGT002_TENDER_CONTEXT_SELECT);

console.log('AGT-002 opportunity context v2 loader passed');
