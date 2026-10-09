// IT → Agentes: menú, ruta, endpoint de sólo lectura de la Plataforma de Agentes y vista.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACTIONS } from '../access-control.js';
import { canAccessRoute, getVisibleNavGroups, moduleActionForPage } from '../src/navPermissions.ts';
import {
  PLATFORM_AGENTS_SQL,
  PLATFORM_AGENTS_UNAVAILABLE_MESSAGE,
  isPlatformAgentsUnavailable,
  listPlatformAgents,
  platformConnectionString,
  platformSslConfig,
  presentPlatformAgent,
} from '../platform-agents.js';

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');
const nav = read('../src/navPermissions.ts');
const main = read('../src/main.tsx');
const serverSource = read('../server/index.js');
const apiSource = read('../api/[...path].js');
const view = read('../src/platform/AgentsView.tsx');
const presentation = read('../src/platform/agentsPresentation.ts');

const profile = (role, permissions) => ({ id: `${role}-1`, role, active: true, permissions });

test('el menú tiene el grupo IT antes de Administración (que va al final) con el ítem Agentes', () => {
  const adminIdx = nav.indexOf("title: 'Administración'");
  const itIdx = nav.indexOf("title: 'IT'");
  assert.ok(itIdx > -1 && adminIdx > itIdx, 'IT va antes de Administración');
  assert.ok(nav.indexOf("{ href: '#/agents', label: 'Agentes', page: 'agents' }") > itIdx);
  assert.match(nav, /title: 'Gerencia' \| 'Comercial' \| 'Licitaciones' \| 'IT' \| 'Administración';/);
  assert.match(nav, /\| 'agents';/, 'agents es una página de NavRoutePage');
  assert.equal(moduleActionForPage('agents'), 'modulo_usuarios');
});

test('sólo quien administra usuarios ve y abre Agentes; solo consulta nunca', () => {
  const admin = profile('admin', ['modulo_usuarios']);
  assert.equal(canAccessRoute(admin, 'agents'), true);
  const groups = getVisibleNavGroups(admin);
  assert.deepEqual(groups.map(group => group.title).slice(-2), ['IT', 'Administración']);
  assert.deepEqual(groups.find(group => group.title === 'IT').items, [{ href: '#/agents', label: 'Agentes', page: 'agents' }]);

  const adminWithoutUsers = profile('admin', ['modulo_siio_gerencial', 'modulo_oportunidades']);
  assert.equal(canAccessRoute(adminWithoutUsers, 'agents'), false);
  assert.equal(getVisibleNavGroups(adminWithoutUsers).some(group => group.title === 'IT'), false);

  for (const role of ['gerencia', 'director', 'comercial', 'consulta']) {
    const someone = profile(role, ['modulo_usuarios', 'modulo_siio_gerencial', 'modulo_oportunidades', 'modulo_dashboard_comercial']);
    assert.equal(canAccessRoute(someone, 'agents'), false, `${role} no abre Agentes`);
    assert.equal(getVisibleNavGroups(someone).some(group => group.title === 'IT'), false, `${role} no ve el grupo IT`);
  }
  assert.equal(canAccessRoute({ ...admin, active: false }, 'agents'), false);
  assert.equal(canAccessRoute(null, 'agents'), false);
});

