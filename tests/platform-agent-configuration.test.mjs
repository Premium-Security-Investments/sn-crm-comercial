// IT → Agentes → funciones, modelos y cupos: lógica pura (validación, diferencias, estados, matriz, JSON del formulario)
// y acceso a la plataforma con dobles (sin base real).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_AI_FUNCTIONS,
  AI_MODEL_OPTIONS,
  PLATFORM_ADMIN_REJECTED_MESSAGE,
  PLATFORM_ADMIN_SQL,
  PLATFORM_ADMIN_UNAVAILABLE_MESSAGE,
  PLATFORM_AI_USAGE_PROFILES_SQL,
  PLATFORM_CONFIGURATION_VERSIONS_SQL,
  __setPlatformConfigurationPoolsForTests,
  actorNameFromProfile,
  approveConfiguration,
  assertVersionAction,
  buildProfileMatrix,
  defaultAgentConfiguration,
  describeConfigurationChanges,
  expiringExceptions,
  normalizeProfileInput,
  normalizeProposedConfiguration,
  normalizeReason,
  parseVersionId,
  presentAgentConfiguration,
  profileSlugFromName,
  proposeConfiguration,
  readAgentConfigurationRows,
  versionStatus,
} from '../platform-agent-configuration.js';
import { PLATFORM_AGENTS_UNAVAILABLE_MESSAGE } from '../platform-agents.js';
import { buildConfiguration, formFromConfiguration, profileSlug, validateForms } from '../src/platform/agentConfigForm.ts';

const COPILOT = 'agt003.opportunity-copilot.preview';
const LEAD = 'agt003.lead-deep-analysis';
const PERSON = '6a1f8c2e-1111-4222-8333-444455556666';
const OTHER = '7b2f8c2e-1111-4222-8333-444455556666';
const context = { agentId: 'AGT-003', profileIds: new Set(['comercial', 'gerencia']), personIds: new Set([PERSON, OTHER]), today: '2026-10-09' };

function validConfiguration() {
  return {
    timezone: 'America/Bogota',
    capabilities: {
      [COPILOT]: {
        enabled: true, model: 'sonnet', fallback: 'notify', team_cap: { per: 'day', max: 20 },
        profile_caps: { comercial: { per: 'day', max: 5 }, gerencia: { unlimited: true, safety_max: 200 } },
        exceptions: [{ person: PERSON, extra: 10, per: 'day', expires: '2026-10-31' }],
      },
      [LEAD]: { enabled: true, model: 'sonnet', fallback: 'notify', team_cap: { per: 'month', max: 30 } },
    },
  };
}

test('catálogo: AGT-003 tiene dos funciones con nombre humano; modelos y plan B en lista cerrada', () => {
  assert.deepEqual(AGENT_AI_FUNCTIONS['AGT-003'].map(item => [item.capability, item.label]), [[COPILOT, 'Próximo seguimiento'], [LEAD, 'Análisis profundo']]);
  assert.deepEqual(AI_MODEL_OPTIONS.map(option => [option.id, option.label]), [['sonnet', 'Sonnet (suscripción)']]);
  assert.equal(AGENT_AI_FUNCTIONS['AGT-002'], undefined, 'los demás agentes no tienen funciones con IA configuradas todavía');
});

test('valores del código: 20 por día y 30 por mes con sonnet (la primera propuesta será la versión 1)', () => {
  assert.deepEqual(defaultAgentConfiguration('AGT-003'), {
    timezone: 'America/Bogota',
    capabilities: {
      [COPILOT]: { enabled: true, model: 'sonnet', fallback: 'notify', team_cap: { per: 'day', max: 20 } },
      [LEAD]: { enabled: true, model: 'sonnet', fallback: 'notify', team_cap: { per: 'month', max: 30 } },
    },
  });
  assert.equal(defaultAgentConfiguration('AGT-003', { [COPILOT]: { period: 'day', max: 35 } }).capabilities[COPILOT].team_cap.max, 35);
  assert.equal(defaultAgentConfiguration('AGT-001'), null);
});

test('validación: una configuración correcta se normaliza sin cambios', () => {
  assert.deepEqual(normalizeProposedConfiguration(validConfiguration(), context), validConfiguration());
});

