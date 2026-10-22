// AGT-003 — desde cuándo cada oportunidad está en su etapa, y cuándo eso es estancamiento (Juan, 2026-10-22).
// Cubre la regla pura, su uso en Mi día, la migración 145 y lo que la pantalla muestra.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';

// Los módulos son TypeScript: se empaquetan en memoria, como en tests/agt003-my-day-presentation.test.mjs.
const load = async (relative, named) => {
  const entry = new URL(relative, import.meta.url).pathname;
  const bundle = buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
  return (await import(moduleUrl))[named];
};
const stageStaleness = await load('../src/vigia/stage-staleness.ts', 'stageStaleness');
const buildMyDayQueue = await load('../src/vigia/my-day-presentation.ts', 'buildMyDayQueue');

const NOW = new Date('2026-10-22T15:00:00.000Z');
const diasAntes = (days) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

test('días en la etapa: exactos cuando se midieron, "al menos" cuando la fecha viene sembrada', () => {
  const medida = stageStaleness({ stageEnteredAt: diasAntes(20), measured: true, stalenessDays: 14, stageName: 'Envío de Oferta', now: NOW });
  assert.equal(medida.days, 20);
  assert.equal(medida.atLeast, false);
  assert.equal(medida.stale, true);
  assert.equal(medida.label, 'Lleva 20 día(s) en Envío de Oferta.');

  const sembrada = stageStaleness({ stageEnteredAt: diasAntes(20), measured: false, stalenessDays: 14, stageName: 'Envío de Oferta', now: NOW });
  assert.equal(sembrada.atLeast, true);
  assert.equal(sembrada.label, 'Lleva al menos 20 día(s) en Envío de Oferta.', 'con updated_at el número es una cota inferior');
  assert.equal(sembrada.stale, true);
});

test('el aviso se apaga con próxima gestión futura, sin umbral o sin fecha de entrada', () => {
  const base = { stageEnteredAt: diasAntes(40), measured: true, stalenessDays: 14, stageName: 'Prospecto', now: NOW };
  assert.equal(stageStaleness({ ...base, nextActionAt: diasAntes(-3) }).stale, false, 'ya hay un compromiso vigente');
  assert.equal(stageStaleness({ ...base, nextActionAt: diasAntes(2) }).stale, true, 'una fecha que ya pasó no es compromiso');
  assert.equal(stageStaleness({ ...base, stalenessDays: null }).stale, false, 'una etapa sin umbral no se vigila');
  assert.equal(stageStaleness({ ...base, stalenessDays: null }).days, 40, 'pero sí se informa cuánto lleva');

  const sinFecha = stageStaleness({ stageEnteredAt: null, stalenessDays: 14, now: NOW });
  assert.deepEqual(sinFecha, { stale: false, days: null, atLeast: false, label: '' });
  assert.equal(stageStaleness({ stageEnteredAt: 'no es fecha', stalenessDays: 14, now: NOW }).days, null);
  assert.equal(stageStaleness({ stageEnteredAt: '2026-10-02 14:00:00+00', measured: true, stalenessDays: 14, now: NOW }).days, 20,
    'el formato que entrega Postgres (espacio y desfase sin minutos) se entiende');
  assert.equal(stageStaleness({ stageEnteredAt: diasAntes(-5), measured: true, stalenessDays: 14, now: NOW }).days, 0,
    'una fecha futura no produce días negativos');
});

const opportunity = (over) => ({
  id: 'o1', company_name: 'Cliente', stage_code: 'envio_oferta', stage_name: 'Envío de Oferta', stage_order: 2,
  service_type_code: 'vigilancia_fisica', offer_value: 1000, regional_nombre: 'Eje Cafetero',
  next_action_at: null, decision_maker_name: 'Ana', decision_maker_email: 'a@b.co', decision_maker_phone: '1',
  stage_entered_at: diasAntes(30), stage_entered_at_measured: false, staleness_days: 14, ...over,
});

test('Mi día: el estancamiento se cuenta, se dice en la tarjeta y no abre una canasta nueva', () => {
  const queue = buildMyDayQueue([opportunity()], NOW);
  assert.equal(queue.estancadasTotal, 1);
  assert.equal(queue.hacerHoy.length, 1, 'sigue siendo una sola tarjeta: ya estaba en Hacer hoy por no tener agenda');
  assert.equal(queue.hacerHoy[0].stale, true);
  assert.match(queue.hacerHoy[0].fact, /Sin próxima gestión agendada\. Lleva al menos 30 día\(s\) en Envío de Oferta\./);

  const alDia = buildMyDayQueue([opportunity({ next_action_at: diasAntes(-2) })], NOW);
  assert.equal(alDia.estancadasTotal, 0, 'con gestión futura no hay estancamiento');
  assert.equal(alDia.hacerHoy.length, 0);

  const sinColumnas = buildMyDayQueue([opportunity({ stage_entered_at: undefined, stage_entered_at_measured: undefined, staleness_days: undefined })], NOW);
  assert.equal(sinColumnas.estancadasTotal, 0, 'antes de la migración la pantalla no inventa nada');
  assert.equal(sinColumnas.hacerHoy[0].stale, false);
  assert.equal(sinColumnas.hacerHoy[0].fact, 'Sin próxima gestión agendada.');
});

