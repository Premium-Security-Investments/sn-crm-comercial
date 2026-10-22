// AGT-003 — Chat de registro con Vig-IA en Mi día (Juan, 2026-10-15): contrato, limpieza de la propuesta, entrada de la
// IA y reglas del servidor (propone, nada se guarda sin "Confirmar"; cupo propio de 100 al día).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  addDays, chatCalendar, chatRegistroOutputSchema, describeChatAction, humanDay, normalizeChatOutput, weekdayName,
  CHAT_NEXT_MAX_DAYS, CHAT_REGISTRO_DEFAULT_DAILY_MAX,
} from '../src/vigia/chat-registro.js';
import { assignChatRefs, buildChatInput, chatDayToIso, chatQuotaMessage, planSupersededChatProposals, CHAT_POLICY, CHAT_SUPERSEDED_BY_KEY, runChatTurn } from '../agt003-chat-registro.js';
import { AGENT_AI_FUNCTIONS } from '../platform-agent-configuration.js';
import { AGT003_CHAT_CAPABILITY, MODEL_GATEWAY_REJECTION_CODES } from '../platform-model-gateway.js';

const TODAY = '2026-10-15'; // jueves
const refs = new Map([['o1', { id: 'id-1', label: 'Frontier' }], ['o2', { id: 'id-2', label: 'Conjunto Los Pinos' }]]);
const serviceCodes = ['vigilancia_fisica', 'tecnologia'];

test('fechas: calendario en español con hoy y mañana', () => {
  assert.equal(weekdayName(TODAY), 'jueves');
  assert.equal(addDays(TODAY, 5), '2026-10-20');
  const calendar = chatCalendar(TODAY);
  assert.equal(calendar.length, 15);
  assert.equal(calendar[0], '2026-10-15 jueves (hoy)');
  assert.equal(calendar[1], '2026-10-16 viernes (mañana)');
  assert.equal(humanDay('2026-10-20'), 'martes 20 oct');
});

test('contrato cerrado: servicios y regionales como listas cerradas, sin licitación pública', () => {
  const schema = chatRegistroOutputSchema([...serviceCodes, 'licitacion_publica']);
  assert.equal(schema.additionalProperties, false);
  const item = schema.properties.acciones.items;
  assert.equal(item.additionalProperties, false);
  assert.deepEqual(item.properties.nueva.properties.service_type_code.enum, serviceCodes);
  assert.ok(item.properties.nueva.properties.regional_nombre.enum.includes('Antioquia'));
  assert.ok(Buffer.byteLength(JSON.stringify(schema)) < 65_536);
});

test('limpieza: seguimiento, próxima fecha y datos de un cliente conocido', () => {
  const out = normalizeChatOutput({
    respuesta: 'Listo, preparé los cambios.',
    acciones: [
      { tipo: 'registrar_seguimiento', ref: 'o1', canal: 'llamada', fecha: TODAY, nota: 'Hablé con la gerente; quieren 2 puestos.' },
      { tipo: 'proximo_seguimiento', ref: 'o1', fecha: '2026-10-20' },
      { tipo: 'actualizar_datos', ref: 'o1', datos: { current_security_provider: 'Atlas', current_contract_end_date: '2027-03-31', decision_maker_title: 'Gerente' } },
    ],
  }, { refs, today: TODAY, serviceCodes });
  assert.equal(out.acciones.length, 3);
  assert.deepEqual(out.acciones[1], { tipo: 'proximo_seguimiento', ref: 'o1', fecha: '2026-10-20' });
  assert.equal(out.acciones[2].datos.current_security_provider, 'Atlas');
  assert.deepEqual(out.avisos, []);
});