test('validación: rechaza enteros fuera de 0..1000, periodos, modelos, perfiles, personas, fechas y claves extra', () => {
  const cases = [
    [config => { config.capabilities[COPILOT].team_cap.max = 1001; }, /cupo del equipo/],
    [config => { config.capabilities[COPILOT].team_cap.max = -1; }, /cupo del equipo/],
    [config => { config.capabilities[COPILOT].team_cap.max = 2.5; }, /cupo del equipo/],
    [config => { config.capabilities[COPILOT].team_cap.max = '20'; }, /cupo del equipo/],
    [config => { config.capabilities[COPILOT].team_cap.per = 'week'; }, /cupo del equipo/],
    [config => { config.capabilities[COPILOT].model = 'opus'; }, /modelo no está en la lista/],
    [config => { config.capabilities[COPILOT].fallback = 'retry'; }, /plan B/],
    [config => { config.capabilities[COPILOT].enabled = 'si'; }, /encendida/],
    [config => { config.capabilities[COPILOT].profile_caps.inexistente = { per: 'day', max: 1 }; }, /no existe o está archivado/],
    [config => { config.capabilities[COPILOT].profile_caps.gerencia.safety_max = 5000; }, /techo de seguridad/],
    [config => { config.capabilities[COPILOT].exceptions[0].person = '00000000-0000-4000-8000-000000000000'; }, /persona activa del SIIO/],
    [config => { config.capabilities[COPILOT].exceptions[0].expires = '2026-10-08'; }, /vence en el pasado/],
    [config => { config.capabilities[COPILOT].exceptions[0].expires = ''; }, /fecha de vencimiento/],
    [config => { config.capabilities[COPILOT].exceptions[0].expires = '2026-02-30'; }, /fecha de vencimiento/],
    [config => { config.capabilities[COPILOT].exceptions.push({ ...config.capabilities[COPILOT].exceptions[0] }); }, /dos excepciones/],
    [config => { config.capabilities[COPILOT].api_key = 'x'; }, /no permitidos/],
    [config => { config.capabilities[COPILOT].team_cap.token = 'x'; }, /cupo del equipo/],
    [config => { config.secret = 'x'; }, /no permitidos/],
    [config => { config.timezone = 'UTC'; }, /Bogotá/],
    [config => { delete config.capabilities[LEAD]; }, /Falta la configuración de "Análisis profundo"/],
    [config => { config.capabilities['agt003.otra'] = {}; }, /funciones que este agente no tiene/],
  ];
  for (const [mutate, pattern] of cases) {
    const config = validConfiguration();
    mutate(config);
    assert.throws(() => normalizeProposedConfiguration(config, context), error => {
      assert.equal(error.status, 400);
      assert.equal(error.code, 'PLATFORM_CONFIGURATION_INVALID');
      assert.match(error.message, pattern);
      return true;
    }, String(pattern));
  }
  assert.throws(() => normalizeProposedConfiguration(validConfiguration(), { ...context, agentId: 'AGT-002' }), /no tiene funciones con IA/);
  const sameDay = validConfiguration();
  sameDay.capabilities[COPILOT].exceptions[0].expires = '2026-10-09';
  assert.doesNotThrow(() => normalizeProposedConfiguration(sameDay, context), 'vencer hoy está permitido');
});

test('motivo, perfil e ids: validaciones de entrada', () => {
  assert.throws(() => normalizeReason('  '), /motivo/);
  assert.throws(() => normalizeReason('x'.repeat(501)), /500/);
  assert.equal(normalizeReason('  cierre   de mes '), 'cierre de mes');
  assert.deepEqual(normalizeProfileInput({ profile_id: 'gerencia_comercial', display_name: ' Gerencia  comercial ', description: '' }), { profile_id: 'gerencia_comercial', display_name: 'Gerencia comercial', description: '' });
  assert.throws(() => normalizeProfileInput({ profile_id: '1abc', display_name: 'X1' }), /identificador/);
  assert.throws(() => normalizeProfileInput({ profile_id: 'Abc', display_name: 'Abc' }), /identificador/);
  assert.equal(profileSlugFromName('Gerencia Comercial — Ñandú'), 'gerencia_comercial_nandu');
  assert.equal(profileSlugFromName('2 Licitaciones'), 'licitaciones');
  assert.equal(profileSlugFromName('é'), '');
  assert.equal(profileSlug('Gerencia Comercial — Ñandú'), profileSlugFromName('Gerencia Comercial — Ñandú'), 'cliente y servidor generan el mismo slug');
  assert.equal(parseVersionId('42'), '42');
  for (const bad of ['0', '-1', '1.5', 'abc', '', '1; drop']) assert.equal(parseVersionId(bad), null, bad);
});

