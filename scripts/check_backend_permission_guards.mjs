import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const files = ['server/index.js', 'api/[...path].js'];
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  assert.match(source, /function canAccessSiio\(profile\) \{ return \['admin','gerencia','director'\]\.includes\(profile\?\.role\); \}/, `${file}: SIIO role guard must allow admin/gerencia/director only`);
  assert.match(source, /function requireSiioAccess\(profile\)/, `${file}: requireSiioAccess must exist`);
  assert.match(source, /app\.get\('\/api\/siio\/bootstrap',[\s\S]*?requireSiioAccess\(profile\)/, `${file}: /api/siio/bootstrap must require SIIO access`);
  assert.match(source, /app\.post\('\/api\/siio\/records',[\s\S]*?requireSiioAccess\(profile\)/, `${file}: POST /api/siio/records must require SIIO access`);
  assert.match(source, /app\.get\('\/api\/siio\/board-reports',[\s\S]*?requireSiioAccess\(profile\)/, `${file}: board reports must require SIIO access`);
  assert.doesNotMatch(source, /\/api\/siio\/board-reports\/generate-draft/, `${file}: Modo Junta must remain read-only/export-only`);
  assert.match(source, /function canViewTenders\(profile\) \{ return isManager\(profile\) \|\| profile\?\.microsoft_email\?\.toLowerCase\(\) === 'directora\.licitaciones@seguridadnacional\.co'; \}/, `${file}: tender guard must match navigation exception`);
  assert.match(source, /app\.get\('\/api\/tenders',[\s\S]*?if \(!canViewTenders\(currentProfile\)\)/, `${file}: GET /api/tenders must require tender permission`);
  assert.match(source, /function canManageUsers\(profile\) \{ return profile\?\.role === 'admin'; \}/, `${file}: user admin guard must be admin-only`);
  assert.match(source, /app\.get\('\/api\/users',[\s\S]*?if \(!canManageUsers\(currentProfile\)\)/, `${file}: GET /api/users must require admin`);
}

console.log('backend permission guards OK');
