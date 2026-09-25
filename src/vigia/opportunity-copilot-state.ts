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
  draft: { subject: string | null; body: string };
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

export type ContactChannel = 'whatsapp' | 'email';
export type CopilotPreparation = { contactChannel: ContactChannel | null; commercialIntent: string };

type CopilotBase = { opportunityId: string; sequence: number; preparation: CopilotPreparation };
export type OpportunityCopilotState =
  | (CopilotBase & { phase: 'idle' })
  | (CopilotBase & { phase: 'loading'; requestId: number })
  | (CopilotBase & { phase: 'ready'; requestId: number; result: CopilotResult; draft: { subject: string | null; body: string } })
  | (CopilotBase & { phase: 'error'; requestId: number; message: string });

export function canRenderOpportunityCopilot(profile: CopilotProfile | null | undefined, serviceTypeCode: string | null | undefined) {
  if (!profile?.active || profile.identity_type === 'agent' || serviceTypeCode === 'licitacion_publica') return false;
  const permissions = new Set(profile.permissions || []);
  return permissions.has('modulo_vig_ia')
    && permissions.has('modulo_oportunidades')
    && permissions.has('vigia_copilot_pilot');
}

export function emptyPreparation(): CopilotPreparation {
  return { contactChannel: null, commercialIntent: '' };
}

function withPreparation<T extends object>(state: T, preparation: CopilotPreparation): T & { preparation: CopilotPreparation } {
  return { ...state, preparation: { ...preparation } };
}

export function createOpportunityCopilotState(opportunityId: string): OpportunityCopilotState {
  return { phase: 'idle', opportunityId, sequence: 0, preparation: emptyPreparation() };
}

export function setCopilotContactChannel(state: OpportunityCopilotState, channel: ContactChannel): OpportunityCopilotState {
  if (channel !== 'whatsapp' && channel !== 'email') {
    throw new Error('Canal de contacto (contact_channel) inválido: debe ser whatsapp o email');
  }
  return withPreparation(state, { ...state.preparation, contactChannel: channel });
}

export function setCopilotCommercialIntent(state: OpportunityCopilotState, value: unknown): OpportunityCopilotState {
  const commercialIntent = String(value).trim().slice(0, 500);
  return withPreparation(state, { ...state.preparation, commercialIntent });
}

export function canGenerateCopilotFollowup(state: OpportunityCopilotState): boolean {
  return state.preparation.contactChannel === 'whatsapp' || state.preparation.contactChannel === 'email';
}

export function changeCopilotPreparation(state: OpportunityCopilotState): OpportunityCopilotState {
  return withPreparation(
    { phase: 'idle', opportunityId: state.opportunityId, sequence: state.sequence + 1 },
    state.preparation,
  );
}

export function copilotClipboardPayload(state: OpportunityCopilotState) {
  if (state.phase !== 'ready') {
    throw new Error('copilotClipboardPayload requiere phase "ready"');
  }
  const { body, subject } = state.draft;
  if (state.preparation.contactChannel === 'email') {
    return { channel: 'email' as const, subject, body, text: `${subject ?? ''}\n\n${body}` };
  }
  return { channel: 'whatsapp' as const, subject: null, body, text: body };
}

export function changeCopilotOpportunity(state: OpportunityCopilotState, opportunityId: string): OpportunityCopilotState {
  return withPreparation({ phase: 'idle', opportunityId, sequence: state.sequence + 1 }, emptyPreparation());
}

export function beginCopilotGeneration(state: OpportunityCopilotState, explicitRequestId?: number) {
  if (!canGenerateCopilotFollowup(state)) {
    throw new Error('Debe seleccionar un canal de contacto (contact_channel) antes de generar');
  }
  const requestId = explicitRequestId ?? state.sequence + 1;
  const nextState = withPreparation(
    { phase: 'loading', opportunityId: state.opportunityId, sequence: Math.max(state.sequence + 1, requestId), requestId },
    state.preparation,
  );
  return { requestId, state: nextState as OpportunityCopilotState };
}

export function completeCopilotGeneration(state: OpportunityCopilotState, event: { opportunityId: string; requestId: number; result: CopilotResult }): OpportunityCopilotState {
  if (state.phase !== 'loading' || state.opportunityId !== event.opportunityId || state.requestId !== event.requestId) return state;
  return withPreparation(
    {
      phase: 'ready', opportunityId: state.opportunityId, sequence: state.sequence, requestId: event.requestId,
      result: event.result,
      draft: { ...event.result.output.brief.draft },
    },
    state.preparation,
  );
}

export function failCopilotGeneration(state: OpportunityCopilotState, event: { opportunityId: string; requestId: number; message: string }): OpportunityCopilotState {
  if (state.phase !== 'loading' || state.opportunityId !== event.opportunityId || state.requestId !== event.requestId) return state;
  return withPreparation(
    { phase: 'error', opportunityId: state.opportunityId, sequence: state.sequence, requestId: event.requestId, message: event.message },
    state.preparation,
  );
}

export function editCopilotDraft(state: OpportunityCopilotState, patch: Partial<{ subject: string | null; body: string }>): OpportunityCopilotState {
  if (state.phase !== 'ready') return state;
  return { ...state, draft: { ...state.draft, ...patch } };
}

export function discardCopilotDraft(state: OpportunityCopilotState): OpportunityCopilotState {
  return withPreparation({ phase: 'idle', opportunityId: state.opportunityId, sequence: state.sequence + 1 }, state.preparation);
}