test('limpieza: referencias inventadas, fechas fuera de rango y datos vacíos no pasan', () => {
  const out = normalizeChatOutput({
    respuesta: 'Ok',
    acciones: [
      { tipo: 'registrar_seguimiento', ref: 'o99', nota: 'x' },
      { tipo: 'registrar_seguimiento', ref: 'id-1', nota: 'x' },
      { tipo: 'proximo_seguimiento', ref: 'o1', fecha: addDays(TODAY, CHAT_NEXT_MAX_DAYS + 1) },
      { tipo: 'proximo_seguimiento', ref: 'o1', fecha: '2026-10-14' },
      { tipo: 'actualizar_datos', ref: 'o2', datos: { decision_maker_email: 'no-es-correo' } },
      { tipo: 'borrar_todo', ref: 'o1' },
      { tipo: 'registrar_seguimiento', ref: 'o2', fecha: '2025-01-01', nota: 'Visita' },
    ],
  }, { refs, today: TODAY, serviceCodes });
  assert.equal(out.acciones.length, 1);
  assert.equal(out.acciones[0].fecha, TODAY, 'una fecha de contacto vieja queda con la fecha de hoy');
  assert.equal(out.avisos.length, 4);
});

test('limpieza: "no tiene proveedor" borra proveedor y vencimiento; acciones repetidas se combinan', () => {
  const out = normalizeChatOutput({
    respuesta: 'Ok',
    acciones: [
      { tipo: 'actualizar_datos', ref: 'o1', datos: { current_security_provider_none: true, current_security_provider: 'Atlas', company_nit: '900.123.456' } },
      { tipo: 'actualizar_datos', ref: 'o1', datos: { decision_maker_name: 'Ana Gómez' } },
      { tipo: 'proximo_seguimiento', ref: 'o1', fecha: '2026-10-20' },
      { tipo: 'proximo_seguimiento', ref: 'o1', fecha: '2026-10-22' },
    ],
  }, { refs, today: TODAY, serviceCodes });
  assert.equal(out.acciones.length, 2);
  assert.deepEqual(out.acciones[0].datos, { company_nit: '900.123.456', current_security_provider_none: true, decision_maker_name: 'Ana Gómez' });
  assert.equal(out.acciones[1].fecha, '2026-10-22');
});

test('cliente nuevo: exige servicio y regional válidos; lleva nota y próxima fecha', () => {
  const out = normalizeChatOutput({
    respuesta: 'Ok',
    acciones: [
      { tipo: 'crear_oportunidad', nueva: { company_name: 'Clínica Norte', service_type_code: 'vigilancia_fisica', regional_nombre: 'Antioquia', quote_city: 'Medellín' }, nota: 'Visita inicial', canal: 'reunion', fecha: TODAY, proxima_fecha: '2026-10-21' },
      { tipo: 'crear_oportunidad', nueva: { company_name: 'Sin servicio', service_type_code: 'licitacion_publica', regional_nombre: 'Antioquia' } },
      { tipo: 'crear_oportunidad', nueva: { company_name: 'Sin regional', service_type_code: 'tecnologia', regional_nombre: 'Marte' } },
    ],
  }, { refs, today: TODAY, serviceCodes });
  assert.equal(out.acciones.length, 1);
  assert.equal(out.acciones[0].nueva.quote_city, 'Medellín');
  assert.equal(out.acciones[0].proxima_fecha, '2026-10-21');
  assert.equal(out.avisos.length, 2);
  const described = describeChatAction(out.acciones[0], { serviceName: () => 'Vigilancia física' });
  assert.equal(described.cliente, 'Clínica Norte');
  assert.match(described.lineas[0], /Cliente nuevo · Vigilancia física · Antioquia/);
  assert.ok(described.lineas.some(line => line === 'Reunión del jueves 15 oct: Visita inicial'));
});

test('limpieza: respuesta sin texto o JSON roto es un error de estructura', () => {
  assert.throws(() => normalizeChatOutput('{no json', { refs, today: TODAY }), error => error.code === 'AGT003_CHAT_INVALID_JSON');
  assert.throws(() => normalizeChatOutput({ acciones: [] }, { refs, today: TODAY }), error => error.code === 'AGT003_CHAT_INVALID_SHAPE');
});