test('main.tsx enruta #/agents con área IT, título Agentes y sin "Nueva oportunidad"', () => {
  assert.ok(main.includes("if (page === 'agents') return id ? { page: 'agents', id: decodeURIComponent(id) } : { page: 'agents' };"), '#/agents y #/agents/<ID>');
  assert.ok(main.includes("if (route.page === 'agents') return 'IT';"));
  assert.ok(main.includes("if (route.page === 'agents') return 'Agentes';"));
  assert.ok(main.includes("if (route.page === 'agents') return <AgentsView key={route.id || 'agents'} agentId={route.id} />;"));
  assert.ok(main.includes("import { AgentsView } from './platform/AgentsView';"));
  assert.match(main, /\{areaFor\(route\) === 'Comercial' && canAccessRoute\(currentProfile, 'new'\) && <NewOpportunityButton/, 'el botón sólo aparece en el área Comercial');
  const router = main.slice(main.indexOf('function RouterView'), main.indexOf("if (route.page === 'agents') return <AgentsView key="));
  assert.match(router, /if \(!canAccessRoute\(data\.currentProfile, route\.page\)\) return/, 'la ruta pasa por canAccessRoute antes de renderizar');
  const navRenderer = main.slice(main.indexOf('function Nav('), main.indexOf('function RouterView'));
  assert.doesNotMatch(navRenderer, /#\/agents/, 'sin enlaces hardcoded en el sidebar');
});

test('GET /api/platform/agents tiene la misma protección que GET /api/users y espejo idéntico', async () => {
  assert.equal(serverSource, apiSource, 'server/index.js y api/[...path].js deben ser idénticos');
  assert.match(serverSource, /'GET \/api\/platform\/agents': \['users', ACTIONS\.USERS_MANAGE\]/);
  assert.match(serverSource, /app\.get\('\/api\/platform\/agents', async \(req, res\) => \{\n  try \{\n    const \{ profile: currentProfile \} = await getAuthContext\(req\);\n    requireModuleAction\(currentProfile, 'users'\);\n    requireAction\(currentProfile, ACTIONS\.USERS_MANAGE, \{\}\);\n/);
  assert.match(serverSource, /if \(isPlatformAgentsUnavailable\(error\)\) return res\.status\(503\)\.json\(\{ error: PLATFORM_AGENTS_UNAVAILABLE_MESSAGE \}\);/);
  assert.match(serverSource, /app\.all\('\/api\/platform\/agents', \(_req, res\) => res\.status\(405\)/);
  assert.equal(ACTIONS.USERS_MANAGE, 'users.manage');
});

test('sin PLATFORM_DATABASE_URL falla cerrada con el mensaje neutro', async () => {
  for (const env of [{}, { PLATFORM_DATABASE_URL: '' }, { PLATFORM_DATABASE_URL: 'no-es-url' }, { PLATFORM_DATABASE_URL: 'https://example.com' }]) {
    await assert.rejects(listPlatformAgents({ env }), error => {
      assert.equal(isPlatformAgentsUnavailable(error), true);
      assert.equal(error.status, 503);
      assert.equal(error.message, PLATFORM_AGENTS_UNAVAILABLE_MESSAGE);
      return true;
    });
  }
  assert.equal(PLATFORM_AGENTS_UNAVAILABLE_MESSAGE, 'La plataforma de agentes no está conectada.');
});

test('la URL nunca puede desactivar TLS y el pool siempre usa SSL', () => {
  assert.equal(platformConnectionString('postgresql://u:p@h:5432/db?sslmode=disable&ssl=false&application_name=x'), 'postgresql://u:p@h:5432/db?application_name=x');
  assert.equal(platformSslConfig({}).rejectUnauthorized, false);
  assert.deepEqual(platformSslConfig({ PLATFORM_DATABASE_CA: 'PEM' }), { rejectUnauthorized: true, ca: 'PEM' });
});

function fakePool({ connectError, failOn } = {}) {
  const queries = [];
  const released = [];
  return {
    queries,
    released,
    async connect() {
      if (connectError) throw connectError;
      return {
        async query(sql) {
          queries.push(sql);
          if (failOn && sql.includes(failOn)) throw Object.assign(new Error('relation platform.secret at host db.internal does not exist'), { code: '42P01' });
          if (sql === PLATFORM_AGENTS_SQL) {
            return { rows: [
              { agent_id: 'AGT-000', namespace: 'it', display_name: 'Vig-IA IT', lifecycle_state: 'declared', active: false, created_at: new Date('2026-10-01T00:00:00Z'), updated_at: '2026-10-02T00:00:00Z', retired_at: null, policy_versions: 2, configuration_versions: '1', open_runs: 0, secret_token: 'NO' },
            ] };
          }
          return { rows: [] };
        },
        release(error) { released.push(error); },
      };
    },
  };
}

test('lee en transacción read only con statement_timeout de 5 s y sólo devuelve campos públicos', async () => {
  const pool = fakePool();
  const payload = await listPlatformAgents({ pool });
  assert.deepEqual(pool.queries, ['begin read only', 'set local statement_timeout = 5000', PLATFORM_AGENTS_SQL, 'commit']);
  assert.deepEqual(pool.released, [undefined]);
  assert.deepEqual(payload, { agents: [{
    id: 'AGT-000', namespace: 'it', name: 'Vig-IA IT', state: 'declared', active: false,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-02T00:00:00.000Z', retired_at: null,
    counts: { policy_versions: 2, configuration_versions: 1, open_runs: 0 },
  }] });
  assert.match(PLATFORM_AGENTS_SQL, /^select /, 'sólo una consulta select');
  for (const table of ['platform.agent_registry', 'platform.agent_policy_version', 'platform.agent_configuration_version', 'platform.agent_run_open_event']) assert.ok(PLATFORM_AGENTS_SQL.includes(table), table);
  assert.doesNotMatch(PLATFORM_AGENTS_SQL, /\b(insert|update|delete|truncate|alter|drop|grant)\b/i);
  assert.equal(presentPlatformAgent({ agent_id: 'AGT-9', display_name: null, policy_versions: -1 }).counts.policy_versions, 0);
});

test('conexión o consulta fallida → 503 neutro, rollback y cliente descartado', async () => {
  await assert.rejects(listPlatformAgents({ pool: fakePool({ connectError: new Error('password authentication failed for user postgres') }) }), error => error.message === PLATFORM_AGENTS_UNAVAILABLE_MESSAGE && error.status === 503);
  const pool = fakePool({ failOn: 'from platform.agent_registry' });
  await assert.rejects(listPlatformAgents({ pool }), error => error.message === PLATFORM_AGENTS_UNAVAILABLE_MESSAGE && !/host|relation/.test(error.message));
  assert.equal(pool.queries.at(-1), 'rollback');
  assert.deepEqual(pool.released, [true]);
});

test('la vista: pestañas, resumen compacto con tabla de agentes y vistas futuras como texto "próximamente"', () => {
  for (const text of ['SIIO · IT', 'executive-hero', 'Vistas de Agentes', 'Indicadores generales', 'Agentes registrados', 'Usos de IA hoy', 'Límite de la suscripción', 'veces tocado en 7 días', 'Propuestas por aprobar', 'Revisar →', 'Avisos', 'Clic en un agente para ver su ficha, funciones, modelos y cupos', '<th>Agente</th><th>Estado</th><th>Dueño</th><th>Funciones con IA</th><th>Uso hoy / mes</th><th>Versión vigente</th>', '(próximamente)', 'AGENT_OWNER_PENDING']) {
    assert.ok(view.includes(text), text);
  }
  for (const [id, label] of [['summary', 'Resumen'], ['usage', 'Uso de IA'], ['profiles', 'Perfiles de uso'], ['proposals', 'Propuestas'], ['history', 'Historial']]) {
    assert.ok(presentation.includes(`{ id: '${id}', label: '${label}' }`), label);
  }
  for (const [code, label] of [['declared', 'Declarado'], ['controlled_pilot', 'Piloto controlado'], ['partial_operation', 'Operación parcial'], ['full_operation', 'Operación completa'], ['retired', 'Retirado']]) {
    assert.ok(presentation.includes(`${code}: '${label}'`), code);
  }
  const upcomingList = presentation.slice(presentation.indexOf('export const UPCOMING_PLATFORM_VIEWS'), presentation.indexOf(']);', presentation.indexOf('export const UPCOMING_PLATFORM_VIEWS')));
  for (const label of ['Permisos', 'Actividad', 'Salud']) assert.ok(upcomingList.includes(`'${label}'`), label);
  assert.ok(!upcomingList.includes("'Uso de IA'") && !upcomingList.includes("'Propuestas por aprobar'"), 'lo construido ya no es "próximamente"');
  assert.ok(presentation.includes("AGENT_OWNER_PENDING = 'Por definir'"));
  assert.match(view, /<span className="platform-count" aria-label=\{`\$\{pending\} pendientes`\}>\{pending\}<\/span>/, 'contador de propuestas pendientes en la pestaña');
  assert.match(view, /agents\.status === 'error' && tab === 'summary' && <div className="error" role="alert">\{agents\.message\}<\/div>/, 'el 503 se muestra tal cual');
  assert.match(view, /agents\.length === 0 && <EmptyState/, 'estado vacío');
  assert.match(view, /go\(`#\/agents\/\$\{encodeURIComponent\(agent\.id\)\}`\)/, 'clic en la fila abre el detalle');
  const upcoming = view.slice(view.indexOf('platform-upcoming-text'), view.indexOf('(próximamente)'));
  assert.doesNotMatch(upcoming, /<a |<button|onClick|href=/, 'las vistas futuras no son clicables');
  assert.doesNotMatch(view, /platform-agent-card|AGENT_COUNT_LABELS|Configuraciones/, 'sin las tarjetas grandes ni la etiqueta que se cortaba');
  assert.doesNotMatch(view, /import[^\n]*SiioAgentsView/, 'no reutiliza ni toca la pestaña Agentes de la Torre de Control');
});
