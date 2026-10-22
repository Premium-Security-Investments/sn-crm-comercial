// AGT-003 — el día despejado de Mi día (Juan, 2026-10-22: "dice mucho pero no dice nada", "es muy frío",
// "no se aprovecha el espacio"). Sin nada vencido ni agendado para hoy, la pantalla deja de anunciar que no
// hay nada y pasa a ser la próxima conversación. Cubre el texto puro y lo que la pantalla arma con él.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';

const load = async (relative, named) => {
  const entry = new URL(relative, import.meta.url).pathname;
  const bundle = buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
  return (await import(moduleUrl))[named];
};
const pastDayPhrase = await load('../src/vigia/my-day-presentation.ts', 'pastDayPhrase');
const futureDayPhrase = await load('../src/vigia/my-day-presentation.ts', 'futureDayPhrase');
const readablePhone = await load('../src/vigia/my-day-presentation.ts', 'readablePhone');
const sentenceName = await load('../src/vigia/my-day-presentation.ts', 'sentenceName');

// Jueves 22 de octubre de 2026, 2:40 p. m. en Bogotá.
const NOW = new Date('2026-10-22T19:40:00.000Z');

test('una fecha pasada se nombra como se diría hablando', () => {
  assert.equal(pastDayPhrase('2026-10-22T14:05:21-05:00', NOW), 'hoy');
  assert.equal(pastDayPhrase('2026-10-21T23:30:00-05:00', NOW), 'ayer');
  assert.equal(pastDayPhrase('2026-10-18T08:00:00-05:00', NOW), 'hace 4 días');
  assert.equal(pastDayPhrase('2026-10-07T22:27:56-05:00', NOW), 'el 7 de octubre');
  assert.equal(pastDayPhrase(null, NOW), '', 'sin fecha no se inventa frase');
  assert.equal(pastDayPhrase('no es una fecha', NOW), '');
});

test('una fecha futura también, y el día de la semana sólo sirve dentro de la semana', () => {
  assert.equal(futureDayPhrase('2026-10-22T18:00:00-05:00', NOW), 'hoy');
  assert.equal(futureDayPhrase('2026-10-23T09:00:00-05:00', NOW), 'mañana');
  // El caso de Juan: la próxima gestión de Frontier.
  assert.equal(futureDayPhrase('2026-10-26T12:00:00-05:00', NOW), 'el lunes');
  assert.equal(futureDayPhrase('2026-10-28T12:00:00-05:00', NOW), 'el miércoles');
  // Más allá de seis días el nombre del día deja de ubicar a nadie: se dice la fecha.
  assert.equal(futureDayPhrase('2026-10-29T12:00:00-05:00', NOW), 'el 29 de octubre');
  assert.equal(futureDayPhrase('2026-12-15T12:00:00-05:00', NOW), 'el 15 de diciembre');
  assert.equal(futureDayPhrase(null, NOW), '');
});

test('el teléfono se puede leer en voz alta, y lo que no se reconoce se deja como está', () => {
  assert.equal(readablePhone('+573107285800'), '+57 310 728 5800');
  assert.equal(readablePhone('3122507283'), '312 250 7283');
  assert.equal(readablePhone('(312) 250-7283'), '312 250 7283');
  assert.equal(readablePhone('601 7425000 ext 12'), '601 7425000 ext 12', 'una extensión no se puede partir a ciegas');
  assert.equal(readablePhone(null), '');
});

test('un nombre que ya termina en punto no lleva otro al cerrar la frase', () => {
  assert.equal(sentenceName('Agroindustria La Margarita S.A.S.'), 'Agroindustria La Margarita S.A.S');
  assert.equal(sentenceName('Tuyomotor'), 'Tuyomotor');
  assert.equal(sentenceName(''), '');
});

