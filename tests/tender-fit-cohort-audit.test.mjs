import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runTenderFitCohortAudit } from '../scripts/tender-fit-cohort-audit.mjs';

const source = readFileSync(new URL('../scripts/tender-fit-cohort-audit.mjs', import.meta.url), 'utf8');
assert.equal(/method:\s*'(POST|PATCH|PUT|DELETE)'/.test(source), false, 'no debe escribir');
assert.equal(source.includes('--apply'), false, 'no debe aceptar --apply');
assert.equal(/psi_record_|psi_append_|psi_enqueue_|psi_claim_|psi_complete_|psi_fail_/.test(source), false, 'no debe llamar RPC de escritura');
const requests = [];
async function fetchImpl(url, options) {
  requests.push({ method: options?.method || 'GET' });
  if (String(url).includes('psi_public_tenders')) return { ok: true, json: async () => [{ id: 't1', title: 'Vigilancia armada', description: '', value: 2_500_000_000, deadline_at: '2026-10-10', city: 'Bogotá', dept: 'Cundinamarca', category: 'Licitación', score: 190 }] };
  return { ok: true, json: async () => [] };
}
const report = await runTenderFitCohortAudit({ baseUrl: 'https://supabase.example.test', serviceKey: 'k', nowIso: '2026-09-20T15:00:00.000Z', fetchImpl });
assert.ok(requests.every(r => r.method === 'GET'));
assert.equal(report.legacy_distribution.alto, 1);
assert.equal(typeof report.fit_distribution.alto, 'number');
assert.ok(report.observed_context.length <= report.cohort_size, 'a lo sumo una fila de contexto por licitación');

// Caso funcional de paginación: filas de ciclo de vida más allá del offset 1000 deben leerse,
// y la precedencia (offer_outcome > human_decision) debe observarse sobre la fila alcanzable sólo paginando.
const paginatedTender = { id: 'paginated-1', title: 'Vigilancia armada paginada', description: '', value: 1_000_000_000, deadline_at: '2026-10-10', city: 'Bogotá', dept: 'Cundinamarca', category: 'Licitación', score: 80 };
const paginatedTenderEmbed = { id: paginatedTender.id, title: paginatedTender.title, description: '', entity: 'E', city: 'Bogotá', dept: 'Cundinamarca', source: 'SECOP II', category: 'Licitación' };
const FILLER_TRANSITIONS = Array.from({ length: 1000 }, (_, i) => ({
  id: `filler-${i}`, tender_id: `filler-tender-${i}`, to_status: 'presentada', changed_at: '2026-01-01T00:00:00Z',
  psi_public_tenders: { id: `filler-tender-${i}`, title: 'Relleno', description: '', entity: 'E', city: 'Bogotá', dept: 'Cundinamarca', source: 'SECOP II', category: 'Licitación' },
}));
const beyondOffsetTransition = { id: 'beyond-offset-transition', tender_id: paginatedTender.id, to_status: 'adjudicada', changed_at: '2026-08-05T00:00:00Z', psi_public_tenders: paginatedTenderEmbed };
const beforeOffsetDecision = { id: 'before-offset-decision', tender_id: paginatedTender.id, decision: 'go', decided_at: '2026-08-01T00:00:00Z', created_at: '2026-08-01T00:00:00Z', supersedes_decision_id: null, psi_public_tenders: paginatedTenderEmbed };
async function paginatedFetchImpl(url) {
  const parsed = new URL(url);
  const table = parsed.pathname.split('/').pop();
  const offset = Number(parsed.searchParams.get('offset') || 0);
  const limit = Number(parsed.searchParams.get('limit') || 1000);
  if (table === 'psi_public_tenders') {
    if (parsed.searchParams.get('internal_status')) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => (offset === 0 ? [paginatedTender] : []) };
  }
  if (table === 'psi_tender_offer_status_transitions') {
    const all = [...FILLER_TRANSITIONS, beyondOffsetTransition]; // la fila real vive en la posición 1000 (offset 1000)
    return { ok: true, json: async () => all.slice(offset, offset + limit) };
  }
  if (table === 'psi_tender_go_no_go_decisions') {
    if (parsed.searchParams.get('supersedes_decision_id')) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => (offset === 0 ? [beforeOffsetDecision] : []) };
  }
  return { ok: true, json: async () => [] };
}
const paginatedReport = await runTenderFitCohortAudit({ baseUrl: 'https://supabase.example.test', serviceKey: 'k', nowIso: '2026-09-20T15:00:00.000Z', fetchImpl: paginatedFetchImpl });
const paginatedContext = paginatedReport.observed_context.find(c => c.tender_id === paginatedTender.id);
assert.ok(paginatedContext, 'la licitación con evidencia más allá del offset 1000 debe aparecer en el contexto observado');
assert.equal(paginatedContext.observation_id, 'offer_outcome:beyond-offset-transition', 'la fila offer_outcome ubicada más allá del offset 1000 debe leerse y su precedencia debe ganar sobre human_decision');
console.log('tender-fit-cohort-audit: OK');
