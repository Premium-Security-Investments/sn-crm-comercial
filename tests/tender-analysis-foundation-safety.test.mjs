import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { requireTenderAnalysisFoundation } from '../tender-analysis-foundation-availability.js';

const backendPaths = [
  new URL('../server/index.js', import.meta.url),
  new URL('../api/[...path].js', import.meta.url),
];
const rollbackPath = new URL('../supabase/rollbacks/025_tender_analysis_foundation.sql', import.meta.url);
const FOUNDATION_RPC = 'psi_tender_analysis_foundation_ready';

function tableProbe(error = null) {
  return {
    select() { return this; },
    limit() { return Promise.resolve({ data: [], error }); },
  };
}

function routeBlock(source, method, route) {
  const start = source.indexOf(`app.${method}('${route}'`);
  assert.notEqual(start, -1, `${method.toUpperCase()} ${route} debe existir`);
  const next = source.indexOf('\napp.', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

{
  const rpcCalls = [];
  const database = {
    from() { return tableProbe({ message: 'relation does not exist', code: '42P01' }); },
    async rpc(name, args) { rpcCalls.push({ name, args }); return { data: null, error: null }; },
  };
  await assert.rejects(
    () => requireTenderAnalysisFoundation(database, { logger: { warn() {} } }),
    (error) => error?.status === 503
      && error?.code === 'TENDER_ANALYSIS_FOUNDATION_UNAVAILABLE'
      && error?.message === 'La fundación de análisis documental no está disponible.',
  );
  assert.deepEqual(rpcCalls, [], '025 ausente bloquea antes de cualquier RPC de negocio o efecto lateral');
}

{
  const probes = [];
  const database = {
    from(name) { probes.push(`table:${name}`); return tableProbe(); },
    async rpc(name, args) {
      probes.push(`rpc:${name}`);
      assert.equal(name, FOUNDATION_RPC);
      assert.deepEqual(args, {}, 'el probe de readiness no recibe datos ni ejecuta una RPC mutante');
      return { data: true, error: null };
    },
  };
  assert.equal(await requireTenderAnalysisFoundation(database, { logger: { warn() {} } }), true);
  assert.deepEqual(probes, [
    'table:psi_tender_document_snapshots',
    'table:psi_tender_analysis_runs',
    `rpc:${FOUNDATION_RPC}`,
  ]);
}

{
  const rpcCalls = [];
  const database = {
    from() { return tableProbe(); },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return { data: false, error: null };
    },
  };
  await assert.rejects(
    () => requireTenderAnalysisFoundation(database, { logger: { warn() {} } }),
    (error) => error?.status === 503 && error?.code === 'TENDER_ANALYSIS_FOUNDATION_UNAVAILABLE',
  );
  assert.deepEqual(rpcCalls, [{ name: FOUNDATION_RPC, args: {} }], 'privilege drift may call only the read-only readiness RPC, never a business RPC or side effect');
}

for (const path of backendPaths) {
  const source = readFileSync(path, 'utf8');
  assert.match(source, /import \{ isTenderAnalysisFoundationUnavailable, requireTenderAnalysisFoundation \} from '\.\.\/tender-analysis-foundation-availability\.js';/, `${path.pathname} debe importar el guard reusable.`);
  for (const [method, route] of [
    ['get', '/api/tender-documents'],
    ['post', '/api/tender-documents-upload'],
    ['post', '/api/tender-documents-analyze'],
    ['post', '/api/tender-documents-import'],
    ['get', '/api/tender-go-no-go-decision'],
    ['post', '/api/tender-go-no-go-decision'],
  ]) assert.match(routeBlock(source, method, route), /await requireTenderAnalysisFoundation\(database\);/, `${method.toUpperCase()} ${route} debe cerrar antes de continuar.`);

  const upload = routeBlock(source, 'post', '/api/tender-documents-upload');
  assert.match(upload, /await requireTenderAnalysisFoundation\(database\);[\s\S]*await ensureTenderBucket\(database\)/, 'carga debe verificar antes de Storage');
  const importRoute = routeBlock(source, 'post', '/api/tender-documents-import');
  assert.match(importRoute, /await requireTenderAnalysisFoundation\(database\);[\s\S]*importTenderDocumentsFromOfficialSource/, 'importación debe verificar antes de importar');
  const sendErrorStart = source.indexOf('function sendError(res, error, status = 500) {');
  const sendErrorEnd = source.indexOf('\nasync function must', sendErrorStart);
  const sendError = source.slice(sendErrorStart, sendErrorEnd);
  assert.match(sendError, /TENDER_ANALYSIS_FOUNDATION_UNAVAILABLE/, 'el cliente debe recibir un código estable');
  assert.match(sendError, /res\.status\(503\)\.json\(\{ error: 'La fundación de análisis documental no está disponible\.', code: 'TENDER_ANALYSIS_FOUNDATION_UNAVAILABLE' \}\)/, 'el cliente debe recibir 503/código estable sin detalle del proveedor');
}

assert.equal(existsSync(rollbackPath), true, 'debe existir rollback 025 versionado');
const rollback = readFileSync(rollbackPath, 'utf8');
assert.match(rollback, /^\s*--[\s\S]*?begin;/i, 'rollback debe iniciar una transacción documentada');
assert.match(rollback, /commit;\s*$/i, 'rollback debe cerrar la transacción');
assert.match(rollback, /p_analysis_interaction_id uuid/i, 'rollback debe restaurar el parámetro RPC 022');
assert.match(rollback, /revoke all on function public\.psi_record_tender_document_snapshot/i, 'rollback debe revocar explícitamente la RPC de snapshots');
assert.match(rollback, /revoke all on function public\.psi_record_tender_analysis_run/i, 'rollback debe revocar explícitamente la RPC de runs');
assert.match(rollback, /revoke all on function public\.psi_tender_analysis_foundation_ready\(\)/i, 'rollback debe revocar explícitamente la RPC read-only de readiness');
assert.doesNotMatch(rollback, /drop\s+(?:table|column)|delete\s+from/i, 'rollback no puede borrar evidencia ni estructura auditable');
assert.match(rollback, /to_regclass\('public\.psi_tender_go_no_go_decisions'\) is null/i, 'rollback debe fallar si falta un prerrequisito');
assert.match(rollback, /primero.*redeploy.*pre-025/i, 'rollback debe documentar el orden seguro de operación');

console.log('tender analysis foundation safety contract passed');
