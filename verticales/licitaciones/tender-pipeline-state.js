export const PIPELINE_STATES = new Set([
  'queued', 'discovering_documents', 'importing_documents', 'retry_wait', 'needs_attention',
  'ready_for_snapshot', 'snapshot_ready', 'awaiting_analysis_authorization', 'waiting_agent_capacity',
  'analyzing', 'completed', 'cancelled',
]);

const TERMINAL_STATES = new Set(['completed', 'cancelled']);

const TRANSITIONS = new Map([
  ['queued:discover', 'discovering_documents'],
  ['discovering_documents:import', 'importing_documents'],
  ['importing_documents:retry', 'retry_wait'],
  ['retry_wait:resume', 'importing_documents'],
  ['importing_documents:exhausted', 'needs_attention'],
  ['importing_documents:usable', 'ready_for_snapshot'],
  ['ready_for_snapshot:published', 'snapshot_ready'],
  ['snapshot_ready:unauthorized', 'awaiting_analysis_authorization'],
  ['snapshot_ready:authorized', 'waiting_agent_capacity'],
  ['awaiting_analysis_authorization:authorized', 'waiting_agent_capacity'],
  ['waiting_agent_capacity:capacity', 'analyzing'],
  ['analyzing:busy', 'waiting_agent_capacity'],
  ['analyzing:ai_run', 'completed'],
  ['analyzing:exhausted', 'needs_attention'],
]);

export function isTerminalState(state) {
  return TERMINAL_STATES.has(state);
}

export function nextPipelineState(current, event) {
  if (event === 'cancel') {
    return isTerminalState(current) ? undefined : 'cancelled';
  }
  return TRANSITIONS.get(`${current}:${event}`);
}

export function assertValidTransition(current, event) {
  const next = nextPipelineState(current, event);
  if (!next) {
    throw new Error(`transición inválida: ${current} + ${event}`);
  }
  return next;
}
