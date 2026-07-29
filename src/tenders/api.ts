import type { TenderDossierArtifact, TenderDossierItem, TenderDossierItemActionInput, TenderDossierWorkbench, TenderDossierWorkbenchLearningReviewInput, TenderDossierWorkbenchMessageInput, TenderDossierWorkbenchRetryInput, TenderDossierWorkspace, TenderGoNoGoDecisionInput, TenderGoNoGoPayload, TenderGoNoGoPostPayload, TenderOfferStatusPayload, TenderOfferStatusTransitionInput, TenderRequest, TenderTrackingEventsPage, TenderTrackingUpdate } from './types';

/** Explicit resource loaders: each tender view owns only the data it needs. */
export async function loadRadar<T>(request: TenderRequest): Promise<T> {
  return request<T>('/api/tenders');
}

export async function loadTracking<T>(request: TenderRequest): Promise<T> {
  return request<T>('/api/tender-tracking');
}

export async function loadTrackingEvents(request: TenderRequest, tenderId: string, cursor?: string | null, scope: 'business' | 'technical' = 'business'): Promise<TenderTrackingEventsPage> {
  const query = new URLSearchParams({ id: tenderId, limit: '50' });
  if (cursor) query.set('cursor', cursor);
  query.set('scope', scope);
  return request<TenderTrackingEventsPage>(`/api/tender-tracking-events?${query.toString()}`);
}

export async function postActuation(request: TenderRequest, input: { tender_id: string; type: string; note: string }) {
  return request('/api/tender-actuation', { method: 'POST', body: JSON.stringify(input) });
}

export async function updateTracking<T>(request: TenderRequest, update: TenderTrackingUpdate): Promise<T> {
  return request<T>('/api/tender-tracking-update', { method: 'POST', body: JSON.stringify(update) });
}

