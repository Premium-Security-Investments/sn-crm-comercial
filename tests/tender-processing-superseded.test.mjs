import assert from 'node:assert/strict';

import { isTenderProcessingJobSuperseded } from '../tender-processing-status.js';

assert.equal(
  isTenderProcessingJobSuperseded('snapshot-old', 'snapshot-current'),
  true,
  'un job ligado a un snapshot anterior debe quedar superado',
);
assert.equal(
  isTenderProcessingJobSuperseded('snapshot-current', 'snapshot-current'),
  false,
  'un job ligado al snapshot vigente no debe quedar superado',
);
assert.equal(
  isTenderProcessingJobSuperseded(null, 'snapshot-current'),
  false,
  'un job sin snapshot comparable no debe inventar supersesión',
);
assert.equal(
  isTenderProcessingJobSuperseded('snapshot-old', null),
  false,
  'sin snapshot vigente no debe inventar supersesión',
);

console.log('tender processing superseded contract passed');