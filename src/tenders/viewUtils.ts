export function dossierPageQuery(page: number, limit: number) {
  const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit) || 50));
  const safePage = Math.max(1, Math.trunc(page) || 1);
  return { limit: safeLimit, offset: (safePage - 1) * safeLimit };
}

export function profileRadarHash(profileId: string) {
  return `#/tenders?view=radar&profile=${encodeURIComponent(profileId)}`;
}
