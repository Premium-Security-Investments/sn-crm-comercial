// Juan, 2026-11-12: lo que pasó a Seguimiento o se convirtió en oportunidad sale del Radar («no tiene sentido que estén
// en dos lugares»). Lo nuevo y lo descartado siguen.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildSync } from 'esbuild';

const bundled = buildSync({ entryPoints: [new URL('../src/tenders/radarUtils.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const { deduplicateTenders, onlyRadarCandidates } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`);

const tender = (id, internal_status, extra = {}) => ({ id, stable_key: id, entity: `Entidad ${id}`, ref: `REF-${id}`, source: 'SECOP II', title: 'Vigilancia', internal_status, ...extra });

test('el Radar no muestra lo que está en Seguimiento ni lo convertido en oportunidad', () => {
  const rows = [tender('a', 'nueva'), tender('b', 'en_revision'), tender('c', 'convertida_oportunidad'), tender('d', 'descartada'), tender('e', undefined)];
  assert.deepEqual(onlyRadarCandidates(rows).map(row => row.id), ['a', 'd', 'e']);
});

test('si una copia duplicada ya está convertida, sale el grupo entero', () => {
  const twin = { entity: 'Fiscalía', ref: 'FGN-0058', source: 'SECOP II' };
  const rows = [tender('x1', 'nueva', twin), tender('x2', 'convertida_oportunidad', twin)];
  assert.deepEqual(onlyRadarCandidates(deduplicateTenders(rows)), []);
});

test('el Radar filtra después de agrupar', () => {
  const view = readFileSync(new URL('../src/tenders/TenderRadarView.tsx', import.meta.url), 'utf8');
  assert.ok(view.includes('onlyRadarCandidates(deduplicateTenders(payload?.tenders || []))'));
});

test('Oportunidades: cuántas hay en Todas, Por decidir y En curso, sin archivadas', async () => {
  const stage = buildSync({ entryPoints: [new URL('../src/tenders/opportunityStage.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
  const { countOpportunityStages } = await import(`data:text/javascript;base64,${Buffer.from(stage.outputFiles[0].contents).toString('base64')}`);
  const rows = [{ decision: null }, { decision: 'go', tender_offer_status: 'en_preparacion' }, { decision: 'no_go' }, { decision: 'go', archived_at: '2026-11-01' }, { decision: 'pendiente' }];
  // 2026-11-12: las cerradas no cuentan en Todas.
  assert.deepEqual(countOpportunityStages(rows), { all: 3, por_decidir: 2, en_curso: 1, cerradas: 1 });
  const view = readFileSync(new URL('../src/tenders/TenderOpportunitiesView.tsx', import.meta.url), 'utf8');
  for (const label of ['>Todas<FilterCount value={counts?.all} />', '>Por decidir<FilterCount value={counts?.por_decidir} />', '>En curso<FilterCount value={counts?.en_curso} />']) assert.ok(view.includes(label), label);
});

test('Ver cerradas: No GO, Archivadas y Con resultado; Todas sólo lo activo', async () => {
  const stage = buildSync({ entryPoints: [new URL('../src/tenders/opportunityStage.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
  const { closedOpportunityGroup, isActiveOpportunity } = await import(`data:text/javascript;base64,${Buffer.from(stage.outputFiles[0].contents).toString('base64')}`);
  assert.equal(closedOpportunityGroup({ decision: 'no_go', tender_offer_status: 'cerrada_no_go' }), 'no_go');
  assert.equal(closedOpportunityGroup({ decision: 'go', tender_offer_status: 'adjudicada' }), 'con_resultado');
  assert.equal(closedOpportunityGroup({ decision: 'go', tender_offer_status: 'no_adjudicada' }), 'con_resultado');
  assert.equal(closedOpportunityGroup({ decision: 'go', archived_at: '2026-11-01' }), 'archivadas');
  assert.equal(isActiveOpportunity({ decision: 'go', tender_offer_status: 'presentada' }), true, 'presentada y sin resultado sigue en curso');
  assert.equal(isActiveOpportunity({ decision: 'no_go' }), false);
});
