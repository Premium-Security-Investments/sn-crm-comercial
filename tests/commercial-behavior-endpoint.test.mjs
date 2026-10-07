// GET /api/vigia/commercial-behavior: permiso (Dashboard comercial; el comercial recibe 403), alcance de lectura y
// lectura sin notas de los seguimientos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACTIONS } from '../access-control.js';

const savedEnv = Object.fromEntries(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL'].map(key => [key, process.env[key]]));
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.VERCEL = '1';
const server = await import('../server/index.js');
for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }

const profile = (role, permissions, overrides = {}) => ({ id: `${role}-1`, role, active: true, areas: [], permissions, ...overrides });
const NOW = new Date('2026-10-07T15:00:00Z');

// Doble mínimo del cliente de Supabase: registra cada consulta y responde por tabla.
function fakeDatabase(tables) {
  const calls = [];
  const builder = (table) => {
    const call = { table, select: null, filters: [] };
    calls.push(call);
    const query = {
      select(columns) { call.select = columns; return query; },
      eq(column, value) { call.filters.push(['eq', column, value]); return query; },
      in(column, values) { call.filters.push(['in', column, values]); return query; },
      gte(column, value) { call.filters.push(['gte', column, value]); return query; },
      lt(column, value) { call.filters.push(['lt', column, value]); return query; },
      order() { return query; },
      limit() { return query; },
      range() { return query; },
      then(resolve, reject) {
        const source = tables[table];
        if (source instanceof Error) return Promise.resolve({ data: null, error: source }).then(resolve, reject);
        let rows = typeof source === 'function' ? source(call) : (source || []);
        for (const [kind, column, value] of call.filters) {
          if (kind === 'eq') rows = rows.filter(row => row[column] === undefined || row[column] === value);
          if (kind === 'in') rows = rows.filter(row => row[column] === undefined || value.includes(row[column]));
        }
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return query;
  };
  return { calls, from: builder };
}

test('el endpoint está en la matriz auditable y exige el módulo Dashboard comercial', () => {
  assert.deepEqual(server.HTTP_ACTION_MATRIX['GET /api/vigia/commercial-behavior'], ['vigia', ACTIONS.MODULE_DASHBOARD_VIEW]);
  const forbidden = error => error?.status === 403 && error?.code === 'FORBIDDEN';
  assert.throws(() => server.requireCommercialBehaviorAccess(profile('comercial', ['modulo_oportunidades', 'modulo_alertas_comerciales', 'modulo_vig_ia', 'modulo_metas'])), forbidden, 'el comercial no ve la tabla de comportamiento');
  assert.throws(() => server.requireCommercialBehaviorAccess(profile('comercial', ['modulo_dashboard_comercial'])), forbidden, 'el módulo no es elegible para comercial');
  assert.throws(() => server.requireCommercialBehaviorAccess(profile('gerencia', ['modulo_oportunidades'])), forbidden);
  for (const role of ['admin', 'gerencia', 'director', 'consulta']) assert.equal(server.requireCommercialBehaviorAccess(profile(role, ['modulo_dashboard_comercial'])), true, role);
});

test('la ruta autentica, autoriza y luego consulta; responde 405 a otros métodos', () => {
  const source = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  assert.match(source, /app\.get\('\/api\/vigia\/commercial-behavior', async \(req, res\) => \{\n  try \{\n    const \{ profile: currentProfile \} = await getAuthContext\(req\);\n    requireCommercialBehaviorAccess\(currentProfile\);\n    res\.json\(await loadCommercialBehavior\(requireDb\(\), currentProfile\)\);/);
  assert.match(source, /app\.all\('\/api\/vigia\/commercial-behavior', \(_req, res\) => res\.status\(405\)/);
});

const tables = {
  psi_sales_profiles: [
    { id: 'ana', full_name: 'Ana', role: 'comercial', active: true, can_own_opportunities: false, identity_type: 'human' },
    { id: 'juan', full_name: 'Juan', role: 'admin', active: true, can_own_opportunities: true, identity_type: 'human' },
    { id: 'a0020000-0000-4000-8000-000000000002', full_name: 'Vig-IA', role: 'comercial', active: true, can_own_opportunities: true, identity_type: 'agent' },
    { id: 'gerente', full_name: 'Gerente', role: 'gerencia', active: true, can_own_opportunities: false, identity_type: 'human' },
  ],
  v_psi_sales_opportunity_enriched: [
    { id: 'o1', owner_id: 'ana', service_type_code: 'seguridad_fisica', stage_code: 'prospecto', next_action_at: '2026-10-01T15:00:00Z' },
    { id: 'o2', owner_id: 'juan', service_type_code: 'seguridad_fisica', stage_code: 'prospecto', next_action_at: '2026-10-09T15:00:00Z' },
  ],
  psi_sales_opportunities: [{ id: 'o1', customer_segment: null, frozen_until: null, delete_requested_at: null }, { id: 'o2' }],
  psi_sales_interactions: [{ opportunity_id: 'o1', created_by: 'ana', interaction_type: 'llamada', created_at: '2026-10-06T15:00:00Z', notes: 'SECRETO' }],
  psi_sales_opportunity_audit_logs: [{ opportunity_id: 'o1', changed_by: 'ana', field_name: 'decision', created_at: '2026-10-06T16:00:00Z' }],
  psi_profile_last_seen: [{ profile_id: 'ana', last_seen_at: '2026-10-07T13:00:00Z' }],
  psi_sales_goals: [],
};

test('consulta y gerencia ven a todo el equipo humano; nunca a la identidad técnica; nunca se leen notas', async () => {
  for (const role of ['consulta', 'gerencia']) {
    const database = fakeDatabase(tables);
    const report = await server.loadCommercialBehavior(database, profile(role, ['modulo_dashboard_comercial']), NOW);
    assert.deepEqual(report.rows.map(row => row.profileId).sort(), ['ana', 'juan'], role);
    const ana = report.rows.find(row => row.profileId === 'ana');
    assert.equal(ana.followUpsWeek, 1);
    assert.equal(ana.decisionsWeek, 1);
    assert.equal(ana.pendingDecisions, 1);
    assert.equal(ana.status, 'atrasado');
    assert.equal(report.lastSeenAvailable, true);
    assert.equal(report.rules.version, 'behavior-v1');
    assert.doesNotMatch(JSON.stringify(report), /SECRETO/);
    const interactionSelects = database.calls.filter(call => call.table === 'psi_sales_interactions').map(call => call.select);
    assert.ok(interactionSelects.length > 0);
    for (const select of interactionSelects) assert.doesNotMatch(select, /notes|\*/, 'nunca selecciona el texto de los seguimientos');
  }
});

test('sin la migración 111 el último ingreso queda desconocido y nadie queda inactivo por eso', async () => {
  const missing = Object.assign(new Error('relation "public.psi_profile_last_seen" does not exist'), { code: '42P01' });
  const report = await server.loadCommercialBehavior(fakeDatabase({ ...tables, psi_profile_last_seen: missing }), profile('admin', ['modulo_dashboard_comercial']), NOW);
  assert.equal(report.lastSeenAvailable, false);
  assert.ok(report.rows.every(row => row.status !== 'inactivo' && row.lastSeenAt === null));
});

test('el director sin alcance comercial asignado falla cerrado', async () => {
  await assert.rejects(server.loadCommercialBehavior(fakeDatabase(tables), profile('director', ['modulo_dashboard_comercial']), NOW), error => error.status === 403);
});
