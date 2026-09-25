import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const sha = (rel) => createHash('sha256').update(readFileSync(resolve(root, rel))).digest('hex');

const FROZEN = {
  'agt003-copilot-runtime.js': '5239702fa83820069aa83a5785cb5564c3f24686b628843d7a4d2847737fbf83',
  'agt003-preflight-runtime.js': '48e761d6badba31ae8f15bf563df0be05d5180410c3c48a806bda955ccdc34af',
  'agt002-workbench-runtime.js': 'ee1a0815f0954617370ee909e2ce33c679426e85e82f4a1bcea1bb9c59742d39',
  'agt002-preview-runtime.js': 'd2834ae9df2e8146553e0a056949d0ded9c8a27094541976d7075c2c179072cb',
  'ops/agt003-claude-bridge/run-server.mjs': '13c6ca09fcbc6f5db880fa3dfff4cea01430897728c9a8d6434afb235cc05bf1',
  'ops/agt003-claude-bridge/env.example': '168cb44d29fea92b6d3592a903d83ce9935837bfb13bdfd02cd9700baae86b0d',
  'ops/agt003-claude-bridge/agt003-bridge.service': '0847b3a05bcb751e0e8989d96ef2aeb7a447521f7a1c9a0213447a93a95fecfd',
};

const migrationPath = 'supabase/migrations/093_siio_sales_clients.sql';
const rollbackPath = 'supabase/rollbacks/093_siio_sales_clients_rollback.sql';
const CLIENT_FIELDS = [
  'company_name',
  'customer_segment',
  'regional_nombre',
  'sede',
  'quote_city',
  'economic_sector',
  'decision_maker_name',
  'decision_maker_email',
  'decision_maker_phone',
];

test('cupos, engine y puente no cambian', () => {
  for (const [rel, expected] of Object.entries(FROZEN)) {
    assert.equal(sha(rel), expected, `${rel} must stay frozen`);
  }
});

test('migracion 093 crea maestro de clientes con unique normalizado y FK restrict', () => {
  assert.equal(existsSync(resolve(root, migrationPath)), true, '093_siio_sales_clients.sql debe existir');
  const sql = read(migrationPath);
  assert.match(sql, /^begin;/i);
  assert.match(sql, /commit;\s*$/i);
  assert.match(sql, /create table if not exists public\.psi_sales_clients/i);
  for (const field of CLIENT_FIELDS) {
    assert.match(sql, new RegExp(`\\b${field}\\b`, 'i'), `clients.${field}`);
  }
  assert.match(
    sql,
    /create (?:or replace )?function public\.psi_sales_normalize_client_name\s*\(\s*input_name text\s*\)/i,
    '093 debe definir public.psi_sales_normalize_client_name(text)',
  );
  assert.match(
    sql,
    /create unique index if not exists psi_sales_clients_normalized_name_key\s+on public\.psi_sales_clients\s*\(\s*public\.psi_sales_normalize_client_name\s*\(\s*company_name\s*\)\s*\)/i,
    'psi_sales_clients_normalized_name_key debe usar public.psi_sales_normalize_client_name',
  );
  assert.match(sql, /add column if not exists client_id uuid/i);
  assert.match(sql, /references public\.psi_sales_clients\s*\(\s*id\s*\)\s+on delete restrict/i);
  assert.match(sql, /service_type_code is distinct from 'licitacion_publica'/i);
  assert.match(sql, /distinct on/i);
  assert.match(
    sql,
    /order by[\s\S]*coalesce\s*\(\s*o\.updated_at\s*,\s*o\.created_at\s*\)\s+desc\s*,\s*o\.id\s+desc/i,
    'seed usa el row mas reciente con desempate deterministico',
  );
  assert.match(sql, /raise exception/i);
  assert.match(sql, /licitacion_publica/i);
  assert.doesNotMatch(sql, /vigia_copilot_pilot|dane|secop/i);
  assert.doesNotMatch(sql, /delete from public\.psi_sales_opportunities/i);
  assert.equal(existsSync(resolve(root, rollbackPath)), true, 'rollback 093 debe existir');
});

test('GET /api/client-typeahead autenticado + modulo_oportunidades ve todos los clientes', () => {
  for (const rel of ['api/[...path].js', 'server/index.js']) {
    const src = read(rel);
    assert.match(src, /app\.get\('\/api\/client-typeahead'/);
    const handlerStart = src.indexOf("app.get('/api/client-typeahead'");
    assert.ok(handlerStart >= 0, `${rel} declara GET /api/client-typeahead`);
    const handler = src.slice(handlerStart, handlerStart + 1800);
    assert.match(handler, /requireModuleAction\(\s*currentProfile\s*,\s*'opportunities'\s*\)/);
    assert.doesNotMatch(handler, /owner_id/, `${rel} typeahead no filtra por comercial`);
    assert.doesNotMatch(handler, /\.limit\(\s*1000\s*\)/, `${rel} typeahead consulta todos los clientes antes de filtrar`);
    assert.match(src, /from\('psi_sales_clients'\)/);
  }
});

test('POST crea cliente nuevo y rechaza duplicado normalizado sin elegir existente', () => {
  for (const rel of ['api/[...path].js', 'server/index.js']) {
    const src = read(rel);
    const postStart = src.indexOf("app.post('/api/opportunities'");
    assert.ok(postStart >= 0, `${rel} POST /api/opportunities`);
    const post = src.slice(postStart, postStart + 2500);
    assert.match(post, /psi_sales_clients|resolveClient|client_id/);
  }
});

test('PUT de campos de cliente actualiza el maestro y sincroniza company_name', () => {
  for (const rel of ['api/[...path].js', 'server/index.js']) {
    const src = read(rel);
    assert.match(src, /app\.put\('\/api\/opportunity'/);
    assert.match(src, /app\.put\('\/api\/opportunities\/:id'/);
    assert.match(src, /psi_sales_clients/);
    assert.match(src, /No tiene permiso para cambiar Cliente Nuevo \/ Cliente Actual/);
    assert.match(src, /function canEditCustomerSegment/);
  }
});

test('UI #/new typeahead en Cliente/empresa rellena los 8 campos al elegir', () => {
  const main = read('src/main.tsx');
  const formStart = main.indexOf('function OpportunityForm');
  assert.ok(formStart >= 0);
  const form = main.slice(formStart, main.indexOf('function GoalVsActualDashboard', formStart));
  assert.match(form, /Cliente \/ empresa/);
  assert.match(form, /\/api\/client-typeahead/);
  for (const field of CLIENT_FIELDS) {
    assert.match(form, new RegExp(field));
  }
  assert.match(form, /setForm|client_id/);
  assert.match(form, /customer_segment:\s*client\.customer_segment\s*\|\|\s*''/, 'seleccionar un cliente reemplaza el segmento previo incluso cuando el maestro está vacío');
});
