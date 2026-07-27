import { strict as assert } from 'node:assert';
import { selectBackfillableInteractions, mapToTrackingEvent, runBackfill } from '../tender-tracking-backfill.js';

const PRIVATE_KEYWORDS = /tel[eé]fono|decisor|whatsapp|comisi[oó]n|correo|email|phone/i;

function assertNoPrivateData(value, label) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, PRIVATE_KEYWORDS, `${label} no debe exponer datos privados: ${serialized}`);
}

// 1) selectBackfillableInteractions: excluye tipos comerciales/privados y conserva solo los kinds documentales elegibles.
{
  const interactions = [
    {
      id: 'int-llamada', tender_id: 'tender-1', opportunity_id: 'opp-1', interaction_type: 'llamada',
      occurred_at: '2026-01-05T10:00:00.000Z',
      notes: JSON.stringify({ decision_maker_phone: '3001234567', decision_maker_name: 'Fulano' }),
    },
    {
      id: 'int-correo', tender_id: 'tender-1', opportunity_id: 'opp-1', interaction_type: 'correo',
      occurred_at: '2026-01-05T11:00:00.000Z',
      notes: JSON.stringify({ decision_maker_email: 'fulano@x.co' }),
    },
    {
      id: 'int-whatsapp', tender_id: 'tender-1', opportunity_id: 'opp-1', interaction_type: 'whatsapp',
      occurred_at: '2026-01-05T12:00:00.000Z',
      notes: JSON.stringify({ decision_maker_phone: '3001234567' }),
    },
    {
      id: 'int-doc-upload', tender_id: 'tender-1', opportunity_id: 'opp-1', interaction_type: 'documento',
      occurred_at: '2026-01-06T09:00:00.000Z',
      notes: JSON.stringify({ kind: 'tender_document_upload', opportunity: 'ACME', documents: [{ name: 'Pliego.pdf' }, { name: 'Anexo.pdf' }] }),
    },
    {
      id: 'int-doc-analysis', tender_id: 'tender-1', opportunity_id: 'opp-1', interaction_type: 'documento',
      occurred_at: '2026-01-07T09:00:00.000Z',
      notes: JSON.stringify({ kind: 'tender_document_analysis', report_title: 'Preanálisis por reglas SIIO', status: 'analisis_generado', recommendation: 'GO', risk: 'medio' }),
    },
    {
      id: 'int-nota', tender_id: 'tender-1', opportunity_id: 'opp-1', interaction_type: 'nota',
      occurred_at: '2026-01-08T09:00:00.000Z',
      notes: 'Seguimiento comercial ordinario.',
    },
  ];

  const selected = selectBackfillableInteractions(interactions);
  const selectedIds = selected.map((interaction) => interaction.id);
  assert.deepEqual(selectedIds, ['int-doc-upload', 'int-doc-analysis']);
  assert.ok(!selectedIds.includes('int-llamada'), 'debe excluir llamada');
  assert.ok(!selectedIds.includes('int-correo'), 'debe excluir correo');
  assert.ok(!selectedIds.includes('int-whatsapp'), 'debe excluir whatsapp');
  assert.ok(!selectedIds.includes('int-nota'), 'una nota comercial libre sin kind elegible no se respalda');

  // 2) mapToTrackingEvent: preserva la fecha histórica, referencia la interacción legada, y NO expone datos privados.
  for (const interaction of selected) {
    const event = mapToTrackingEvent(interaction);
    assert.equal(event.sourceRefType, 'legacy_sales_interaction');
    assert.equal(event.sourceRefId, interaction.id);
    assert.equal(event.actorKind, 'system');
    assert.equal(event.createdBy, null);
    assert.equal(event.occurredAt, interaction.occurred_at);
    assert.equal(event.tenderId, interaction.tender_id);
    assertNoPrivateData(event, `mapToTrackingEvent(${interaction.id})`);
  }

  const uploadEvent = mapToTrackingEvent(selected[0]);
  assert.equal(uploadEvent.eventType, 'document_import_completed');
  const analysisEvent = mapToTrackingEvent(selected[1]);
  assert.equal(analysisEvent.eventType, 'analysis_completed');
}

// 3) mapToTrackingEvent rechaza interacciones no elegibles (defensa en profundidad si alguien la llama directo).
{
  assert.throws(() => mapToTrackingEvent({
    id: 'int-llamada', tender_id: 'tender-1', interaction_type: 'llamada', occurred_at: '2026-01-01T00:00:00.000Z', notes: '{}',
  }), /no elegible/i);
}

// 4) runBackfill en dryRun:true (por defecto) no invoca appendEvent y reporta el plan.
async function run() {
  const interactions = [
    {
      id: 'int-doc-upload', tender_id: 'tender-1', opportunity_id: 'opp-1', interaction_type: 'documento',
      occurred_at: '2026-01-06T09:00:00.000Z',
      notes: JSON.stringify({ kind: 'tender_document_upload', documents: [{ name: 'Pliego.pdf' }] }),
    },
  ];
  const existing = new Set();
  const appended = [];
  const deps = {
    listInteractions: async () => interactions,
    eventExists: async ({ sourceRefId }) => existing.has(sourceRefId),
    appendEvent: async (event) => { appended.push(event); existing.add(event.sourceRefId); },
  };

  const dryPlan = await runBackfill(deps, { dryRun: true });
  assert.equal(dryPlan.dryRun, true);
  assert.equal(dryPlan.planned, 1);
  assert.equal(dryPlan.applied, 0);
  assert.equal(appended.length, 0, 'dry-run no debe invocar appendEvent');

  // 5) Corrida real (dryRun:false) inserta una vez.
  const firstRun = await runBackfill(deps, { dryRun: false });
  assert.equal(firstRun.applied, 1);
  assert.equal(appended.length, 1);

  // 6) Segunda corrida con el mismo source_ref_id ya presente -> idempotente, 0 inserciones nuevas.
  const secondRun = await runBackfill(deps, { dryRun: false });
  assert.equal(secondRun.planned, 0);
  assert.equal(secondRun.applied, 0);
  assert.equal(appended.length, 1, 'no debe reinsertar la interacción ya respaldada');

  console.log('tender-tracking-backfill contract passed');
}
run();
