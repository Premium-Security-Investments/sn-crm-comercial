// AGT-003 — toda oportunidad abierta queda con próxima gestión (F4; Juan, 2026-10-22).
// Cubre la regla pura, dónde la exige el servidor, el orden con que el chat aplica su propuesta y la pantalla.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  followUpDateRequirement, hasLiveNextAction, nextActionRequirement,
  FOLLOW_UP_DATE_CODE, NEXT_ACTION_MAX_DAYS, NEXT_ACTION_PAST_MESSAGE, NEXT_ACTION_REQUIRED_CODE,
  NEXT_ACTION_REQUIRED_MESSAGE, NEXT_ACTION_TERMINAL_STAGES, NEXT_ACTION_TOO_FAR_CODE,
} from '../src/vigia/next-action-rule.js';

const NOW = new Date('2026-10-22T15:00:00.000Z');
const enDias = (days) => new Date(NOW.getTime() + days * 86_400_000).toISOString();

test('la regla: una oportunidad abierta no se guarda sin próxima gestión futura', () => {
  const abierta = { stageCode: 'envio_oferta', now: NOW };

  assert.deepEqual(nextActionRequirement({ ...abierta, proposedNextActionAt: enDias(3) }), { ok: true });
  assert.deepEqual(nextActionRequirement({ ...abierta, currentNextActionAt: enDias(5) }), { ok: true },
    'si ya hay compromiso vigente no se vuelve a pedir');

  const sinNada = nextActionRequirement(abierta);
  assert.equal(sinNada.ok, false);
  assert.equal(sinNada.code, NEXT_ACTION_REQUIRED_CODE);
  assert.equal(sinNada.message, NEXT_ACTION_REQUIRED_MESSAGE);

  const vencida = nextActionRequirement({ ...abierta, currentNextActionAt: enDias(-2) });
  assert.equal(vencida.ok, false, 'una fecha que ya pasó no es compromiso: es justo lo que Mi día marca vencido');
  assert.equal(vencida.message, NEXT_ACTION_REQUIRED_MESSAGE);

  const haciaAtras = nextActionRequirement({ ...abierta, proposedNextActionAt: enDias(-1) });
  assert.equal(haciaAtras.ok, false);
  assert.equal(haciaAtras.message, NEXT_ACTION_PAST_MESSAGE, 'el mensaje distingue "falta" de "quedó en el pasado"');
});

test('la regla: el negocio cerrado no necesita próxima gestión', () => {
  assert.deepEqual(NEXT_ACTION_TERMINAL_STAGES, ['aprobado', 'perdido', 'descartado']);
  for (const stageCode of NEXT_ACTION_TERMINAL_STAGES) {
    assert.deepEqual(nextActionRequirement({ stageCode, now: NOW }), { ok: true }, stageCode);
  }
  assert.deepEqual(nextActionRequirement({ stageCode: 'prospecto', proposedNextActionAt: '2026-10-25 08:00:00+00', now: NOW }), { ok: true },
    'el formato que entrega Postgres se entiende');
});

test('hasLiveNextAction: sólo una fecha futura cuenta como agenda vigente', () => {
  assert.equal(hasLiveNextAction({ nextActionAt: enDias(1), now: NOW }), true);
  assert.equal(hasLiveNextAction({ nextActionAt: enDias(-1), now: NOW }), false);
  assert.equal(hasLiveNextAction({ nextActionAt: null, now: NOW }), false);
  assert.equal(hasLiveNextAction({ nextActionAt: 'no es fecha', now: NOW }), false);
});

