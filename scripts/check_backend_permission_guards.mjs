import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const files = ['server/index.js', 'api/[...path].js'];
const moduleGuard = (family, action) => new RegExp(`requireModuleAction\\(currentProfile, ['"]${family}['"]\\)`);
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  assert.match(source, /export const MODULE_ENDPOINT_ACTIONS = Object\.freeze\(\{[\s\S]*?opportunities: ACTIONS\.MODULE_OPPORTUNITIES_VIEW,[\s\S]*?goals: ACTIONS\.MODULE_GOALS_VIEW,[\s\S]*?siio: ACTIONS\.MODULE_SIIO_VIEW,[\s\S]*?tenders: ACTIONS\.LICITACIONES_VIEW,[\s\S]*?users: ACTIONS\.MODULE_USERS_VIEW,[\s\S]*?\}\)/, `${file}: central endpoint→module matrix must be auditable`);
  assert.match(source, /export function requireModuleAction\(profile, endpointModule\)[\s\S]*?requireAction\(profile, MODULE_ENDPOINT_ACTIONS\[endpointModule\], \{\}\)/, `${file}: unknown module families must fail closed through requireAction`);
  assert.match(source, /function canAccessSiio\(profile\) \{ return \['admin','gerencia','director'\]\.includes\(profile\?\.role\); \}/, `${file}: legacy SIIO guard preserves director eligibility until Task 4B composes scoped actions`);
  assert.match(source, /function requireSiioModuleAccess\(profile\) \{[\s\S]*?requireModuleAction\(profile, 'siio'\);[\s\S]*?requireSiioAccess\(profile\);/, `${file}: SIIO must compose module and legacy role guards`);
  for (const route of ['/api/siio/bootstrap', '/api/siio/records', '/api/siio/board-reports']) {
    assert.match(source, new RegExp(`app\\.(?:get|post|patch)\\('${route.replaceAll('/', '\\/')}[\\s\\S]*?requireSiioModuleAccess\\(profile\\)`), `${file}: ${route} must require SIIO module before data access`);
  }
  assert.match(source, /siioTables\.payrollAggregates, 'id,period_month,area,total_people,total_accrued,total_deductions,net_total,variation_abs,alert,source_id,visibility_level'/, `${file}: payroll bootstrap must use an aggregate-only allowlist`);
  assert.doesNotMatch(source, /siioTables\.payrollAggregates, '\*'/, `${file}: payroll bootstrap must never select future columns implicitly`);
  for (const route of ['/api/opportunities/:id', '/api/opportunities', '/api/opportunities/:id/interactions', '/api/opportunity-detail', '/api/opportunity', '/api/opportunity-interactions']) {
    assert.match(source, new RegExp(`app\\.(?:get|post|put)\\('${route.replaceAll('/', '\\/')}[\\s\\S]*?${moduleGuard('opportunities').source}`), `${file}: ${route} must require Oportunidades module`);
  }
  for (const route of ['/api/goals']) {
    assert.match(source, new RegExp(`app\\.(?:get|put)\\('${route.replaceAll('/', '\\/')}[\\s\\S]*?${moduleGuard('goals').source}`), `${file}: ${route} must require Metas module`);
  }
  assert.match(source, /export function canViewTenders\(profile\) \{ return can\(profile, ACTIONS\.LICITACIONES_VIEW\); \}/, `${file}: tender guard must delegate to the central capability matrix`);
  assert.match(source, /app\.get\('\/api\/tenders',[\s\S]*?if \(!canViewTenders\(currentProfile\)\)/, `${file}: GET /api/tenders must retain the existing Licitaciones guard`);
  for (const route of ['/api/users', '/api/access-catalog']) {
    assert.match(source, new RegExp(`app\\.(?:get|post|patch)\\('${route.replaceAll('/', '\\/')}[\\s\\S]*?${moduleGuard('users').source}[\\s\\S]*?requireAction\\(currentProfile, ACTIONS\\.USERS_MANAGE, \\{\\}\\)`), `${file}: ${route} must compose Usuarios module and admin action`);
  }
  for (const guardName of ['canViewTenders', 'canAccessSiio', 'canManageUsers', 'requireModuleAction', 'requireSiioModuleAccess']) {
    const match = source.match(new RegExp(`function ${guardName}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
    assert.ok(match, `${file}: ${guardName} must exist`);
    assert.doesNotMatch(match[0], /microsoft_email/, `${file}: ${guardName} must not authorize by email`);
  }
  assert.doesNotMatch(source, /\/api\/siio\/board-reports\/generate-draft/, `${file}: Modo Junta must remain read-only/export-only`);
}

console.log('backend permission guards OK');