test('entrada de la IA: referencias cortas, sin ids reales, con perfil faltante e historial', () => {
  const { refs: map, rows } = assignChatRefs([
    { id: 'uuid-a', company_name: 'Frontier', quote_city: 'Rionegro', stage_name: 'Prospecto', next_action_at: '2026-10-20', decision_maker_email: 'a@b.co', company_website: 'https://frontier.co' },
  ]);
  assert.equal(map.get('o1').id, 'uuid-a');
  const input = buildChatInput({ today: TODAY, comercial: 'Ana', canCreate: false, rows, services: [{ code: 'tecnologia', name: 'Tecnología' }, { code: 'licitacion_publica', name: 'Licitación' }], history: [{ user_text: 'hola', reply_text: 'Hola', proposal_status: null }], mensaje: 'Llamé a Frontier' });
  assert.equal(input.hoy, '2026-10-15 (jueves)');
  assert.equal(input.comercial.puede_crear_oportunidades, false);
  assert.deepEqual(input.servicios, [{ codigo: 'tecnologia', nombre: 'Tecnología' }]);
  assert.equal(input.oportunidades[0].ref, 'o1');
  assert.ok(!JSON.stringify(input).includes('uuid-a'), 'la IA nunca ve el id real');
  assert.ok(input.oportunidades[0].faltan_del_perfil.includes('Teléfono del decisor'));
  assert.equal(input.historial[0].propuesta, 'sin_cambios');
});

test('política: propone sin guardar, pregunta ante la duda y respeta pendientes', () => {
  assert.match(CHAT_POLICY, /Tú no guardas nada; sólo propones/);
  assert.match(CHAT_POLICY, /Si hay duda entre dos o más, NO propongas cambios/);
  assert.match(CHAT_POLICY, /puede_crear_oportunidades = false/);
  assert.match(CHAT_POLICY, /No cambies etapa, valor de la oferta ni dueño/);
});

test('turno por el puente: usa la capacidad del chat y limpia la salida', async () => {
  let call = null;
  const client = { async run(args) { call = args; return { content: { respuesta: 'Listo.', acciones: [{ tipo: 'proximo_seguimiento', ref: 'o1', fecha: '2026-10-20' }] }, usage: { input_tokens: 10, output_tokens: 5 } }; } };
  const env = { AGT003_COPILOT_ENGINE: 'agt003_bridge_preview', AGT003_COPILOT_MODEL: 'sonnet', AGT003_COPILOT_BRIDGE_URL: 'https://bridge.example', AGT003_COPILOT_HMAC_SECRET: 'x'.repeat(40) };
  const result = await runChatTurn({ input: { mensaje: 'x' }, refs, today: TODAY, serviceCodes, idempotencyKey: 'k1', environment: env, client, recordUsage: async () => {} });
  assert.equal(call.policy, CHAT_POLICY);
  assert.equal(call.idempotencyKey, 'k1');
  assert.equal(result.output.acciones[0].fecha, '2026-10-20');
});

test('cupo: función propia de 100 al día en IT → Agentes y rechazos registrados sin llamar al modelo', () => {
  const chat = AGENT_AI_FUNCTIONS['AGT-003'].find(item => item.capability === AGT003_CHAT_CAPABILITY);
  assert.deepEqual(chat.default_cap, { per: 'day', max: 100 });
  assert.equal(CHAT_REGISTRO_DEFAULT_DAILY_MAX, 100);
  assert.ok(MODEL_GATEWAY_REJECTION_CODES.has('AGT003_CHAT_QUOTA'));
  assert.ok(MODEL_GATEWAY_REJECTION_CODES.has('AGT003_CHAT_PERSONAL_QUOTA'));
  assert.match(chatQuotaMessage('team', 100, 100), /del equipo para hoy \(100 de 100\)/);
});

