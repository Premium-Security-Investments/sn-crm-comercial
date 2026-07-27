import { strict as assert } from 'node:assert';
import {
  PIPELINE_STATES,
  nextPipelineState,
  assertValidTransition,
  isTerminalState,
} from '../tender-pipeline-state.js';

// Transiciones normativas (spec §7).
assert.equal(nextPipelineState('queued', 'discover'), 'discovering_documents');
assert.equal(nextPipelineState('discovering_documents', 'import'), 'importing_documents');
assert.equal(nextPipelineState('importing_documents', 'retry'), 'retry_wait');
assert.equal(nextPipelineState('retry_wait', 'resume'), 'importing_documents');
assert.equal(nextPipelineState('importing_documents', 'exhausted'), 'needs_attention');
assert.equal(nextPipelineState('importing_documents', 'usable'), 'ready_for_snapshot');
assert.equal(nextPipelineState('ready_for_snapshot', 'published'), 'snapshot_ready');
assert.equal(nextPipelineState('snapshot_ready', 'unauthorized'), 'awaiting_analysis_authorization');
assert.equal(nextPipelineState('snapshot_ready', 'authorized'), 'waiting_agent_capacity');
assert.equal(nextPipelineState('awaiting_analysis_authorization', 'authorized'), 'waiting_agent_capacity');
assert.equal(nextPipelineState('waiting_agent_capacity', 'capacity'), 'analyzing');
assert.equal(nextPipelineState('analyzing', 'busy'), 'waiting_agent_capacity');
assert.equal(nextPipelineState('analyzing', 'ai_run'), 'completed');
assert.equal(nextPipelineState('analyzing', 'exhausted'), 'needs_attention');

// Cancelación desde cualquier estado no terminal.
for (const state of PIPELINE_STATES) {
  if (isTerminalState(state)) continue;
  assert.equal(nextPipelineState(state, 'cancel'), 'cancelled');
}

// Transición inválida lanza.
assert.throws(() => assertValidTransition('completed', 'discover'), /transición inválida/);
assert.throws(() => assertValidTransition('cancelled', 'cancel'), /transición inválida/);

// Un evento de preanálisis por reglas nunca completa el pipeline.
assert.notEqual(nextPipelineState('analyzing', 'rules_shown'), 'completed');

// Estados terminales.
assert.equal(isTerminalState('completed'), true);
assert.equal(isTerminalState('cancelled'), true);
assert.equal(isTerminalState('analyzing'), false);

console.log('tender-pipeline-state contract passed');
