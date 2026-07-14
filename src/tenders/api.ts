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

/**
 * Dossiers remain part of the current radar payload until their dedicated
 * endpoint is introduced; naming the loader keeps that migration explicit.
 */
export async function loadDossiers<T>(request: TenderRequest): Promise<T> {
  return request<T>('/api/tenders');
}

export async function loadProfiles<T>(request: TenderRequest): Promise<T> {
  return request<T>('/api/tender-search-profiles');
}
