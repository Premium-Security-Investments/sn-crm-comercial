import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { buffersAreEqual } from '../scripts/check_backend_parity.mjs';

const serverSource = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const serverBuffer = readFileSync(new URL('../server/index.js', import.meta.url));
const apiBuffer = readFileSync(new URL('../api/[...path].js', import.meta.url));
const migrationSource = readFileSync(
  new URL('../supabase/migrations/087_tender_processing_human_freeze_authorization.sql', import.meta.url),
  'utf8',
);

const RETIRED_ROUTE_PATTERN = /app\.post\(\s*['"]\/api\/tender-analysis-authorize['"]\s*,\s*rejectUngovernedAgt002Route\s*\)\s*;/;

function assertBackend(source, label) {
  assert.ok(!source.includes('Katherine'), `${label}: no debe hardcodear el nombre Katherine`);
  assert.ok(!source.includes('Juan Botero'), `${label}: no debe hardcodear el nombre Juan Botero`);

  assert.match(
    source,
    RETIRED_ROUTE_PATTERN,
    `${label}: /api/tender-analysis-authorize debe registrarse exactamente como app.post('/api/tender-analysis-authorize', rejectUngovernedAgt002Route);`,
  );
  assert.ok(
    !source.includes("rpc('psi_authorize_tender_analysis'"),
    `${label}: ningún handler inline debe seguir invocando psi_authorize_tender_analysis; ese flujo quedó retirado`,
  );
}

function assertMigrationRevokesLegacyRpc(source) {
  const revokeRegex = /revoke\s+(?:all|execute)\s+on\s+function\s+public\.psi_authorize_tender_analysis\s*\(\s*uuid\s*,\s*uuid\s*\)\s+from\s+([^;]+);/gi;
  const revokedRoles = new Set();
  let match = revokeRegex.exec(source);
  while (match !== null) {
    match[1]
      .split(',')
      .map(role => role.trim().toLowerCase())
      .forEach(role => revokedRoles.add(role));
    match = revokeRegex.exec(source);
  }

  assert.ok(
    revokedRoles.size > 0,
    'la migración 087 debe revocar EXECUTE sobre public.psi_authorize_tender_analysis(uuid, uuid)',
  );
  for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
    assert.ok(
      revokedRoles.has(role),
      `la migración 087 debe revocar public.psi_authorize_tender_analysis(uuid, uuid) de ${role}`,
    );
  }
}

function run() {
  assertBackend(serverSource, 'server/index.js');
  assertBackend(apiSource, 'api/[...path].js');
  assertMigrationRevokesLegacyRpc(migrationSource);
  assert.ok(buffersAreEqual(serverBuffer, apiBuffer), 'server/index.js y api/[...path].js deben ser byte-idénticos');
  console.log('tender-analysis-authorize-static passed');
}
run();
