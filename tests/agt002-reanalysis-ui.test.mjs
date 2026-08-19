import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AGT002_REANALYSIS_MAX_POLLS, classifyAgt002ReanalysisPoll } from '../src/tenders/agt002ReanalysisPolling.ts';

assert.ok(Number.isInteger(AGT002_REANALYSIS_MAX_POLLS) && AGT002_REANALYSIS_MAX_POLLS > 0 && AGT002_REANALYSIS_MAX_POLLS <= 200);
assert.deepEqual(classifyAgt002ReanalysisPoll('queued', false), { terminal: false, shouldReload: false, tone: 'status' });
assert.deepEqual(classifyAgt002ReanalysisPoll('running', false), { terminal: false, shouldReload: false, tone: 'status' });
assert.deepEqual(classifyAgt002ReanalysisPoll('completed', false), { terminal: true, shouldReload: true, tone: 'status' });
assert.deepEqual(classifyAgt002ReanalysisPoll('completed', true), { terminal: true, shouldReload: false, tone: 'status' });
assert.deepEqual(classifyAgt002ReanalysisPoll('unavailable', false), { terminal: true, shouldReload: false, tone: 'error' });
assert.throws(() => classifyAgt002ReanalysisPoll('mystery', false), /estado/i);

const root = path.resolve(import.meta.dirname, '..');
const main = fs.readFileSync(path.join(root, 'src/main.tsx'), 'utf8');
assert.match(main, /agt002ReanalysisPolling/);
assert.match(main, /reanalysisAbortRef/);
assert.match(main, /reanalysisAbortRef\.current\?\.abort\(\)/);
assert.match(main, /activeReanalysisJobId/);
assert.match(main, /reloadedReanalysisJobRef/);
assert.match(main, /AGT002_REANALYSIS_MAX_POLLS/);
assert.match(main, /classifyAgt002ReanalysisPoll/);
assert.match(main, /busy=\{busy \|\| Boolean\(activeReanalysisJobId\)\}/);

const postCount = (main.match(/tender-documents-analyze-agent-preview/g) || []).length;
assert.equal(postCount, 1, 'polling must never resubmit the analysis POST');
assert.match(main, /\/api\/agt002-reanalysis-status\?opportunity_id=/);

console.log('AGT-002 finite cancellable UI polling contract passed');