test('servidor: rutas del chat en la matriz auditable, mismas reglas del formulario, espejo idéntico', () => {
  const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
  assert.equal(server, api);
  for (const route of ['GET /api/agt003/chat', 'POST /api/agt003/chat', 'POST /api/agt003/chat/confirm', 'POST /api/agt003/chat/discard']) {
    assert.ok(server.includes(`'${route}': ['opportunities', ACTIONS.AI_COMMERCIAL_DRAFT_RUN]`), route);
  }
  assert.match(server, /eq\('proposal_status', 'pendiente'\)\.select\('id,proposal'\)/, 'confirmar es atómico: pendiente → aplicando');
  assert.match(server, /createOpportunityForProfile\(database, profile, \{/);
  assert.match(server, /updateOpportunityForProfile\(database, profile, action\.opportunity_id, body\)/);
  assert.match(server, /addInteractionForProfile\(database, profile, action\.opportunity_id/);
  assert.match(server, /requireNoPendingDecisions\(database, currentProfile\.id\)/, 'crear sigue exigiendo estar al día');
});

test('migración 132: tabla sólo para el servidor y reserva con cupo de equipo y persona', () => {
  const sql = readFileSync(new URL('../supabase/migrations/132_agt003_chat_registro.sql', import.meta.url), 'utf8');
  assert.match(sql, /revoke all on table public\.psi_agt003_chat_turns from public, anon, authenticated, service_role/);
  assert.match(sql, /grant select, insert, update on table public\.psi_agt003_chat_turns to service_role/);
  assert.match(sql, /grant execute on function public\.psi_claim_agt003_chat_turn\(uuid, text, integer, timestamptz, integer, timestamptz\) to service_role/);
  assert.match(sql, /'scope', 'actor'/);
  assert.doesNotMatch(sql, /grant[^;]*to (anon|authenticated)/i);
});

test('servidor: las funciones del chat conservan los mismos controles que las rutas del formulario y la ficha', () => {
  const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const body = (start) => { const i = server.indexOf(start); assert.ok(i >= 0, start); return server.slice(i, server.indexOf('\n}\n', i)); };
  const routeBody = (start) => { const i = server.indexOf(start); assert.ok(i >= 0, start); return server.slice(i, server.indexOf('\n});\n', i)); };
  const pairs = [
    [body('async function createOpportunityForProfile('), routeBody("app.post('/api/opportunities', async"), [
      'cleanOpportunity(', "currentProfile.role === 'comercial') payload.owner_id = currentProfile.id", 'requireOpportunityAction(database, currentProfile, payload.owner_id, ACTIONS.CRM_OPPORTUNITY_CREATE)',
      'requireNoPendingDecisions(database, currentProfile.id)', 'prepareClientForNewOpportunity(', 'persistSalesOpportunity(', 'saveClientProfile(']],
    [body('async function updateOpportunityForProfile('), routeBody("app.put('/api/opportunity', async"), [
      'ensureOpportunityAccess(database, id, currentProfile, ACTIONS.CRM_OPPORTUNITY_EDIT)', 'keepHiddenOpportunityFields(', 'ACTIONS.CRM_OPPORTUNITY_REASSIGN',
      'prepareClientForOpportunityUpdate(', 'canEditCustomerSegment(currentProfile, existing)', 'resolveClientArgsForOpportunityUpdate(', 'logCustomerSegmentChange(', 'saveClientProfile(']],
    [body('async function addInteractionForProfile('), routeBody("app.post('/api/opportunity-interactions', async"), [
      'ensureOpportunityAccess(database, id, currentProfile, ACTIONS.CRM_OPPORTUNITY_EDIT)', 'No puede registrar seguimientos a nombre de otro usuario.', 'preparePublicInteractionNotes(',
      // Desde el 2026-10-22 la escritura de "última gestión" pasa por advancedLastInteraction, que sólo avanza:
      // el control compartido ya no es el literal del campo sino la llamada a esa regla.
      "from('psi_sales_interactions').insert(row)", 'advancedLastInteraction(']],
  ];
  for (const [helper, route, guards] of pairs) {
    for (const guard of guards) {
      assert.ok(route.includes(guard), `la ruta sigue teniendo: ${guard}`);
      assert.ok(helper.includes(guard), `la función del chat también tiene: ${guard}`);
    }
  }
});

test('limpieza: la próxima fecha también se acepta en proxima_fecha (dentro del seguimiento o de la acción)', () => {
  const out = normalizeChatOutput({
    respuesta: 'Ok',
    acciones: [
      { tipo: 'proximo_seguimiento', ref: 'o1', proxima_fecha: '2026-10-20' },
      { tipo: 'registrar_seguimiento', ref: 'o2', canal: 'reunion', fecha: TODAY, nota: 'Visita', proxima_fecha: '2026-10-21' },
    ],
  }, { refs, today: TODAY, serviceCodes });
  assert.deepEqual(out.acciones.filter(a => a.tipo === 'proximo_seguimiento').map(a => [a.ref, a.fecha]), [['o1', '2026-10-20'], ['o2', '2026-10-21']]);
  assert.deepEqual(out.avisos, []);
});

test('una sola propuesta confirmable: la anterior sin confirmar queda reemplazada, no descartada por el comercial', () => {
  const now = new Date('2026-10-22T14:00:00.000Z');
  const rows = [
    { id: 'vieja', proposal_status: 'pendiente', proposal: { acciones: [{ tipo: 'proximo_seguimiento' }], avisos: [] } },
    { id: 'tambien-vieja', proposal_status: 'pendiente', proposal: null },
    { id: 'ya-guardada', proposal_status: 'confirmada', proposal: { acciones: [], avisos: [] } },
    { id: 'descartada-por-el', proposal_status: 'descartada', proposal: { acciones: [], avisos: [] } },
    { id: 'nueva', proposal_status: 'pendiente', proposal: { acciones: [{ tipo: 'registrar_seguimiento' }], avisos: [] } },
  ];
  const plan = planSupersededChatProposals(rows, { turnId: 'nueva', now });

  assert.deepEqual(plan.map(item => item.id), ['vieja', 'tambien-vieja'], 'sólo las pendientes, nunca la nueva');
  assert.equal(plan[0].patch.proposal_status, 'descartada', 'la migración 132 sólo admite cuatro estados');
  assert.equal(plan[0].patch.decided_at, '2026-10-22T14:00:00.000Z');
  assert.equal(plan[0].patch.proposal[CHAT_SUPERSEDED_BY_KEY], 'nueva', 'el motivo queda en la propuesta');
  assert.deepEqual(plan[0].patch.proposal.acciones, [{ tipo: 'proximo_seguimiento' }], 'lo propuesto se conserva');
  assert.equal(plan[1].patch.proposal[CHAT_SUPERSEDED_BY_KEY], 'nueva', 'una propuesta vacía también se cierra');
  assert.deepEqual(planSupersededChatProposals(rows, { turnId: null, now }), [], 'sin turno nuevo no se reemplaza nada');
});

test('servidor y pantalla: el reemplazo corre al cerrar el turno, sólo si propone acciones, y la tarjeta lo dice', () => {
  const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
  assert.equal(server, api, 'el espejo de Vercel queda igual');
  assert.match(server, /if \(proposal\.acciones\.length\) await supersedeOlderChatProposals\(database, \{ actorId: currentProfile\.id, turnId \}\);/,
    'sólo una propuesta con acciones reemplaza a la anterior');
  const helper = server.slice(server.indexOf('async function supersedeOlderChatProposals('), server.indexOf('async function chatCanCreate('));
  assert.match(helper, /\.eq\('actor_id', actorId\)\.eq\('proposal_status', 'pendiente'\)\.neq\('id', turnId\)/, 'sólo las pendientes del mismo comercial');
  assert.match(helper, /\.eq\('id', id\)\.eq\('proposal_status', 'pendiente'\)/, 'el parche es atómico: pendiente → descartada');
  assert.match(helper, /catch \(error\) \{\n    console\.warn\('agt003 chat: no se pudo reemplazar la propuesta anterior'/, 'una falla al reemplazar no rompe el turno');
  assert.match(server, /quedó reemplazada por lo que contó después/, 'confirmar una tarjeta vieja explica por qué no se puede');
  const ui = readFileSync(new URL('../src/vigia/VigiaChatRegistro.tsx', import.meta.url), 'utf8');
  assert.match(ui, /proposal\.reemplazada_por \? 'Reemplazado por lo que contó después: no se guardó nada' : 'Descartado: no se guardó nada'/);
  assert.match(ui, /reemplazada_por\?: string/, 'el tipo del turno declara el motivo');
});

test('fechas del chat: el día se guarda al mediodía de Bogotá, no a medianoche UTC', () => {
  // Defecto real del 2026-10-22: el próximo seguimiento de Frontier quedó el domingo 25 a las 19:00 (Bogotá)
  // porque "2026-10-26" se guardó como medianoche UTC.
  assert.equal(chatDayToIso('2026-10-26'), '2026-10-26T17:00:00.000Z');
  const enBogota = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' });
  for (const day of ['2026-10-26', '2026-01-01', '2026-12-31', '2026-06-15']) {
    assert.equal(enBogota.format(new Date(chatDayToIso(day))), day, `${day} se sigue viendo el mismo día en Bogotá`);
  }
  // Mismo criterio que el formulario de la ficha (src/followUpDate.ts: mediodía con desfase -05:00).
  const comoElFormulario = new Date('2026-10-26T12:00:00-05:00').toISOString();
  assert.equal(chatDayToIso('2026-10-26'), comoElFormulario);
  // Lo que no es un día exacto pasa sin tocarse: un instante completo ya trae su hora.
  assert.equal(chatDayToIso('2026-10-26T14:30:00.000Z'), '2026-10-26T14:30:00.000Z');
  assert.equal(chatDayToIso(null), null);
  assert.equal(chatDayToIso(''), null);
});

test('servidor: las tres fechas que escribe el chat pasan por la conversión', () => {
  const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
  assert.equal(server, api, 'el espejo de Vercel queda igual');
  assert.match(server, /occurred_at: chatDayToIso\(action\.fecha\), interaction_type: action\.canal \}/, 'seguimiento registrado');
  assert.match(server, /update\(\{ next_action_at: chatDayToIso\(action\.fecha\) \}\)/, 'próximo seguimiento');
  assert.match(server, /next_action_at: chatDayToIso\(action\.proxima_fecha\) \|\| null,/, 'oportunidad nueva');
  assert.match(server, /occurred_at: chatDayToIso\(action\.fecha\), interaction_type: action\.canal \|\| 'nota' \}/, 'nota de la oportunidad nueva');
  assert.doesNotMatch(server, /occurred_at: action\.fecha\b/, 'ya no queda ninguna fecha del chat sin convertir');
  assert.doesNotMatch(server, /next_action_at: action\.(fecha|proxima_fecha)\b/);
});

test('migración 148: corrige sólo las tres filas afectadas, exigiendo el valor viejo', () => {
  const sql = readFileSync(new URL('../supabase/migrations/148_crm_corregir_fechas_del_chat.sql', import.meta.url), 'utf8');
  const updates = sql.match(/update public\./g) || [];
  assert.equal(updates.length, 4, 'tres fechas más el último seguimiento de Frontier');
  assert.equal((sql.match(/timestamptz '2026-10-26 17:00:00\+00'/g) || []).length, 1, 'el lunes 26 al mediodía de Bogotá');
  assert.equal((sql.match(/timestamptz '2026-10-22 17:00:00\+00'/g) || []).length, 3);
  // Cada update exige el valor viejo: si alguien ya lo corrigió a mano, no se vuelve a mover.
  assert.equal((sql.match(/and (next_action_at|occurred_at|last_interaction_at) = timestamptz '2026-10-2[26] 00:00:00\+00'/g) || []).length, 4);
  const ejecutable = sql.replace(/^\s*--.*$/gm, '');
  assert.doesNotMatch(ejecutable, /alter |create |drop |delete from|truncate/i, 'la 148 es sólo datos');
  const rollback = readFileSync(new URL('../supabase/rollbacks/148_crm_corregir_fechas_del_chat_rollback.sql', import.meta.url), 'utf8');
  assert.match(rollback, /set next_action_at = timestamptz '2026-10-26 00:00:00\+00'/);
});
