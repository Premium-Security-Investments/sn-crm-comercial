import type { TenderRequest, TenderTrackingEvent, TenderTrackingUpdate } from './types';

/** Explicit resource loaders: each tender view owns only the data it needs. */
export async function loadRadar<T>(request: TenderRequest): Promise<T> {
  return request<T>('/api/tenders');
}

export async function loadTracking<T>(request: TenderRequest): Promise<T> {
  return request<T>('/api/tender-tracking');
}

export async function loadTrackingEvents(request: TenderRequest, tenderId: string): Promise<TenderTrackingEvent[]> {
  return request<TenderTrackingEvent[]>(`/api/tender-tracking-events?id=${encodeURIComponent(tenderId)}`);
}

export async function updateTracking<T>(request: TenderRequest, update: TenderTrackingUpdate): Promise<T> {
  return request<T>('/api/tender-tracking-update', { method: 'POST', body: JSON.stringify(update) });
}

export async function enterTrackingFromRadar<T = Record<string, unknown>>(request: TenderRequest, stableKey: string): Promise<T> {
  const id = String(stableKey || '').trim();
  if (!id) throw new Error('Debe indicar la licitación.');
  return request<T>(`/api/tender-status?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ internal_status: 'en_revision' }),
  });
}

export type TenderDossierPage = { limit?: number; offset?: number };
export async function loadDossiers<T>(request: TenderRequest, page: TenderDossierPage = {}): Promise<T> {
  const limit = Math.min(100, Math.max(1, Math.trunc(page.limit ?? 50)));
  const offset = Math.min(10000, Math.max(0, Math.trunc(page.offset ?? 0)));
  return request<T>(`/api/tender-dossiers?limit=${limit}&offset=${offset}`);
}

export async function loadProfiles<T>(request: TenderRequest): Promise<T> {
  return request<T>('/api/tender-search-profiles');
}

export async function loadCompanyProfile<T>(request: TenderRequest): Promise<T> {
  return request<T>('/api/tender-company-profile');
}
