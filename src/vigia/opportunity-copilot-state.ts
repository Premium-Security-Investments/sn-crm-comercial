export type CopilotProfile = {
  active?: boolean;
  identity_type?: string | null;
  permissions?: string[];
};

export type CopilotFact = { text: string; evidence_refs: string[] };
export type CopilotInference = { text: string; evidence_refs: string[]; confidence: 'low' | 'medium' | 'high' };
export type CopilotBrief = {
  summary: string;
  facts: CopilotFact[];
  inferences: CopilotInference[];
  missing_information: string[];
  contact_objective: string;
  strategy: string;
  draft: { subject: string; body: string };
  recommended_asset_ids: string[];
  warnings: string[];
  human_review_required: true;
};
export type CopilotResult = {
  run_id: string;
  status: string;
  human_review_required: true;
  output: { brief: CopilotBrief };
};

type CopilotBase = { opportunityId: string; sequence: number };
export type OpportunityCopilotState =
  | (CopilotBase & { phase: 'idle' })
  | (CopilotBase & { phase: 'loading'; requestId: number })
  | (CopilotBase & { phase: 'ready'; requestId: number; result: CopilotResult; draft: { subject: string; body: string } })
  | (CopilotBase & { phase: 'error'; requestId: number; message: string });

export function canRenderOpportunityCopilot(profile: CopilotProfile | null | undefined, serviceTypeCode: string | null | undefined) {
  if (!profile?.active || profile.identity_type === 'agent' || serviceTypeCode === 'licitacion_publica') return false;
  const permissions = new Set(profile.permissions || []);
  return permissions.has('modulo_vig_ia')
    && permissions.has('modulo_oportunidades')
    && permissions.has('vigia_copilot_pilot');
}

export function createOpportunityCopilotState(opportunityId: string): OpportunityCopilotState {
  return { phase: 'idle', opportunityId, sequence: 0 };
}

export function changeCopilotOpportunity(state: OpportunityCopilotState, opportunityId: string): OpportunityCopilotState {
  return { phase: 'idle', opportunityId, sequence: state.sequence + 1 };
}

export function beginCopilotGeneration(state: OpportunityCopilotState, explicitRequestId?: number) {
  const requestId = explicitRequestId ?? state.sequence + 1;
  return { requestId, state: { phase: 'loading', opportunityId: state.opportunityId, sequence: Math.max(state.sequence + 1, requestId), requestId } as OpportunityCopilotState };
}

export function completeCopilotGeneration(state: OpportunityCopilotState, event: { opportunityId: string; requestId: number; result: CopilotResult }): OpportunityCopilotState {
  if (state.phase !== 'loading' || state.opportunityId !== event.opportunityId || state.requestId !== event.requestId) return state;
  return {
    phase: 'ready', opportunityId: state.opportunityId, sequence: state.sequence, requestId: event.requestId,
    result: event.result,
    draft: { ...event.result.output.brief.draft },
  };
}

export function failCopilotGeneration(state: OpportunityCopilotState, event: { opportunityId: string; requestId: number; message: string }): OpportunityCopilotState {
  if (state.phase !== 'loading' || state.opportunityId !== event.opportunityId || state.requestId !== event.requestId) return state;
  return { phase: 'error', opportunityId: state.opportunityId, sequence: state.sequence, requestId: event.requestId, message: event.message };
}

export function editCopilotDraft(state: OpportunityCopilotState, patch: Partial<{ subject: string; body: string }>): OpportunityCopilotState {
  if (state.phase !== 'ready') return state;
  return { ...state, draft: { ...state.draft, ...patch } };
}

export function discardCopilotDraft(state: OpportunityCopilotState): OpportunityCopilotState {
  return { phase: 'idle', opportunityId: state.opportunityId, sequence: state.sequence + 1 };
}