test('estado de versiones: vigente, rechazada, aprobada o pendiente; acciones según el estado', () => {
  assert.equal(versionStatus({ is_current: true, approved_at: 'x' }), 'vigente');
  assert.equal(versionStatus({ rejected_at: 'x' }), 'rechazada');
  assert.equal(versionStatus({ approved_at: 'x' }), 'aprobada');
  assert.equal(versionStatus({}), 'pendiente');
  assert.doesNotThrow(() => assertVersionAction({ status: 'pendiente' }, 'approve'));
  assert.doesNotThrow(() => assertVersionAction({ status: 'pendiente' }, 'reject'));
  assert.throws(() => assertVersionAction({ status: 'aprobada' }, 'approve'), error => error.status === 409 && /ya fue resuelta/.test(error.message));
  assert.doesNotThrow(() => assertVersionAction({ status: 'aprobada' }, 'reactivate'));
  assert.throws(() => assertVersionAction({ status: 'vigente' }, 'reactivate'), /ya está vigente/);
  assert.throws(() => assertVersionAction({ status: 'rechazada' }, 'reactivate'), /aprobada/);
  assert.throws(() => assertVersionAction(null, 'approve'), error => error.status === 404);
});

test('diferencias legibles por función y dato; sólo lo que cambia', () => {
  const before = defaultAgentConfiguration('AGT-003');
  const after = validConfiguration();
  after.capabilities[COPILOT].team_cap.max = 30;
  after.capabilities[LEAD].enabled = false;
  const rows = describeConfigurationChanges(before, after, { agentId: 'AGT-003', profileNames: { comercial: 'Comercial', gerencia: 'Gerencia' }, personNames: { [PERSON]: 'Ana Pérez' } });
  assert.deepEqual(rows, [
    { function: 'Próximo seguimiento', field: 'Cupo del equipo', before: '20 por día', after: '30 por día' },
    { function: 'Próximo seguimiento', field: 'Perfil Comercial', before: 'Sólo cupo del equipo', after: '5 por día' },
    { function: 'Próximo seguimiento', field: 'Perfil Gerencia', before: 'Sólo cupo del equipo', after: 'Sin cupo propio (techo de seguridad 200)' },
    { function: 'Próximo seguimiento', field: 'Excepción: Ana Pérez', before: 'Sin excepción', after: '+10 por día hasta 2026-10-31' },
    { function: 'Análisis profundo', field: 'Estado', before: 'Encendida', after: 'Apagada' },
  ]);
  assert.deepEqual(describeConfigurationChanges(after, after, { agentId: 'AGT-003' }), []);
  for (const row of rows) assert.doesNotMatch(`${row.function} ${row.field}`, /agt003\./, 'sin IDs técnicos');
});