test('servidor: la regla se exige al registrar seguimiento y al mover la etapa, y la licitación queda fuera', () => {
  const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
  assert.equal(server, api, 'el espejo de Vercel queda igual');

  // El servidor importa las dos reglas del mismo módulo desde el 2026-11-02: la del próximo paso y la de la fecha
  // del seguimiento.
  assert.match(server, /import \{ followUpDateRequirement, nextActionRequirement \} from '\.\.\/src\/vigia\/next-action-rule\.js';/);
  const helper = server.slice(server.indexOf('function requireNextAction('), server.indexOf('async function addInteractionForProfile('));
  assert.match(helper, /error\.status = 400/);
  assert.match(helper, /error\.code = verdict\.code/);

  // Registrar seguimiento: la función del chat y la ruta de la ficha.
  assert.equal(server.split('requireNextAction({ stageCode: existing.stage_code, currentNextActionAt: existing.next_action_at, proposedNextActionAt: body.next_action_at || null })').length - 1, 1);
  assert.match(server, /requireNextAction\(\{ stageCode: existingOpportunity\.stage_code, currentNextActionAt: existingOpportunity\.next_action_at, proposedNextActionAt: req\.body\.next_action_at \|\| null \}\)/);

  // Cambio de etapa: la función del chat/ficha y las dos rutas; siempre con la licitación excluida.
  assert.equal(server.split("if (!isPublicTender && (payload.stage_code || null) !== (existing.stage_code || null))").length - 1, 3,
    'las tres rutas que editan la oportunidad exigen la próxima gestión al mover la etapa');

  // La oportunidad que carga el control de acceso trae etapa y próxima gestión: sin eso la regla no puede decidir
  // y el registro del cambio de etapa comparaba contra undefined.
  // last_interaction_at entró el 2026-10-22: las rutas que registran una gestión lo comparan antes de
  // escribirlo, para que "última gestión" no retroceda al registrar algo viejo (advancedLastInteraction).
  assert.match(server, /select\('id,owner_id,client_id,service_type_code,company_name,customer_segment,regional_nombre,sede,quote_city,economic_sector,decision_maker_name,decision_maker_email,decision_maker_phone,stage_code,next_action_at,last_interaction_at,deleted_at'\)/);
});

