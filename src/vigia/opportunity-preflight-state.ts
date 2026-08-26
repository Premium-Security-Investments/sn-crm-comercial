import type { PreflightAction } from './opportunity-preflight-presentation';

export type PreflightResult = { actions: PreflightAction[] };

type PreflightBase = {
  opportunityId: string;
  contextFingerprint: string;
  sequence: number;
};

export type OpportunityPreflightState =
  | (PreflightBase & { phase: 'idle' })
  | (PreflightBase & { phase: 'loading'; requestId: number })
  | (PreflightBase & { phase: 'ready'; requestId: number; result: PreflightResult })
  | (PreflightBase & { phase: 'error'; requestId: number; message: string });

export function createOpportunityPreflightState(
  opportunityId: string,
  contextFingerprint: string,
): OpportunityPreflightState {
  return { phase: 'idle', opportunityId, contextFingerprint, sequence: 0 };
}

export function invalidateStalePreflight(
  state: OpportunityPreflightState,
  opportunityId: string,
  contextFingerprint: string,
): OpportunityPreflightState {
  if (state.opportunityId === opportunityId && state.contextFingerprint === contextFingerprint) return state;
  if (state.phase === 'loading') return state;
  return {
    phase: 'idle',
    opportunityId,
    contextFingerprint,
    sequence: state.sequence + 1,
  };
}

export function beginPreflightAnalysis(
  state: OpportunityPreflightState,
  explicitRequestId?: number,
): { requestId: number; state: OpportunityPreflightState } {
  const requestId = explicitRequestId ?? state.sequence + 1;
  return {
    requestId,
    state: {
      phase: 'loading',
      opportunityId: state.opportunityId,
      contextFingerprint: state.contextFingerprint,
      sequence: Math.max(state.sequence + 1, requestId),
      requestId,
    },
  };
}

export function completePreflightAnalysis(
  state: OpportunityPreflightState,
  event: {
    opportunityId: string;
    requestId: number;
    result: PreflightResult;
    currentContextFingerprint: string;
  },
): OpportunityPreflightState {
  if (
    state.phase !== 'loading'
    || state.opportunityId !== event.opportunityId
    || state.requestId !== event.requestId
  ) return state;

  if (state.contextFingerprint !== event.currentContextFingerprint) {
    return {
      phase: 'idle',
      opportunityId: state.opportunityId,
      contextFingerprint: event.currentContextFingerprint,
      sequence: state.sequence + 1,
    };
  }

  return {
    phase: 'ready',
    opportunityId: state.opportunityId,
    contextFingerprint: state.contextFingerprint,
    sequence: state.sequence,
    requestId: event.requestId,
    result: event.result,
  };
}

export function failPreflightAnalysis(
  state: OpportunityPreflightState,
  event: { opportunityId: string; requestId: number; message: string },
): OpportunityPreflightState {
  if (
    state.phase !== 'loading'
    || state.opportunityId !== event.opportunityId
    || state.requestId !== event.requestId
  ) return state;

  return {
    phase: 'error',
    opportunityId: state.opportunityId,
    contextFingerprint: state.contextFingerprint,
    sequence: state.sequence,
    requestId: event.requestId,
    message: event.message,
  };
}
