import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';

const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const migrationPath = new URL('../supabase/migrations/024_tender_offer_status_transitions.sql', import.meta.url);
const servicePath = new URL('../tender-offer-status-rpc.js', import.meta.url);
const panelPath = new URL('../src/tenders/components/TenderOfferStatusPanel.tsx', import.meta.url);

assert.equal(existsSync(migrationPath), true, 'Debe existir la migración aditiva 024 de transiciones auditables.');
assert.equal(existsSync(servicePath), true, 'Debe existir el servicio compartido de estado de oferta.');
assert.equal(existsSync(panelPath), true, 'Debe existir un panel separado de estado de oferta.');

const sql = read('supabase/migrations/024_tender_offer_status_transitions.sql');
const service = read('tender-offer-status-rpc.js');
const panel = read('src/tenders/components/TenderOfferStatusPanel.tsx');
const api = read('src/tenders/api.ts');
const types = read('src/tenders/types.ts');
const main = read('src/main.tsx');

assert.match(sql, /create table if not exists public\.psi_tender_offer_status_transitions/i);
assert.match(sql, /opportunity_id uuid not null/i);
assert.match(sql, /tender_id uuid not null/i);
assert.match(sql, /actor_id uuid not null/i);
assert.match(sql, /from_status text not null/i);
assert.match(sql, /to_status text not null/i);
assert.match(sql, /changed_at timestamptz not null default now\(\)/i);
assert.match(sql, /before update or delete/i, 'El historial de oferta debe ser append-only.');
assert.match(sql, /security definer/i);
assert.match(sql, /for update/i, 'La oportunidad debe bloquearse para transición concurrente.');
assert.match(sql, /expected_current_status/i);
assert.match(sql, /en_preparacion.*lista_para_presentar/i);
assert.match(sql, /lista_para_presentar.*presentada/i);
assert.match(sql, /presentada.*adjudicada/i);
assert.match(sql, /presentada.*no_adjudicada/i);
assert.match(sql, /psi_tender_go_no_go_decisions[\s\S]*v_latest_decision is distinct from 'go'/i, 'La transición requiere GO formal vigente.');
assert.match(sql, /p\.active = true[\s\S]*identity_type, 'human'\)[\s\S]*p\.role in \('admin', 'gerencia', 'director'\)/i);
assert.match(sql, /grant execute on function public\.psi_transition_tender_offer_status/i);
assert.doesNotMatch(sql, /alter table public\.psi_tender_go_no_go_decisions[\s\S]*drop/i, '024 no puede modificar destructivamente el flujo 022.');

assert.match(service, /ACTIONS\.LICITACIONES_GO_NO_GO_APPROVE/);
assert.match(service, /requireAction\(currentProfile, ACTIONS\.LICITACIONES_GO_NO_GO_APPROVE\)/);
assert.match(service, /psi_transition_tender_offer_status/);
assert.match(service, /expected_current_status/);
assert.match(service, /tender_offer_status/);
assert.match(service, /history/);
for (const backend of [read('server/index.js'), read('api/[...path].js')]) {
  assert.match(backend, /tender-offer-status-rpc\.js/);
  assert.match(backend, /app\.get\('\/api\/tender-offer-status'/);
  assert.match(backend, /app\.post\('\/api\/tender-offer-status'/);
  assert.match(backend, /ACTIONS\.LICITACIONES_GO_NO_GO_APPROVE/);
  assert.match(backend, /callTenderOfferStatusTransition/);
}

assert.match(types, /TenderOfferStatusTransition/);
assert.match(types, /TenderOfferStatusPayload/);
assert.match(api, /loadTenderOfferStatus/);
assert.match(api, /recordTenderOfferStatusTransition/);
assert.match(panel, /TenderOfferStatusPanel/);
assert.match(panel, /Confirmar cambio de estado/);
assert.match(panel, /Historial auditable/);
assert.match(panel, /Nota opcional/);
assert.match(panel, /canApproveTenderGoNoGo/);
assert.match(panel, /busy/);
assert.match(main, /authorizedPreparation[\s\S]*<TenderOfferStatusPanel\s+opportunityId=\{opportunity\.id\}/, 'El panel de estado solo debe montarse dentro del expediente autorizado por GO.');
assert.match(main, /<TenderOfferPreparationPanel[\s\S]*currentProfile=\{data\.currentProfile\}[\s\S]*onChanged=\{async \(\) =>/);

console.log('tender offer status transition static checks passed');