test('presentación: estados, vigente por agente, cambios frente a la vigente, matriz y avisos', () => {
  const v1 = { configuration_version_id: '1', agent_id: 'AGT-003', environment: 'production', version_number: 1, configuration: defaultAgentConfiguration('AGT-003'), created_at: '2026-10-09T10:00:00Z', proposed_by: 'Juan Botero', proposal_reason: 'inicial', proposed_at: '2026-10-09T10:00:00Z', approved_by: 'Juan Botero', approved_at: '2026-10-09T11:00:00Z', is_current: true };
  const v2 = { configuration_version_id: '2', agent_id: 'AGT-003', environment: 'production', version_number: 2, configuration: JSON.stringify(validConfiguration()), created_at: '2026-10-09T12:00:00Z', proposed_by: 'Ana', proposal_reason: 'más cupo', is_current: false };
  const payload = presentAgentConfiguration({
    versionRows: [v2, v1],
    profileRows: [{ profile_id: 'comercial', display_name: 'Comercial' }, { profile_id: 'gerencia', display_name: 'Gerencia' }, { profile_id: 'viejo', display_name: 'Viejo', archived_at: '2026-10-01T00:00:00Z' }],
    people: [{ id: PERSON, full_name: 'Ana Pérez' }],
    environment: 'production',
    adminConnected: true,
    now: new Date('2026-10-28T15:00:00Z'),
  });
  assert.equal(payload.pending_count, 1);
  assert.equal(payload.current['AGT-003'], '1');
  assert.deepEqual(payload.versions.map(version => version.status), ['pendiente', 'vigente']);
  assert.equal(payload.versions[0].changes.length, 3, 'cambios de la propuesta frente a la vigente');
  assert.deepEqual(payload.versions[1].changes, []);
  assert.deepEqual(payload.profile_matrix.rows.map(row => row.profile_id), ['comercial', 'gerencia'], 'los archivados no salen en la matriz');
  assert.deepEqual(payload.profile_matrix.rows[0].cells['AGT-003'], [{ function: 'Próximo seguimiento', text: 'Sólo cupo del equipo' }, { function: 'Análisis profundo', text: 'Sólo cupo del equipo' }]);
  assert.equal(payload.today, '2026-10-28');
  assert.deepEqual(payload.catalog['AGT-003'].map(item => item.label), ['Próximo seguimiento', 'Análisis profundo']);
  // Matriz y avisos con una configuración vigente con perfiles y excepciones.
  const matrix = buildProfileMatrix([{ profile_id: 'gerencia', display_name: 'Gerencia' }], { 'AGT-003': validConfiguration() });
  assert.deepEqual(matrix.rows[0].cells['AGT-003'].map(cell => cell.text), ['Sin cupo propio (techo de seguridad 200)', 'Sólo cupo del equipo']);
  assert.equal(buildProfileMatrix([{ profile_id: 'gerencia', display_name: 'Gerencia' }], {}).rows[0].cells['AGT-003'][0].text, 'Sin configuración aprobada');
  assert.deepEqual(expiringExceptions({ 'AGT-003': validConfiguration() }, { today: '2026-10-28', personNames: { [PERSON]: 'Ana Pérez' } }), [{ agent_id: 'AGT-003', function: 'Próximo seguimiento', person: 'Ana Pérez', expires: '2026-10-31' }]);
  assert.deepEqual(expiringExceptions({ 'AGT-003': validConfiguration() }, { today: '2026-10-01' }), []);
});

test('quien firma sale del perfil autenticado', () => {
  assert.equal(actorNameFromProfile({ full_name: '  Juan   Botero ', microsoft_email: 'j@x' }), 'Juan Botero');
  assert.equal(actorNameFromProfile({ full_name: '', microsoft_email: 'j@x.co' }), 'j@x.co');
});

test('formulario: valores del código → JSON válido; perfiles, excepciones y avisos antes de enviar', () => {
  const functions = AGENT_AI_FUNCTIONS['AGT-003'].map(({ capability, label, description }) => ({ capability, label, description }));
  const forms = formFromConfiguration(null, functions, defaultAgentConfiguration('AGT-003'));
  assert.deepEqual(forms.map(form => [form.label, form.teamMax, form.teamPer, form.model]), [['Próximo seguimiento', '20', 'day', 'sonnet'], ['Análisis profundo', '30', 'month', 'sonnet']]);
  assert.deepEqual(normalizeProposedConfiguration(buildConfiguration(forms), context), defaultAgentConfiguration('AGT-003'));
  const round = formFromConfiguration(validConfiguration(), functions, defaultAgentConfiguration('AGT-003'));
  assert.deepEqual(buildConfiguration(round), validConfiguration(), 'ida y vuelta sin pérdida');
  assert.deepEqual(validateForms(round, '2026-10-09'), []);
  round[0].teamMax = '1001';
  round[0].exceptions[0].expires = '2026-10-01';
  round[0].profiles[0].max = 'x';
  const problems = validateForms(round, '2026-10-09');
  assert.ok(problems.some(problem => /cupo del equipo/.test(problem)));
  assert.ok(problems.some(problem => /vence en el pasado/.test(problem)));
  assert.ok(problems.some(problem => /cupo de cada perfil/.test(problem)));
  assert.throws(() => normalizeProposedConfiguration(buildConfiguration(round), context), /Revise los datos/);
});

function fakePool({ connectError, failOn, failCode, rows = {} } = {}) {
  const queries = [];
  const released = [];
  return {
    queries,
    released,
    async connect() {
      if (connectError) throw connectError;
      return {
        async query(sql, params) {
          queries.push({ sql, params });
          if (failOn && sql.includes(failOn)) throw Object.assign(new Error('permission denied for function at db.internal'), { code: failCode || 'P0001' });
          for (const [needle, value] of Object.entries(rows)) if (sql.includes(needle)) return { rows: value };
          return { rows: [] };
        },
        release(error) { released.push(error); },
      };
    },
  };
}

