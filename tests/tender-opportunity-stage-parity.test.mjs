// Paridad: la etapa derivada que usa el backend (tender-opportunity-stage.js, para decidir si el seguimiento automático
// de una fase nueva de SECOP puede bajar documentos y reanalizar) es exactamente `classifyOpportunityStage` del
// frontend (src/tenders/opportunityStage.ts) y el CASE de la migración 088. Si una cambia, esta prueba falla.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { classifyTenderOpportunityStage, isActiveTenderOpportunityStage, latestTenderGoNoGoDecision, TENDER_OPPORTUNITY_TERMINAL_OFFER_STATUSES } from '../tender-opportunity-stage.js';

async function loadModule(relativePath) {
  const bundle = buildSync({ entryPoints: [new URL(relativePath, import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
}
const { classifyOpportunityStage } = await loadModule('../src/tenders/opportunityStage.ts');

const decisions = [undefined, null, '', 'go', 'no_go', 'pendiente', 'GO', 'otra'];
const statuses = [undefined, null, '', 'pendiente_decision', 'en_preparacion', 'lista_para_presentar', 'presentada', 'cerrada_no_go', 'adjudicada', 'no_adjudicada', 'desconocido'];

test('paridad total con classifyOpportunityStage del frontend (todas las combinaciones)', () => {
  for (const decision of decisions) for (const tender_offer_status of statuses) {
    const row = { decision, tender_offer_status };
    assert.equal(classifyTenderOpportunityStage(row), classifyOpportunityStage(row), JSON.stringify(row));
  }
  assert.equal(classifyTenderOpportunityStage(null), classifyOpportunityStage(null));
  assert.equal(classifyTenderOpportunityStage(undefined), classifyOpportunityStage(undefined));
});

test('paridad con la migración 088 (estados terminales del CASE) y activa = Por decidir o En curso', () => {
  const sql = readFileSync(new URL('../supabase/migrations/088_tender_opportunity_primary_stage_filters.sql', import.meta.url), 'utf8');
  const terminal = sql.match(/coalesce\(o\.tender_offer_status, 'pendiente_decision'\) in \(([^)]*)\) then 'cerradas'/)[1].match(/'([^']+)'/g).map(v => v.slice(1, -1));
  assert.deepEqual(terminal, [...TENDER_OPPORTUNITY_TERMINAL_OFFER_STATUSES]);
  assert.equal(isActiveTenderOpportunityStage({ decision: null, tender_offer_status: 'pendiente_decision' }), true);
  assert.equal(isActiveTenderOpportunityStage({ decision: 'go', tender_offer_status: 'en_preparacion' }), true);
  assert.equal(isActiveTenderOpportunityStage({ decision: 'no_go' }), false);
  assert.equal(isActiveTenderOpportunityStage({ decision: 'go', tender_offer_status: 'adjudicada' }), false);
});

test('decisión vigente: la más reciente no reemplazada (misma regla que la migración 088)', () => {
  const rows = [
    { id: 'a', decision: 'go', decided_at: '2026-10-01T00:00:00Z' },
    { id: 'b', decision: 'no_go', decided_at: '2026-10-02T00:00:00Z', supersedes_decision_id: 'a' },
    { id: 'c', decision: 'go', decided_at: '2026-10-03T00:00:00Z', supersedes_decision_id: 'b' },
  ];
  assert.equal(latestTenderGoNoGoDecision(rows).id, 'c');
  assert.equal(latestTenderGoNoGoDecision(rows.slice(0, 2)).decision, 'no_go');
  assert.equal(latestTenderGoNoGoDecision([]), null);
});
