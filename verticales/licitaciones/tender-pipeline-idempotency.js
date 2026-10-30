export function jobIdempotencyKey({ tenderId, opportunityId, pipelineVersion }) {
  return `tender:${tenderId}:conversion:${opportunityId}:pipeline:${pipelineVersion}`;
}

export function documentIdentity({ opportunityId, source, sourceDocumentId }) {
  return `document:${opportunityId}:${source}:${sourceDocumentId}`;
}

export function singularEventKey({ eventType, sourceRefType, sourceRefId }) {
  return `event:${eventType}:${sourceRefType}:${sourceRefId}`;
}