test('lectura: transacción read only con las consultas de versiones y perfiles; 503 neutro ante errores', async t => {
  t.after(() => __setPlatformConfigurationPoolsForTests(null));
  const reader = fakePool({ rows: { 'from platform.agent_configuration_version': [{ configuration_version_id: '1' }], 'from platform.ai_usage_profile': [{ profile_id: 'comercial' }] } });
  __setPlatformConfigurationPoolsForTests({ reader });
  const result = await readAgentConfigurationRows({ environment: 'production' });
  assert.deepEqual(reader.queries.map(query => query.sql), ['begin read only', 'set local statement_timeout = 5000', PLATFORM_CONFIGURATION_VERSIONS_SQL, PLATFORM_AI_USAGE_PROFILES_SQL, 'commit']);
  assert.deepEqual(reader.queries[2].params, ['production']);
  assert.equal(result.versionRows.length, 1);
  for (const sql of [PLATFORM_CONFIGURATION_VERSIONS_SQL, PLATFORM_AI_USAGE_PROFILES_SQL]) assert.doesNotMatch(sql, /\b(insert|update|delete|truncate|alter|drop|grant)\b/i);
  for (const table of ['platform.configuration_proposal', 'platform.configuration_approval_event', 'platform.configuration_rejection_event', 'platform.configuration_activation_event', 'platform.current_agent_configuration']) assert.ok(PLATFORM_CONFIGURATION_VERSIONS_SQL.includes(table), table);
  const warn = console.warn; console.warn = () => {};
  try {
    const failing = fakePool({ failOn: 'from platform.ai_usage_profile' });
    __setPlatformConfigurationPoolsForTests({ reader: failing });
    await assert.rejects(readAgentConfigurationRows({ environment: 'production' }), error => error.status === 503 && error.message === PLATFORM_AGENTS_UNAVAILABLE_MESSAGE);
    assert.equal(failing.queries.at(-1).sql, 'rollback');
    assert.deepEqual(failing.released, [true]);
  } finally { console.warn = warn; }
});

test('escritura: sólo funciones platform.*, sin variable → 503, error de la base → 409 neutro', async t => {
  t.after(() => __setPlatformConfigurationPoolsForTests(null));
  for (const sql of Object.values(PLATFORM_ADMIN_SQL)) {
    assert.match(sql, /^select platform\.(propose_configuration|approve_configuration|reject_configuration|reactivate_configuration|create_ai_usage_profile|archive_ai_usage_profile)\(/);
    assert.doesNotMatch(sql, /\b(insert|update|delete)\b/i);
  }
  await assert.rejects(approveConfiguration({ versionId: '1', actor: 'Juan', env: {} }), error => error.status === 503 && error.message === PLATFORM_ADMIN_UNAVAILABLE_MESSAGE);
  const admin = fakePool({ rows: { 'platform.propose_configuration': [{ result: '7' }] } });
  __setPlatformConfigurationPoolsForTests({ admin });
  const versionId = await proposeConfiguration({ agentId: 'AGT-003', environment: 'production', configuration: validConfiguration(), actor: 'Juan Botero', reason: 'motivo' });
  assert.equal(versionId, '7');
  assert.deepEqual(admin.queries.map(query => query.sql), ['begin', 'set local statement_timeout = 5000', PLATFORM_ADMIN_SQL.propose, 'commit']);
  assert.deepEqual(admin.queries[2].params, ['AGT-003', 'production', JSON.stringify(validConfiguration()), 'Juan Botero', 'motivo']);
  const warn = console.warn; console.warn = () => {};
  try {
    const failing = fakePool({ failOn: 'platform.approve_configuration' });
    __setPlatformConfigurationPoolsForTests({ admin: failing });
    await assert.rejects(approveConfiguration({ versionId: '7', actor: 'Juan' }), error => error.status === 409 && error.message === PLATFORM_ADMIN_REJECTED_MESSAGE && !/db\.internal|permission/.test(error.message));
    assert.equal(failing.queries.at(-1).sql, 'rollback');
    assert.deepEqual(failing.released, [true]);
    __setPlatformConfigurationPoolsForTests({ admin: fakePool({ connectError: new Error('password authentication failed') }) });
    await assert.rejects(approveConfiguration({ versionId: '7', actor: 'Juan' }), error => error.status === 503 && error.message === PLATFORM_ADMIN_UNAVAILABLE_MESSAGE);
  } finally { console.warn = warn; }
});
