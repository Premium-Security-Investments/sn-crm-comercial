const EXCLUDED_INTERACTION_TYPES = new Set(['llamada', 'correo', 'whatsapp']);

const BACKFILL_EVENT_TYPES_BY_KIND = {
  tender_document_upload: 'document_import_completed',
  tender_document_analysis: 'analysis_completed',
};

function parseInteractionNotes(notes) {
  if (notes && typeof notes === 'object') return notes;
  try { return JSON.parse(notes || '{}'); } catch { return null; }
}

export function selectBackfillableInteractions(interactions) {
  return (interactions || []).filter((interaction) => {
    if (EXCLUDED_INTERACTION_TYPES.has(interaction?.interaction_type)) return false;
    const payload = parseInteractionNotes(interaction?.notes);
    return Boolean(payload?.kind && Object.prototype.hasOwnProperty.call(BACKFILL_EVENT_TYPES_BY_KIND, payload.kind));
  });
}

export function mapToTrackingEvent(interaction) {
  const payload = parseInteractionNotes(interaction?.notes) || {};
  const eventType = BACKFILL_EVENT_TYPES_BY_KIND[payload.kind];
  if (!eventType) throw new Error('Interacción no elegible para el backfill del historial público.');

  const metadata = payload.kind === 'tender_document_upload'
    ? { documents_count: Array.isArray(payload.documents) ? payload.documents.length : 0 }
    : { report_title: payload.report_title || null, status: payload.status || null };

  return {
    tenderId: interaction.tender_id,
    eventType,
    actorKind: 'system',
    createdBy: null,
    sourceRefType: 'legacy_sales_interaction',
    sourceRefId: interaction.id,
    metadata,
    occurredAt: interaction.occurred_at,
    note: null,
    singular: true,
  };
}

export async function runBackfill(deps, { dryRun = true } = {}) {
  const { listInteractions, eventExists, appendEvent } = deps;
  const candidates = selectBackfillableInteractions(await listInteractions());

  const plan = [];
  for (const interaction of candidates) {
    const event = mapToTrackingEvent(interaction);
    const alreadyBackfilled = await eventExists({ sourceRefType: event.sourceRefType, sourceRefId: event.sourceRefId });
    if (alreadyBackfilled) continue;
    plan.push(event);
  }

  if (dryRun) return { dryRun: true, planned: plan.length, applied: 0, events: plan };

  for (const event of plan) await appendEvent(event);
  return { dryRun: false, planned: plan.length, applied: plan.length, events: plan };
}
