export const AGT002_REANALYSIS_MAX_POLLS = 200;
export const AGT002_REANALYSIS_POLL_INTERVAL_MS = 3_000;

export type Agt002ReanalysisPollStatus = 'queued' | 'running' | 'completed' | 'unavailable';

export type Agt002ReanalysisPollDecision = {
  terminal: boolean;
  shouldReload: boolean;
  tone: 'status' | 'error';
};

export function classifyAgt002ReanalysisPoll(status: string, alreadyReloaded: boolean): Agt002ReanalysisPollDecision {
  if (status === 'queued' || status === 'running') {
    return { terminal: false, shouldReload: false, tone: 'status' };
  }
  if (status === 'completed') {
    return { terminal: true, shouldReload: !alreadyReloaded, tone: 'status' };
  }
  if (status === 'unavailable') {
    return { terminal: true, shouldReload: false, tone: 'error' };
  }
  throw new Error('Estado de reanálisis AGT-002 no reconocido.');
}
