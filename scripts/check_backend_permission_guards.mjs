import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const files = ['server/index.js', 'api/[...path].js'];
const siioRoutes = [
  ['GET', '/api/siio/bootstrap'],
  ['GET', '/api/siio/fronts'],
  ['GET', '/api/siio/records'],
  ['POST', '/api/siio/records'],
  ['PATCH', '/api/siio/records/:id'],
  ['GET', '/api/siio/sources'],
  ['POST', '/api/siio/sources'],
  ['GET', '/api/siio/decisions'],
  ['POST', '/api/siio/decisions'],
  ['PATCH', '/api/siio/decisions/:id'],
  ['GET', '/api/siio/board-reports'],
];

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  assert.match(source, /export const MODULE_ENDPOINT_ACTIONS = Object\.freeze\(\{[\s\S]*?opportunities: ACTIONS\.MODULE_OPPORTUNITIES_VIEW,[\s\S]*?goals: ACTIONS\.MODULE_GOALS_VIEW,[\s\S]*?siio: ACTIONS\.MODULE_SIIO_VIEW,[\s\S]*?tenders: ACTIONS\.LICITACIONES_VIEW,[\s\S]*?users: ACTIONS\.MODULE_USERS_VIEW,[\s\S]*?\}\)/, `${file}: central endpoint→module matrix must be auditable`);
  assert.match(source, /export const SIIO_ENDPOINT_ACTIONS = Object\.freeze\(/, `${file}: SIIO endpoint policy must be auditable`);
  assert.match(source, /export function requireSiioEndpointAccess\(profile, methodRoute\) \{[\s\S]*?requireModuleAction\(profile, 'siio'\);[\s\S]*?profile\?\.role === 'director'[\s\S]*?profile\?\.role === 'junta'/, `${file}: SIIO guard must compose module, fail-closed director, and junta policy`);
  assert.doesNotMatch(source, /requireSiioModuleAccess/, `${file}: legacy broad SIIO guard must not remain`);
  for (const [method, route] of siioRoutes) {
    assert.match(source, new RegExp(`['"]${method} ${route.replaceAll('/', '\\/')}['"]`), `${file}: ${method} ${route} is covered by HTTP and SIIO matrices`);
    const handler = new RegExp(`app\\.${method.toLowerCase()}\\('${route.replaceAll('/', '\\/')}[\\s\\S]*?requireSiioEndpointAccess\\(profile, ['"]${method} ${route.replaceAll('/', '\\/')}['"]\\)`);
    assert.match(source, handler, `${file}: ${method} ${route} guards before SIIO data access`);
  }
  assert.match(source, /publication_status: row\?\.publication_status \?\? row\?\.status/, `${file}: junta publication state must be derived from the returned row`);
  assert.match(source, /can\(profile, ACTIONS\.BOARD_PUBLICATION_VIEW/, `${file}: junta rows must be filtered by board publication capability`);
  assert.match(source, /profile\.role === 'junta'\)[\s\S]*?boardReports[\s\S]*?fronts: \[\], records: \[\], sources: \[\], decisions: \[\]/, `${file}: junta bootstrap must be reduced to executive board reports`);
  assert.match(source, /siioTables\.payrollAggregates, 'id,period_month,area,total_people,total_accrued,total_deductions,net_total,variation_abs,alert,source_id,visibility_level'/, `${file}: payroll bootstrap must use an aggregate-only allowlist`);
  assert.doesNotMatch(source, /siioTables\.payrollAggregates, '\*'/, `${file}: payroll bootstrap must never select future columns implicitly`);
  for (const route of ['/api/opportunities/:id', '/api/opportunities', '/api/opportunities/:id/interactions', '/api/opportunity-detail', '/api/opportunity', '/api/opportunity-interactions']) {
    assert.match(source, new RegExp(`app\\.(?:get|post|put)\\('${route.replaceAll('/', '\\/')}[\\s\\S]*?requireModuleAction\\(currentProfile, ['"]opportunities['"]\\)`), `${file}: ${route} must require Oportunidades module`);
  }
  assert.match(source, /app\.get\('\/api\/tenders',[\s\S]*?if \(!canViewTenders\(currentProfile\)\)/, `${file}: GET /api/tenders must retain the existing Licitaciones guard`);
  for (const route of ['/api/users', '/api/access-catalog']) {
    assert.match(source, new RegExp(`app\\.(?:get|post|patch)\\('${route.replaceAll('/', '\\/')}[\\s\\S]*?requireModuleAction\\(currentProfile, ['"]users['"]\\)[\\s\\S]*?requireAction\\(currentProfile, ACTIONS\\.USERS_MANAGE, \\{\\}\\)`), `${file}: ${route} must compose Usuarios module and admin action`);
  }
  assert.doesNotMatch(source, /\/api\/siio\/board-reports\/generate-draft/, `${file}: Modo Junta must remain read-only/export-only`);
}

console.log('backend permission guards OK');
