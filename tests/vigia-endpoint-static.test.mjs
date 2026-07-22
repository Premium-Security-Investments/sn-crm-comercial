import fs from 'node:fs';
import assert from 'node:assert/strict';

const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const vercel = fs.readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const backendTest = fs.readFileSync(new URL('./backend-module-guards.test.mjs', import.meta.url), 'utf8');

for (const [name, source] of [['server', server], ['vercel', vercel]]) {
  assert.ok(source.includes('prioritizeVigiaOpportunities'), `${name} imports deterministic Vig-IA engine`);
  assert.ok(source.includes("vigia: ACTIONS.MODULE_VIGIA_VIEW"), `${name} protects Vig-IA as a module family`);
  assert.ok(source.includes("'GET /api/vigia/priorities': ['vigia', ACTIONS.MODULE_VIGIA_VIEW]"), `${name} inventories Vig-IA endpoint`);
  assert.ok(source.includes("app.get('/api/vigia/priorities'"), `${name} exposes dedicated endpoint`);
  assert.ok(source.includes('VIGIA_OPPORTUNITY_SELECT'), `${name} uses an explicit allowlist`);
  assert.ok(source.includes("expected_close_date';"), `${name} keeps the view allowlist compatible with the deployed schema`);
  assert.ok(source.includes("from('psi_sales_opportunities').select('id,customer_segment')"), `${name} reads customer segment explicitly from the base table`);
  assert.ok(source.includes('requirePrioritiesAction(currentProfile)'), `${name} checks inherited Prioridades modules before CRM read`);
  const routeStart = source.indexOf("app.get('/api/vigia/priorities'");
  const route = source.slice(routeStart, source.indexOf("app.get('/api/bootstrap'", routeStart));
  assert.ok(route.indexOf('requirePrioritiesAction(currentProfile)') < route.indexOf('resolveVigiaOwnerScope(database, currentProfile)'), `${name} checks module before scope resolution`);
  assert.ok(route.indexOf('resolveVigiaOwnerScope(database, currentProfile)') < route.indexOf('fetchVigiaRows(database, ownerIds)'), `${name} resolves scope before reading CRM rows`);
  assert.ok(source.includes("app.all('/api/vigia/priorities'"), `${name} rejects non-GET methods`);
  assert.ok(source.includes("app.all('/api/bootstrap'"), `${name} rejects non-GET bootstrap methods`);
  assert.ok(!route.includes("select('*')"), `${name} endpoint never selects all columns`);
  assert.ok(!route.includes('psi_public_tenders'), `${name} endpoint does not mix tenders`);
}
assert.ok(backendTest.includes('alertsOnly') && backendTest.includes('vigiaOnly'), 'backend guard suite covers both inherited Prioridades modules');
console.log('vigia endpoint static security contract passed');
