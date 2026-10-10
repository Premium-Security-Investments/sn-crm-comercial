import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/siio/SiioDashboard.tsx', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../src/siio/SiioFinancialImportPanel.tsx', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/122_siio_financial_imports.sql', import.meta.url), 'utf8');

test('los dos backends conservan paridad y exponen el flujo financiero protegido', () => {
  assert.equal(server, api);
  for (const route of ['/api/siio/financial-imports', '/api/siio/financial-imports/upload-url', '/api/siio/financial-imports/process-upload', '/api/siio/financial-imports/:id/publish']) {
    assert.match(server, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(server, /requireSiioEndpointAccess\(profile, 'POST \/api\/siio\/financial-imports\/process-upload'\)/);
  assert.match(server, /financialMetrics: 'siio_financial_metrics_current'/);
});

test('la Torre muestra el cargue sólo como acción de admin o gerencia', () => {
  assert.match(dashboard, /SiioFinancialImportPanel/);
  assert.match(dashboard, /\['admin', 'gerencia'\]\.includes\(currentProfile\.role\)/);
  assert.match(panel, /uploadToSignedUrl/);
  assert.match(panel, /Publicar en la Torre de Control/);
  assert.match(panel, /Las hojas privadas se excluyen/);
});

test('la migración conserva versiones, restringe acceso y separa cargar de publicar', () => {
  assert.match(migration, /file_sha256 text not null unique/);
  assert.match(migration, /siio_financial_balance_lines/);
  assert.match(migration, /siio_financial_validations/);
  assert.match(migration, /status in \('recibido','con_errores','validado','publicado','reemplazado'\)/);
  assert.match(migration, /revoke all on table public\.siio_financial_imports from public, anon, authenticated, service_role/);
  assert.match(migration, /siio_publish_financial_import/);
  assert.match(migration, /financial_import_has_blockers/);
  assert.match(migration, /uq_siio_financial_import_published_period/);
  assert.match(migration, /siio_financial_metrics_current/);
});
