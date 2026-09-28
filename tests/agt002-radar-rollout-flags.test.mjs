import { strict as assert } from 'node:assert';
import { ANALYSIS_FLAG_NAMES, buildAgt002AnalysisConfig } from '../agt002-analysis-config.js';

// The AGT-002 Radar scan is now deterministic and always active when invoked: it no longer reads
// any rollout flag, so AGT002_RADAR_GATE / AGT002_RADAR_VISIBILITY and the dependency between them
// are retired from the canonical flag surface. Nothing else in ANALYSIS_FLAG_NAMES changes.
assert.ok(!ANALYSIS_FLAG_NAMES.includes('AGT002_RADAR_GATE'), 'AGT002_RADAR_GATE debe salir de ANALYSIS_FLAG_NAMES');
assert.ok(!ANALYSIS_FLAG_NAMES.includes('AGT002_RADAR_VISIBILITY'), 'AGT002_RADAR_VISIBILITY debe salir de ANALYSIS_FLAG_NAMES');

// Un flag retirado ya no se parsea: la config ni siquiera declara esa clave.
assert.equal(buildAgt002AnalysisConfig({ AGT002_RADAR_GATE: 'true' }).AGT002_RADAR_GATE, undefined);
assert.equal(buildAgt002AnalysisConfig({}).AGT002_RADAR_GATE, undefined);
assert.equal(Object.prototype.hasOwnProperty.call(buildAgt002AnalysisConfig({}), 'AGT002_RADAR_GATE'), false);
assert.equal(Object.prototype.hasOwnProperty.call(buildAgt002AnalysisConfig({}), 'AGT002_RADAR_VISIBILITY'), false);

// La dependencia entre ambos (AGT002_RADAR_VISIBILITY requería AGT002_RADAR_GATE) también se retiró:
// encender el heredado, solo o combinado, ya no puede lanzar.
assert.doesNotThrow(() => buildAgt002AnalysisConfig({ AGT002_RADAR_VISIBILITY: 'true' }));
assert.doesNotThrow(() => buildAgt002AnalysisConfig({ AGT002_RADAR_VISIBILITY: 'true', AGT002_RADAR_GATE: 'false' }));

// Otros flags no relacionados siguen siendo canónicos, fail-closed y apagados por defecto: la
// retirada de AGT002_RADAR_GATE/VISIBILITY no los toca.
assert.ok(ANALYSIS_FLAG_NAMES.includes('AGT002_CANONICAL_ONLY'));
assert.equal(buildAgt002AnalysisConfig({}).AGT002_CANONICAL_ONLY, false);
assert.equal(buildAgt002AnalysisConfig({ AGT002_CANONICAL_ONLY: 'TRUE' }).AGT002_CANONICAL_ONLY, true);
assert.equal(buildAgt002AnalysisConfig({ AGT002_CANONICAL_ONLY: ' 1 ' }).AGT002_CANONICAL_ONLY, true);
for (const value of ['yes', 'on', '2', '', 'false', 'null']) {
  assert.equal(buildAgt002AnalysisConfig({ AGT002_CANONICAL_ONLY: value }).AGT002_CANONICAL_ONLY, false);
}

console.log('AGT-002 Radar rollout flags: AGT002_RADAR_GATE/VISIBILITY retired, other flags stay canonical and fail-closed');
