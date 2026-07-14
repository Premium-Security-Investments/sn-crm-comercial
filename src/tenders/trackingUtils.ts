export type TrackingFilter = {
  status: string;
  owner: string;
  semaphore: 'todas' | 'verde' | 'amarillo' | 'rojo';
};

type TrackableTender = {
  tracking_status?: string | null;
  tracking_owner_id?: string | null;
  tracking_blocker?: string | null;
  tracking_due_at?: string | null;
};

export function daysSince(value?: string | null, now = new Date()): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((now.getTime() - timestamp) / 86_400_000));
}

export function trackingSemaphore(row: TrackableTender, now = new Date()): TrackingFilter['semaphore'] {
  if (row.tracking_status === 'bloqueado' || row.tracking_blocker) return 'rojo';
  if (!row.tracking_due_at) return 'amarillo';
  const due = new Date(row.tracking_due_at).getTime();
  if (!Number.isFinite(due)) return 'amarillo';
  return due < now.getTime() ? 'rojo' : due - now.getTime() <= 3 * 86_400_000 ? 'amarillo' : 'verde';
}

export function matchesTrackingFilter(row: TrackableTender, filter: TrackingFilter, now = new Date()): boolean {
  return (filter.status === 'todas' || row.tracking_status === filter.status)
    && (filter.owner === 'todas' || row.tracking_owner_id === filter.owner)
    && (filter.semaphore === 'todas' || trackingSemaphore(row, now) === filter.semaphore);
}
