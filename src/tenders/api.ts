import type { TenderRequest } from './types';

/** Explicit resource loaders for future isolated tender views. */
export async function loadRadar<T>(request: TenderRequest): Promise<T> {
  return request<T>('/api/tenders');
}

export async function loadTracking<T>(request: TenderRequest): Promise<T> {
  return request<T>('/api/tender-tracking');
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
