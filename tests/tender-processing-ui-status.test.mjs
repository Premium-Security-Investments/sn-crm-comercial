import assert from 'node:assert/strict';
import { isTenderProcessingActive, shouldReloadTenderArtifacts, tenderProcessingLabel } from '../src/tenders/processingStatus.ts';

const status = (value, jobId = 'job-1') => ({ job_id: jobId, status: value });

assert.equal(isTenderProcessingActive('queued'), true);
assert.equal(isTenderProcessingActive('waiting_agent_capacity'), true);
assert.equal(isTenderProcessingActive('retry_wait'), true);
assert.equal(isTenderProcessingActive('needs_attention'), false);
assert.equal(isTenderProcessingActive('completed'), false);
assert.equal(isTenderProcessingActive('no_job'), false);

assert.equal(shouldReloadTenderArtifacts(null, status('completed'), null), false, 'initial load already fetches persisted artifacts');
assert.equal(shouldReloadTenderArtifacts(status('analyzing'), status('completed'), null), true);
assert.equal(shouldReloadTenderArtifacts(status('analyzing'), status('completed'), 'job-1'), false, 'same job reloads once');
assert.equal(shouldReloadTenderArtifacts(status('analyzing', 'job-2'), status('completed', 'job-2'), 'job-1'), true, 'a new job may reload after its own transition');
assert.equal(shouldReloadTenderArtifacts(status('analyzing'), status('completed', 'job-2'), null), false, 'different jobs are not a transition');
assert.equal(shouldReloadTenderArtifacts(status('completed'), status('completed'), null), false);

assert.match(tenderProcessingLabel('queued'), /En cola/);
assert.match(tenderProcessingLabel('waiting_agent_capacity'), /Vig-IA/);
assert.match(tenderProcessingLabel('needs_attention'), /intervención humana/);
assert.match(tenderProcessingLabel('completed'), /completado/);
assert.match(tenderProcessingLabel('unknown_state'), /unknown_state/);

console.log('tender processing UI status helper contract passed');