test('chat: la próxima gestión se aplica antes del seguimiento, conservando el índice de cada acción', () => {
  const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  assert.match(server, /const chatActionsInOrder = \[\.\.\.\(claimed\.proposal\?\.acciones \|\| \[\]\)\.entries\(\)\]\s+\.sort\(\(\[, a\], \[, b\]\) => Number\(b\?\.tipo === 'proximo_seguimiento'\) - Number\(a\?\.tipo === 'proximo_seguimiento'\)\);/);
  assert.match(server, /for \(const \[index, action\] of chatActionsInOrder\) \{/);

  // El orden importa porque el chat trae las dos cosas como acciones separadas; simulamos el mismo criterio.
  const acciones = [
    { tipo: 'registrar_seguimiento' }, { tipo: 'actualizar_datos' }, { tipo: 'proximo_seguimiento' },
  ];
  const ordenadas = [...acciones.entries()]
    .sort(([, a], [, b]) => Number(b?.tipo === 'proximo_seguimiento') - Number(a?.tipo === 'proximo_seguimiento'));
  assert.deepEqual(ordenadas.map(([index, action]) => [index, action.tipo]), [
    [2, 'proximo_seguimiento'], [0, 'registrar_seguimiento'], [1, 'actualizar_datos'],
  ], 'la próxima gestión primero; el resto conserva su orden y su índice original');

  const policy = readFileSync(new URL('../verticales/comercial/agt003-chat-registro.js', import.meta.url), 'utf8');
  assert.match(policy, /Todo seguimiento va acompañado de su proximo_seguimiento/, 'Vig-IA pide la fecha en vez de dejarla vacía');
});

test('pantalla: el campo deja de ser opcional cuando hace falta, y el listado se puede filtrar', () => {
  const ui = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(ui, /const nextActionRequired = !isTerminalStage\(opportunity\.stage_code\) && opportunity\.service_type_code !== 'licitacion_publica' && !liveNextAction;/);
  assert.match(ui, /\{nextActionRequired \? 'Próxima gestión' : 'Próxima gestión \(opcional\)'\}/);
  assert.match(ui, /required=\{nextActionRequired\}/);
  assert.match(ui, /checked=\{onlyWithoutNextAction\}/, 'casilla "Sin próxima gestión" en los filtros');
  assert.match(ui, /!onlyWithoutNextAction \|\| \(!isTerminalStage\(o\.stage_code\) && !hasLiveNextAction\(\{ nextActionAt: o\.next_action_at \}\)\)/);
});

// ---------------------------------------------------------------------------------------------------------------------
// Fechas imposibles (hallazgo del 2026-11-02): por no tener tope, entraron seguimientos fechados en 2027 y 2030 y una
// próxima gestión en octubre de 2027, que dejó una oportunidad activa invisible para Mi día.

test('la próxima gestión tiene tope de 90 días, el mismo que exige la base al decidir', () => {
  const abierta = { stageCode: 'prospecto', now: NOW };
  assert.equal(NEXT_ACTION_MAX_DAYS, 90);
  assert.deepEqual(nextActionRequirement({ ...abierta, proposedNextActionAt: enDias(89) }), { ok: true });
  assert.deepEqual(nextActionRequirement({ ...abierta, proposedNextActionAt: enDias(90) }), { ok: true }, 'el día 90 todavía cabe');

  for (const dias of [91, 180, 365, 1200]) {
    const verdict = nextActionRequirement({ ...abierta, proposedNextActionAt: enDias(dias) });
    assert.equal(verdict.ok, false, `${dias} días`);
    assert.equal(verdict.code, NEXT_ACTION_TOO_FAR_CODE);
    // El mensaje no dice sólo "no se puede": dice qué hacer en los dos casos reales.
    assert.match(verdict.message, /congele la oportunidad/);
    assert.match(verdict.message, /Vence el contrato actual/);
  }
});

test('el tope no se le aplica a lo ya guardado: una fecha vieja absurda no bloquea un seguimiento nuevo', () => {
  // Central Mayorista quedó con la próxima gestión en 2027 antes de que existiera esta regla. Su comercial tiene que
  // poder seguir registrando seguimientos; lo que se impide es escribir otra fecha así.
  const verdict = nextActionRequirement({ stageCode: 'prospecto', currentNextActionAt: enDias(400), now: NOW });
  assert.deepEqual(verdict, { ok: true });
});

test('la fecha de un seguimiento no puede ser futura, y el pasado queda libre', () => {
  assert.deepEqual(followUpDateRequirement({ occurredAt: enDias(-1), now: NOW }), { ok: true }, 'ayer sí');
  assert.deepEqual(followUpDateRequirement({ occurredAt: enDias(-400), now: NOW }), { ok: true },
    'registrar algo viejo es legítimo: el chat tiene su propia ventana de 30 días');
  assert.deepEqual(followUpDateRequirement({ now: NOW }), { ok: true }, 'sin fecha no hay nada que juzgar');

  for (const dias of [1, 30, 365, 1300]) {
    const verdict = followUpDateRequirement({ occurredAt: enDias(dias), now: NOW });
    assert.equal(verdict.ok, false, `${dias} días`);
    assert.equal(verdict.code, FOLLOW_UP_DATE_CODE);
    assert.match(verdict.message, /ya pasó/);
    assert.match(verdict.message, /próxima gestión/, 'y dice dónde va lo que sí es a futuro');
  }
});

test('servidor y pantalla: las dos reglas se aplican donde entraban las fechas imposibles', () => {
  const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
  assert.equal(server, api, 'el espejo de Vercel queda igual');

  // El seguimiento valida su fecha antes de escribirla.
  assert.match(server, /requireFollowUpDate\(body\.occurred_at \|\| null\);\n  const occurred_at =/);
  assert.equal((server.match(/function requireFollowUpDate\(/g) || []).length, 1, 'un solo ayudante');
  // Y el PUT de la ficha valida la próxima gestión aunque la etapa no cambie, que era el hueco.
  assert.match(server, /payload\.next_action_at && payload\.next_action_at !== existing\.next_action_at/);

  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(main, /type="date" max=\{hoyBogota\}/, 'el calendario no deja escoger un seguimiento futuro');
  assert.match(main, /type="datetime-local" required=\{nextActionRequired\} max=\{topeProximaGestion\}/);
  assert.match(main, /NEXT_ACTION_MAX_DAYS \* 86_400_000/, 'el tope de la pantalla sale de la regla, no de un número escrito aparte');
});
