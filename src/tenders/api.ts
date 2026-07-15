import type { TenderRequest, TenderTrackingEvent, TenderTrackingUpdate } from './types';

/** Explicit resource loaders for future isolated tender views. */
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

export type TenderDossierPage = { limit?: number; offset?: number };

/** Dedicated, bounded dossier API loader for the future expediente view. */
export async function loadDossiers<T>(request: TenderRequest, page: TenderDossierPage = {}): Promise<T> {
  const limit = Math.min(100, Math.max(1, Math.trunc(page.limit ?? 50)));
  const offset = Math.min(10000, Math.max(0, Math.trunc(page.offset ?? 0)));
  return request<T>(`/api/tender-dossiers?limit=${limit}&offset=${offset}`);
}

export async function loadProfiles<T>(request: TenderRequest): Promise<T> {
  return request<T>('/api/tender-search-profiles');
}
