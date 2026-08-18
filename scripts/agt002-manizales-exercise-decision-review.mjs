import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { deriveAgt002ManizalesExerciseDecisionReview } from '../agt002-manizales-exercise-decision-review.js';
import { deriveAgt002ManizalesUnresolvedManifestEntries } from '../agt002-manizales-manifest-wiring.js';
import { selectAgt002ManizalesManifestSource } from '../agt002-manizales-manifest-source.js';
import {
  AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID,
  AGT002_INTEGRAL_MANIFEST_PROCESO,
} from '../agt002-manizales-integral-manifest.js';
import { runAgt002ManizalesV3LocalRun } from './agt002-manizales-v3-local-run.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const fixture = JSON.parse(readFileSync(
  resolve(ROOT, 'tests/fixtures/agt002-manizales-exercise-decision-review.v1.json'),
  'utf8',
));
const registry = JSON.parse(readFileSync(
  resolve(ROOT, 'docs/governance/registro/manizales-sa-24-2026.registry.json'),
  'utf8',
));

const registryIndex = new Map();
for (const item of registry.items) {
  for (const subItem of item.sub_items || []) {
    registryIndex.set(subItem.sub_item_id, {
      item_ref: item.ref,
      char_start: subItem.cite.char_start,
    });
  }
}

const manifestSource = selectAgt002ManizalesManifestSource({
  integralContractV3: true,
  opportunityId: AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID,
  process: AGT002_INTEGRAL_MANIFEST_PROCESO,
});
const manifestUnresolvedRequirementIds = new Set(
  deriveAgt002ManizalesUnresolvedManifestEntries(manifestSource)
    .map(entry => entry.requirement_id),
);

const run = await runAgt002ManizalesV3LocalRun();
const integralAnalysis = run.envelope.integral_analysis;
const canonicalUnitIds = new Set(
  integralAnalysis.analysis_units.map(unit => unit.requirement_id),
);

const review = deriveAgt002ManizalesExerciseDecisionReview(integralAnalysis, fixture, {
  canonicalUnitIds,
  manifestUnresolvedRequirementIds,
  registryIndex,
});

process.stdout.write(`${JSON.stringify(review, null, 2)}\n`);
