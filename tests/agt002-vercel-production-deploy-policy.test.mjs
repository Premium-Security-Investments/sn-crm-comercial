import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const gitignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
const envExample = readFileSync(new URL('../.env.local.example', import.meta.url), 'utf8');
const script = readFileSync(new URL('../scripts/agt002-deploy-vercel-production.sh', import.meta.url), 'utf8');
const runbook = readFileSync(new URL('../docs/runbooks/agt002-vercel-production-deploy.md', import.meta.url), 'utf8');

const WORKTREE = '/root/worktrees/siio-e6-scheduler-fix';
const CONTROL_PLANE_URL = 'https://seguridad-nacional-crm.vercel.app/api/agt002/control-plane';

test('the repository records the one manual AGT-002 production deployment path', () => {
  assert.match(runbook, new RegExp(WORKTREE.replaceAll('/', '\\/')));
  assert.match(runbook, /HEAD == origin\/main/);
  assert.match(runbook, /scripts\/agt002-deploy-vercel-production\.sh/);
  assert.match(runbook, /Never run `vercel --prod` directly/);
  assert.match(script, new RegExp(WORKTREE.replaceAll('/', '\\/')));
  assert.match(script, /never invoke `vercel --prod` directly/);
});

test('the public production control-plane URL is documented and explicitly passed', () => {
  assert.match(envExample, new RegExp(`AGT002_VERCEL_PRODUCTION_CONTROL_PLANE_URL=${CONTROL_PLANE_URL.replaceAll('/', '\\/')}`));
  assert.match(runbook, new RegExp(CONTROL_PLANE_URL.replaceAll('/', '\\/')));
  assert.match(runbook, /AGT002_VERCEL_PRODUCTION_CONTROL_PLANE_URL=https:/);
});

test('Python cache directories are ignored repository-wide', () => {
  assert.match(gitignore, /^__pycache__\/$/m);
});