export async function enterTrackingFromRadar<T = Record<string, unknown>>(request: TenderRequest, stableKey: string, expectedTrackingUpdatedAt: string | null = null): Promise<T> {
  const id = String(stableKey || '').trim();
  if (!id) throw new Error('Debe indicar la licitación.');
  return request<T>(`/api/tender-status?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ internal_status: 'en_revision', expected_tracking_updated_at: expectedTrackingUpdatedAt }),
  });
}

export type TenderDossierPage = { limit?: number; offset?: number; filter?: import('./types').TenderOpportunityFilter };
export async function loadDossiers<T>(request: TenderRequest, page: TenderDossierPage = {}): Promise<T> {
  return loadTenderOpportunities(request, page);
}

export async function loadTenderOpportunities<T>(request: TenderRequest, page: TenderDossierPage = {}): Promise<T> {
  const limit = Math.min(50, Math.max(1, Math.trunc(page.limit ?? 50)));
  const offset = Math.min(10000, Math.max(0, Math.trunc(page.offset ?? 0)));
  const filter = page.filter || 'all';
  return request<T>(`/api/tender-opportunities?filter=${encodeURIComponent(filter)}&limit=${limit}&offset=${offset}`);
}

export async function loadProfiles<T>(request: TenderRequest): Promise<T> {
  return request<T>('/api/tender-search-profiles');
}

export async function loadCompanyProfile<T>(request: TenderRequest): Promise<T> {
  return request<T>('/api/tender-company-profile');
}

export async function loadCompanyProcurementDocuments(request: TenderRequest): Promise<import('./types').TenderCompanyDocument[]> {
  return request<import('./types').TenderCompanyDocument[]>('/api/tender-company-documents');
}

export async function loadTenderGoNoGoDecision(request: TenderRequest, opportunityId: string): Promise<TenderGoNoGoPayload> {
  return request<TenderGoNoGoPayload>(`/api/tender-go-no-go-decision?id=${encodeURIComponent(opportunityId)}`);
}

export async function recordTenderGoNoGoDecision(request: TenderRequest, input: TenderGoNoGoDecisionInput): Promise<TenderGoNoGoPostPayload> {
  return request<TenderGoNoGoPostPayload>('/api/tender-go-no-go-decision', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function loadTenderOfferStatus(request: TenderRequest, opportunityId: string): Promise<TenderOfferStatusPayload> {
  return request<TenderOfferStatusPayload>(`/api/tender-offer-status?id=${encodeURIComponent(opportunityId)}`);
}

export async function recordTenderOfferStatusTransition(request: TenderRequest, input: TenderOfferStatusTransitionInput): Promise<{ status: import('./types').TenderOfferStatus; event: import('./types').TenderOfferStatusTransition }> {
  return request('/api/tender-offer-status', { method: 'POST', body: JSON.stringify(input) });
}

export async function loadTenderDossierWorkspace(request: TenderRequest, opportunityId: string): Promise<TenderDossierWorkspace> {
  return request<TenderDossierWorkspace>(`/api/tender-dossier-workspace?id=${encodeURIComponent(opportunityId)}`);
}

export async function createTenderDossierItem(request: TenderRequest, input: {
  opportunity_id: string; item_key?: string; title: string; item_type: string; required: boolean;
}): Promise<{ item: TenderDossierItem }> {
  return request('/api/tender-dossier-item', { method: 'POST', body: JSON.stringify(input) });
}

export async function appendTenderDossierItemAction(request: TenderRequest, input: TenderDossierItemActionInput): Promise<{ item: TenderDossierItem }> {
  return request('/api/tender-dossier-item-action', { method: 'POST', body: JSON.stringify(input) });
}

export async function createTenderDossierArtifact(request: TenderRequest, input: {
  opportunity_id: string; artifact_key?: string; title: string; required: boolean;
}): Promise<{ artifact: TenderDossierArtifact }> {
  return request('/api/tender-dossier-artifact', { method: 'POST', body: JSON.stringify(input) });
}

export async function addTenderDossierArtifactVersion(request: TenderRequest, input: {
  opportunity_id: string; artifact_id: string; content_kind: 'markdown' | 'texto' | 'metadata';
  content_text?: string | null; content_metadata?: Record<string, unknown> | null;
}): Promise<{ artifact: TenderDossierArtifact; version_id: string }> {
  return request('/api/tender-dossier-artifact-version', { method: 'POST', body: JSON.stringify(input) });
}

export async function recordTenderDossierArtifactReview(request: TenderRequest, input: {
  opportunity_id: string; version_id: string; decision: 'aprobado' | 'rechazado'; comment?: string | null;
}): Promise<{ artifact: TenderDossierArtifact }> {
  return request('/api/tender-dossier-artifact-review', { method: 'POST', body: JSON.stringify(input) });
}

export async function seedTenderDossier(request: TenderRequest, opportunityId: string): Promise<TenderDossierWorkspace> {
  return request('/api/tender-dossier-seed', { method: 'POST', body: JSON.stringify({ opportunity_id: opportunityId }) });
}

export async function loadTenderDossierWorkbench(request: TenderRequest, opportunityId: string): Promise<TenderDossierWorkbench> {
  return request<TenderDossierWorkbench>(`/api/tender-dossier-workbench?id=${encodeURIComponent(opportunityId)}`);
}

export async function postTenderDossierWorkbenchMessage(request: TenderRequest, input: TenderDossierWorkbenchMessageInput): Promise<unknown> {
  return request('/api/tender-dossier-workbench/messages', { method: 'POST', body: JSON.stringify(input) });
}

export async function retryTenderDossierWorkbenchJob(request: TenderRequest, input: TenderDossierWorkbenchRetryInput): Promise<unknown> {
  return request('/api/tender-dossier-workbench/jobs/retry', { method: 'POST', body: JSON.stringify(input) });
}

export async function reviewTenderDossierWorkbenchLearning(request: TenderRequest, input: TenderDossierWorkbenchLearningReviewInput): Promise<unknown> {
  return request('/api/tender-dossier-workbench/learning/review', { method: 'POST', body: JSON.stringify(input) });
}
