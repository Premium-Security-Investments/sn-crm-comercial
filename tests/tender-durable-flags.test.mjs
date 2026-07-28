import { strict as assert } from 'node:assert';
import {
  isTenderDurablePipelineEnabled,
  isTenderPublicUiEnabled,
  isTenderAutoAnalysisEnabled,
} from '../tender-durable-flags.js';

function run() {
  assert.equal(isTenderDurablePipelineEnabled({}), false);
  assert.equal(isTenderDurablePipelineEnabled({ TENDER_DURABLE_PIPELINE: 'on' }), true);
  assert.equal(isTenderDurablePipelineEnabled({ TENDER_DURABLE_PIPELINE: 'true' }), false);
  assert.equal(isTenderDurablePipelineEnabled({ TENDER_DURABLE_PIPELINE: '1' }), false);

  assert.equal(isTenderPublicUiEnabled({}), false);
  assert.equal(isTenderPublicUiEnabled({ TENDER_PUBLIC_UI: 'on' }), true);
  assert.equal(isTenderPublicUiEnabled({ TENDER_PUBLIC_UI: 'true' }), false);

  assert.equal(isTenderAutoAnalysisEnabled({}), false);
  assert.equal(isTenderAutoAnalysisEnabled({ TENDER_AUTO_ANALYSIS: 'on' }), true);
  assert.equal(isTenderAutoAnalysisEnabled({ TENDER_AUTO_ANALYSIS: '1' }), false);

  console.log('tender-durable-flags passed');
}
run();