test('Mi día: con el tope de tarjetas, primero la que lleva más tiempo parada', () => {
  const rows = [
    opportunity({ id: 'reciente', company_name: 'Reciente', stage_entered_at: diasAntes(3), offer_value: 9_000_000 }),
    opportunity({ id: 'vieja', company_name: 'Vieja', stage_entered_at: diasAntes(90), offer_value: 10 }),
    opportunity({ id: 'media', company_name: 'Media', stage_entered_at: diasAntes(30), offer_value: 20 }),
  ];
  const queue = buildMyDayQueue(rows, NOW);
  assert.deepEqual(queue.hacerHoy.map(a => a.id), ['vieja', 'media', 'reciente'],
    'la de 9 millones sin estancarse queda después de las estancadas');
  assert.equal(queue.estancadasTotal, 2);
});

test('migración 145: aditiva, con siembra honesta, disparador en todos los caminos y vista reemplazada sin perder permisos', () => {
  const sql = readFileSync(new URL('../supabase/migrations/145_crm_stage_entered_at.sql', import.meta.url), 'utf8');
  assert.match(sql, /add column if not exists stage_entered_at timestamptz/);
  assert.match(sql, /add column if not exists stage_entered_at_measured boolean not null default false/);
  assert.match(sql, /set stage_entered_at = coalesce\(updated_at, created_at\)\s+where stage_entered_at is null/);
  assert.match(sql, /add column if not exists staleness_days integer/);
  assert.match(sql, /set staleness_days = 14\s+where staleness_days is null and is_terminal = false/, 'las etapas terminales no se vigilan');
  assert.match(sql, /create trigger psi_sales_opportunity_stage_entered_trg\s+before insert or update of stage_code/);
  assert.match(sql, /create or replace view public\.v_psi_sales_opportunity_enriched/);
  assert.match(sql, /o\.stage_entered_at,\s+o\.stage_entered_at_measured,\s+st\.staleness_days/);
  // Sin los comentarios: el encabezado explica justamente por qué no se usa `drop view`.
  const ejecutable = sql.replace(/^\s*--.*$/gm, '');
  assert.match(sql, /alter view public\.v_psi_sales_opportunity_enriched set \(security_invoker = true\)/,
    'la vista recreada conserva lo que cerró la migración 112');
  assert.match(sql, /grant select on public\.v_psi_sales_opportunity_enriched to service_role/);
  assert.doesNotMatch(ejecutable, /drop view/i, 'un drop view perdería security_invoker y el grant de la migración 112');
  assert.doesNotMatch(ejecutable, /delete from|truncate|drop table|drop column/i, 'la migración no borra nada');

  const rollback = readFileSync(new URL('../supabase/rollbacks/145_crm_stage_entered_at_rollback.sql', import.meta.url), 'utf8');
  assert.match(rollback, /drop trigger if exists psi_sales_opportunity_stage_entered_trg/);
  assert.match(rollback, /drop column if exists stage_entered_at/);
  assert.match(rollback, /create or replace view public\.v_psi_sales_opportunity_enriched/, 'la vista vuelve a su forma anterior');
});

test('servidor y pantalla: la persona que mueve la etapa queda registrada y la insignia sale de la misma regla', () => {
  const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
  assert.equal(server, api, 'el espejo de Vercel queda igual');
  const helper = server.slice(server.indexOf('async function logStageChange('), server.indexOf('\n}\n', server.indexOf('async function logStageChange(')));
  assert.match(helper, /field_name: 'stage_code'/);
  assert.match(helper, /if \(error\) console\.warn/, 'un fallo del registro no tumba el cambio de etapa');
  assert.equal(server.split('await logStageChange(').length - 1, 3, 'las tres rutas que cambian la oportunidad lo registran');

  const ui = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(ui, /<StageStallBadge opportunity=\{o\} \/>/, 'insignia junto a la etapa en el listado');
  assert.match(ui, /<StalledInStageList opportunities=\{openRows\} now=\{now\} \/>/, 'sección "Se están enfriando" en Mi día');
  assert.match(ui, /stage_entered_at\?: string \| null; stage_entered_at_measured\?: boolean \| null; staleness_days\?: number \| null;/);
});

test('migración 146: el arranque no se apoya en una escritura masiva vieja y sólo toca datos', () => {
  const sql = readFileSync(new URL('../supabase/migrations/146_crm_stage_staleness_arranque.sql', import.meta.url), 'utf8');
  assert.match(sql, /set stage_entered_at = now\(\)\s+where stage_entered_at_measured = false/,
    'las fechas sembradas se llevan al corte de medición; las medidas no se tocan');
  assert.match(sql, /set staleness_days = 30\s+where code = 'prospecto'/);
  const ejecutable = sql.replace(/^\s*--.*$/gm, '');
  assert.doesNotMatch(ejecutable, /alter table|create |drop |grant |revoke /i, 'la 146 es sólo datos');
  assert.doesNotMatch(ejecutable, /updated_at/, 'updated_at no se modifica');

  const rollback = readFileSync(new URL('../supabase/rollbacks/146_crm_stage_staleness_arranque_rollback.sql', import.meta.url), 'utf8');
  assert.match(rollback, /set stage_entered_at = coalesce\(updated_at, created_at\)/);
  assert.match(rollback, /set staleness_days = 14\s+where code = 'prospecto'/);
});