test('la pantalla: el día despejado muestra la próxima conversación, no un aviso de que no hay nada', () => {
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  const start = main.indexOf('function MyDayHome(');
  const myDay = main.slice(start, main.indexOf('\nfunction ', start + 10));

  assert.match(myDay, /const isCalm = !pendingCount && !todayCount;/, 'el día despejado es "nada esperando decisión y nada para hoy"');
  assert.match(myDay, /\{isCalm && nextTalk\s*\n\s*\? <NextConversation opportunity=\{nextTalk\}/, 'y entonces el bloque fuerte es la próxima conversación');
  assert.match(myDay, /\{isCalm && <TodayDone opportunities=/, '"Hoy ya hizo": un día sin pendientes no es un día vacío');
  assert.match(myDay, /\{isCalm && <section className="my-day-book"/, 'la columna derecha responde "¿cómo voy?" con la cartera');
  // La próxima conversación se busca en toda la cartera, no sólo en los 7 días de "Esta semana".
  assert.match(myDay, /const nextTalk = useMemo\(\(\) => activeRows/, 'sale de las oportunidades con gestión futura, sin tope de semana');
  assert.match(myDay, /const weekRows = isCalm && nextTalk \? upcomingRows\.filter\(o => o\.id !== nextTalk\.id\) : upcomingRows;/,
    '"Esta semana" no repite lo que ya está arriba');
  assert.match(myDay, /Hoy está despejado\. Su próxima conversación es \$\{futureDayPhrase\(nextTalk\.next_action_at, now\)\}/);
  assert.match(myDay, /'Hoy está despejado\. No tiene ninguna conversación agendada\.'/, 'y sin nada agendado también lo dice');
  // El chat baja a la columna principal: en la lateral terminaba pesando más que el contenido.
  assert.match(myDay, /\{isCalm && canRenderOpportunityCopilot\(data\.currentProfile, null\) && <VigiaChatRegistro/);
});

test('la tarjeta sólo promete datos que Mi día ya tiene cargados', () => {
  const decision = readFileSync(new URL('../src/vigia/OpportunityDecision.tsx', import.meta.url), 'utf8');
  const card = decision.slice(decision.indexOf('export function NextConversation('), decision.indexOf('const DONE_LIMIT'));
  for (const field of ['decision_maker_name', 'decision_maker_phone', 'last_interaction_at', 'expected_close_date', 'economic_sector']) {
    assert.ok(card.includes(field), `la tarjeta usa ${field}, que viene en el bootstrap`);
  }
  // Mi día carga las oportunidades, no sus notas: no se puede contar de qué se habló sin una consulta nueva.
  assert.doesNotMatch(card, /notes|interaction_type|observaciones/, 'nada de texto de notas ni canal: no están cargados');
  assert.doesNotMatch(card, /\bapi\(/, 'la tarjeta no llama a ninguna ruta');

  const done = decision.slice(decision.indexOf('export function TodayDone('));
  assert.match(done, /const hit = candidates\.find\(\(\[at\]\) => at && bogotaDay\(at\) === today\);/,
    'cada oportunidad aporta un solo renglón: descartar y su gestión comparten la hora');
  assert.ok(done.indexOf('opportunity.approved_at') < done.indexOf('opportunity.last_interaction_at'),
    'ganar, perder y descartar pesan más que registrar');
});

test('el CSS del día despejado existe y conserva las dos columnas', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  for (const marker of ['.next-talk{', '.next-facts{', '.today-done h3{', '.my-day-book h3{', '.done-row{']) {
    assert.ok(css.includes(marker), `styles.css debe incluir ${marker}`);
  }
  assert.match(css, /\.my-day-grid\.is-calm\{grid-template-columns:minmax\(0,1fr\) 300px\}/,
    'el día despejado conserva las dos columnas: la derecha ya tiene qué decir');
  assert.match(css, /\.my-day-grid\.is-calm \.next-talk\{order:1\}/, 'en celular la próxima conversación va primero');
  assert.match(css, /\.my-day-grid\.is-calm \.vchat\{order:4\}/, 'y el chat después de la semana');
});

console.log('día despejado: texto puro, pantalla y CSS verificados');

test('la fecha de cierre no miente cuando ya pasó', async () => {
  const closeDateLine = await load('../src/vigia/my-day-presentation.ts', 'closeDateLine');
  // 74 de las 193 oportunidades abiertas tienen fecha de cierre pasada: decir "espera cerrarla hoy" de una
  // fecha de julio es afirmar algo falso. Defecto encontrado en la corrida técnica del 2026-10-22.
  assert.equal(closeDateLine('2026-12-15', NOW), 'Espera cerrarla el 15 de diciembre');
  assert.equal(closeDateLine('2026-10-23', NOW), 'Espera cerrarla mañana');
  assert.equal(closeDateLine('2026-10-22', NOW), 'Espera cerrarla hoy');
  assert.equal(closeDateLine('2026-10-21', NOW), 'La fecha de cierre que puso pasó ayer');
  assert.equal(closeDateLine('2026-07-30', NOW), 'La fecha de cierre que puso pasó el 30 de julio');
  assert.equal(closeDateLine(null, NOW), '');
  assert.equal(closeDateLine('', NOW), '');
});

test('sin cliente registrado no se afirma que sea la única oportunidad', () => {
  const decision = readFileSync(new URL('../src/vigia/OpportunityDecision.tsx', import.meta.url), 'utf8');
  const card = decision.slice(decision.indexOf('export function NextConversation('), decision.indexOf('const DONE_LIMIT'));
  assert.match(card, /sameClient === 1 \? 'Única oportunidad suya con este cliente' : ''/,
    'con 0 (client_id nulo, 14 de 209 oportunidades) la tarjeta se calla en vez de afirmar "única"');
  assert.match(card, /const closeLine = closeDateLine\(opportunity\.expected_close_date, now\);/,
    'y la fecha de cierre pasa por la regla que separa pasado de futuro');
});

test('los controles de Mi día tienen foco de teclado propio', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.now-main:focus-visible,\.now-link:focus-visible/, 'la app no tiene regla global de foco: estos la traen');
  assert.match(css, /outline:3px solid #1b64f2;outline-offset:2px/);
});

test('un comercial sin el módulo de oportunidades sabe qué acceso pedir', () => {
  // El menú no le muestra "Mi día" (navPermissions, isNavItemVisible), así que cae en NoCommercialHome.
  // Antes el texto era genérico ("pida acceso a quien administra el SIIO") y no decía cuál acceso falta.
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  const panel = main.slice(main.indexOf('function NoCommercialHome('), main.indexOf('function stageTone('));
  assert.match(panel, /le falta el acceso a <strong>Oportunidades<\/strong>\. Pídaselo a su administrador del SIIO\./);
  assert.match(panel, /profile\.role === 'comercial'/, 'sólo al comercial: a los demás roles no les falta ese módulo');
  assert.match(panel, /Su trabajo está en Programación de turnos/, 'quien sólo tiene Programación sigue viendo su enlace');
  // Y la guarda que lo trae aquí sigue en pie: sin el módulo no se pinta el tablero comercial.
  assert.match(main, /if \(!hasOpportunities\) return <NoCommercialHome profile=\{data\.currentProfile\} \/>;/);
});

test('la hora sólo se muestra cuando alguien la escogió', async () => {
  const hasRealClockTime = await load('../src/vigia/my-day-presentation.ts', 'hasRealClockTime');
  const clockTime = await load('../src/vigia/my-day-presentation.ts', 'clockTime');
  // Una fecha escogida en un calendario se guarda a una hora de convención: 9:00 desde el formulario de decisión
  // (dayToIso) y 12:00 desde el chat y la ficha (chatDayToIso, followUpDate). Medido el 2026-10-22: 10 de las 69
  // próximas gestiones y 21 de las 174 últimas caen exactamente en una de esas dos horas, Frontier incluida.
  assert.equal(hasRealClockTime('2026-10-26T12:00:00-05:00'), false, 'mediodía exacto es convención del chat');
  assert.equal(hasRealClockTime('2026-10-26T09:00:00-05:00'), false, 'las nueve exactas, del formulario');
  assert.equal(hasRealClockTime('2026-10-22T08:04:00-05:00'), true, 'una hora cualquiera sí se eligió');
  assert.equal(hasRealClockTime('2026-10-22T12:00:30-05:00'), true, 'con segundos ya no es la convención');
  assert.equal(hasRealClockTime('2026-10-22T12:01:00-05:00'), true, 'con minutos tampoco');
  assert.equal(hasRealClockTime(null), false);
  assert.equal(clockTime('2026-10-26T12:00:00-05:00'), '', 'y entonces no se escribe ninguna hora');
  assert.match(clockTime('2026-10-22T08:04:00-05:00'), /8:04/);

  const decision = readFileSync(new URL('../src/vigia/OpportunityDecision.tsx', import.meta.url), 'utf8');
  assert.match(decision, /const whenClock = clockTime\(opportunity\.next_action_at\);/, 'la tarjeta no inventa la hora de la cita');
  assert.match(decision, /note: lastClock \? `A las \$\{lastClock\}` : 'Quedó registrada sin hora'/);
  assert.match(decision, /kind === 'hoy' \? \(todayClock \? `Hoy a las \$\{todayClock\}` : 'Agendada para hoy'\)/);
  assert.match(decision, /\{clockTime\(row\.at\) \|\| 'Sin hora'\}/, '"Hoy ya hizo" tampoco');
});

test('la última gestión no retrocede cuando se registra algo viejo', () => {
  const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
  assert.equal(server, api, 'el espejo de Vercel queda igual');
  // Defecto real: las cuatro rutas sobrescribían last_interaction_at a ciegas. En Frontier, la nota del 22 a
  // mediodía se registró a las 7:33 y el WhatsApp de las 9:05, escrito después, dejó el campo en 9:05.
  assert.match(server, /function advancedLastInteraction\(currentValue, occurredAt\) \{/);
  assert.match(server, /return Number\.isFinite\(current\) && current >= next \? null : occurredAt;/,
    'sólo devuelve el valor nuevo cuando de verdad avanza');
  assert.equal(server.split('advancedLastInteraction(').length - 1, 5, 'el ayudante y sus cuatro llamadas');
  assert.doesNotMatch(server, /update\(\{ last_interaction_at: occurred_?[aA]t \}\)/,
    'ya no queda ninguna escritura a ciegas');
  assert.match(server, /select\('id,owner_id,client_id,service_type_code,company_name,customer_segment,regional_nombre,sede,quote_city,economic_sector,decision_maker_name,decision_maker_email,decision_maker_phone,stage_code,next_action_at,last_interaction_at,deleted_at'\)/,
    'y el cargador de acceso trae el valor para poder compararlo');
});
