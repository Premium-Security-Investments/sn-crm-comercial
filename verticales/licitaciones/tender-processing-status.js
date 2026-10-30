export function isTenderProcessingJobSuperseded(jobSnapshotId, latestSnapshotId) {
  return Boolean(jobSnapshotId && latestSnapshotId && jobSnapshotId !== latestSnapshotId);
}
