import { strict as assert } from 'node:assert';
import { ANALYSIS_FLAG_NAMES, buildAgt002AnalysisConfig } from '../agt002-analysis-config.js';

assert.ok(ANALYSIS_FLAG_NAMES.includes('AGT002_RADAR_GATE'));
assert.ok(ANALYSIS_FLAG_NAMES.includes('AGT002_RADAR_VISIBILITY'));
assert.equal(buildAgt002AnalysisConfig({}).AGT002_RADAR_GATE, false);
assert.equal(buildAgt002AnalysisConfig({}).AGT002_RADAR_VISIBILITY, false);
assert.equal(buildAgt002AnalysisConfig({ AGT002_RADAR_GATE: 'TRUE' }).AGT002_RADAR_GATE, true);
assert.equal(buildAgt002AnalysisConfig({ AGT002_RADAR_GATE: ' 1 ' }).AGT002_RADAR_GATE, true);
for (const value of ['yes', 'on', '2', '', 'false', 'null']) {
  assert.equal(buildAgt002AnalysisConfig({ AGT002_RADAR_GATE: value }).AGT002_RADAR_GATE, false);
}
assert.throws(
  () => buildAgt002AnalysisConfig({ AGT002_RADAR_VISIBILITY: 'true' }),
  /AGT002_RADAR_VISIBILITY requires AGT002_RADAR_GATE/,
);
assert.equal(buildAgt002AnalysisConfig({ AGT002_RADAR_GATE: 'true', AGT002_RADAR_VISIBILITY: 'true' }).AGT002_RADAR_VISIBILITY, true);
assert.equal(buildAgt002AnalysisConfig({ AGT002_RADAR_GATE: 'true' }).AGT002_CONTEXT_V2, false);
assert.throws(() => buildAgt002AnalysisConfig({ AGT002_DOCUMENT_RETRIEVAL: 'true' }), /AGT002_CONTEXT_V2/);

console.log('AGT-002 Radar rollout flags are canonical, fail-closed, and off by default');
