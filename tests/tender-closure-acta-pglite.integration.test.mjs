// Acta de cierre de licitación (migración 134): Vig-IA propone el borrador, una
// persona autorizada lo corrige y lo confirma. El acta se abre para todos los
// cierres y nunca bloquea el cierre de la licitación.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const strip = value => value.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const migration134 = strip(readFileSync(new URL('../supabase/migrations/134_tender_closure_acta.sql', import.meta.url), 'utf8'));
const rollback134 = strip(readFileSync(new URL('../supabase/rollbacks/134_tender_closure_acta_rollback.sql', import.meta.url), 'utf8'));

const JUAN = '11111111-1111-4111-8111-111111111111';
const VIGIA = 'a0020000-0000-4000-8000-000000000002';
const COMERCIAL = '33333333-3333-4333-8333-333333333333';
const NO_GO = '44444444-4444-4444-8444-444444444444';
const EN_CURSO = '55555555-5555-4555-8555-555555555555';
const ADJUDICADA = '88888888-8888-4888-8888-888888888888';

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'object' && value.__jsonb) return `'${JSON.stringify(value.value).replace(/'/g, "''")}'::jsonb`;
  return `'${String(value).replace(/'/g, "''")}'`;
}
const jsonbArg = value => ({ __jsonb: true, value });

async function callRpc(pg, name, args) {
  const result = await pg.query(`select public.${name}(${args.map(sqlLiteral).join(',')}) as data`);
  return result.rows[0]?.data ?? null;
}

async function createDatabase() {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated; create role service_role; create role anon;
    alter role service_role bypassrls;
    grant service_role to current_user;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true, identity_type text default 'human', role text not null default 'comercial', full_name text);
    create table public.psi_sales_opportunities (id uuid primary key, tender_offer_status text, archived_at timestamptz, archived_by uuid, archive_note text);
    create table public.psi_public_tenders (id uuid primary key, converted_opportunity_id uuid references public.psi_sales_opportunities(id));
    insert into public.psi_sales_profiles values ('${JUAN}', true, 'human', 'admin', 'Juan Botero');
    insert into public.psi_sales_profiles values ('${VIGIA}', true, 'agent', 'comercial', 'Vig-IA');
    insert into public.psi_sales_profiles values ('${COMERCIAL}', true, 'human', 'comercial', 'Asesor Comercial');
    insert into public.psi_sales_opportunities values ('${NO_GO}', 'cerrada_no_go', null, null, null);
    insert into public.psi_sales_opportunities values ('${EN_CURSO}', 'en_preparacion', null, null, null);
    insert into public.psi_sales_opportunities values ('${ADJUDICADA}', 'adjudicada', null, null, null);
    insert into public.psi_public_tenders values ('66666666-6666-4666-8666-666666666666', '${NO_GO}');
    insert into public.psi_public_tenders values ('77777777-7777-4777-8777-777777777777', '${EN_CURSO}');
    insert into public.psi_public_tenders values ('99999999-9999-4999-8999-999999999999', '${ADJUDICADA}');
  `);
  await pg.exec(migration134);
  return pg;
}

// El borrador que Vig-IA propondría para el caso Cali Seguridad (NO-GO del 17-oct-2026).
const caliDraft = {
  decision_summary: 'No nos presentamos porque es un proyecto 100% de tecnología, sin componente de vigilancia.',
  decision_quote: 'Es un proceso 100% de tecnología y aún no cumplimos los requisitos para este tipo de proyectos.',
  requirements_unmet: [{ titulo: 'Experiencia general', detalle: 'El RUP coincide solo en 4 códigos UNSPSC.', fuente: 'Complemento al pliego definitivo, num. 11.2' }],
  factors_against: [{ detalle: 'Solo hay unas 11 semanas para importar, instalar y poner en marcha.', fuente: 'Estudios previos, num. 9.2' }],
  gaps_to_compete: [{ detalle: 'Aliado integrador en unión temporal que aporte los códigos UNSPSC.' }],
  recommendation: 'Seguimos trabajando las licitaciones de tecnología; no se descartan de entrada.',
  reasons: ['tecnologia_no_vigilancia', 'falta_experiencia', 'requisito_habilitante_incumplido'],
  system_lesson: 'Cuando llegue una parecida, el Radar debe marcarla "tecnología: parecida a Cali Seguridad; buscar aliado integrador" y mostrarla igual.',
};

const upsert = (pg, opportunityId, actorId, payload, expectedUpdatedAt = null) =>
  callRpc(pg, 'psi_upsert_tender_closure_acta', [opportunityId, actorId, jsonbArg(payload), expectedUpdatedAt]);

// --- El acta sólo existe para licitaciones cerradas, y sólo la redacta quien debe
await (async function onlyClosedAndOnlyAuthorized() {
  const pg = await createDatabase();
  assert.equal(await callRpc(pg, 'psi_get_tender_closure_acta', [NO_GO]), null, 'sin acta no se inventa una vacía');
  await assert.rejects(() => upsert(pg, EN_CURSO, VIGIA, caliDraft), /sólo se abre cuando la licitación está cerrada/i);
  await assert.rejects(() => upsert(pg, NO_GO, COMERCIAL, caliDraft), /No tiene permisos/i);
  await assert.rejects(() => upsert(pg, NO_GO, VIGIA, { ...caliDraft, reasons: ['inventado'] }), /no está en el catálogo/i);
  await pg.close();
})();

// --- Vig-IA propone, Juan corrige, Juan confirma
await (async function proposeCorrectConfirm() {
  const pg = await createDatabase();
  const propuesta = await upsert(pg, NO_GO, VIGIA, caliDraft);
  assert.equal(propuesta.acta.status, 'borrador', 'lo que propone el agente nace como borrador');
  assert.equal(propuesta.acta.closure_kind, 'cerrada_no_go');
  assert.equal(propuesta.acta.proposed_by, VIGIA);
  assert.equal(propuesta.proposed_by_name, 'Vig-IA');
  assert.deepEqual(propuesta.reasons, ['falta_experiencia', 'requisito_habilitante_incumplido', 'tecnologia_no_vigilancia']);
  assert.deepEqual(propuesta.events.map(e => e.action), ['propuesta']);

  await assert.rejects(() => callRpc(pg, 'psi_confirm_tender_closure_acta', [NO_GO, VIGIA, propuesta.acta.updated_at]), /Sólo una persona autorizada/i, 'Vig-IA no confirma su propia acta');

  const corregida = await upsert(pg, NO_GO, JUAN, {
    ...caliDraft,
    recommendation: 'Corregido por Juan: no se descartan de entrada y desde el primer día se busca aliado.',
    reasons: [...caliDraft.reasons, 'tiempo_insuficiente'],
  }, propuesta.acta.updated_at);
  assert.match(corregida.acta.recommendation, /Corregido por Juan/);
  assert.equal(corregida.reasons.length, 4);
  assert.equal(corregida.acta.proposed_by, VIGIA, 'corregir no borra quién propuso el borrador');
  assert.deepEqual(corregida.events.map(e => e.action), ['editada', 'propuesta']);

  const confirmada = await callRpc(pg, 'psi_confirm_tender_closure_acta', [NO_GO, JUAN, corregida.acta.updated_at]);
  assert.equal(confirmada.acta.status, 'confirmada');
  assert.equal(confirmada.acta.confirmed_by, JUAN);
  assert.equal(confirmada.confirmed_by_name, 'Juan Botero');
  assert.ok(confirmada.acta.confirmed_at);
  await pg.close();
})();

// --- Una sola acta por licitación, con bloqueo optimista
await (async function singleActaAndOptimisticLock() {
  const pg = await createDatabase();
  const propuesta = await upsert(pg, NO_GO, VIGIA, caliDraft);
  await assert.rejects(() => upsert(pg, NO_GO, JUAN, caliDraft), /cambió mientras la editaba/i, 'no se crea una segunda acta');
  await assert.rejects(() => upsert(pg, NO_GO, JUAN, caliDraft, '2020-01-01T00:00:00Z'), /cambió mientras la editaba/i);
  await assert.rejects(() => upsert(pg, ADJUDICADA, JUAN, caliDraft, '2020-01-01T00:00:00Z'), /El acta no existe todavía/i);
  const unicas = await pg.query(`select count(*)::int as total from public.psi_tender_closure_acta where opportunity_id = '${NO_GO}'`);
  assert.equal(unicas.rows[0].total, 1);
  assert.ok(propuesta.acta.id);
  await pg.close();
})();

// --- Confirmar un acta la congela; reabrirla deja el historial intacto
await (async function confirmFreezesAndReopenKeepsHistory() {
  const pg = await createDatabase();
  const propuesta = await upsert(pg, NO_GO, VIGIA, caliDraft);
  const confirmada = await callRpc(pg, 'psi_confirm_tender_closure_acta', [NO_GO, JUAN, propuesta.acta.updated_at]);
  await assert.rejects(() => upsert(pg, NO_GO, JUAN, caliDraft, confirmada.acta.updated_at), /debe reabrirla/i);
  await assert.rejects(() => callRpc(pg, 'psi_confirm_tender_closure_acta', [NO_GO, JUAN, confirmada.acta.updated_at]), /ya está confirmada/i);
  await assert.rejects(() => callRpc(pg, 'psi_reopen_tender_closure_acta', [NO_GO, COMERCIAL, confirmada.acta.updated_at]), /Sólo una persona autorizada/i);

  const reabierta = await callRpc(pg, 'psi_reopen_tender_closure_acta', [NO_GO, JUAN, confirmada.acta.updated_at]);
  assert.equal(reabierta.acta.status, 'borrador');
  assert.equal(reabierta.acta.confirmed_by, null);
  assert.equal(reabierta.acta.confirmed_at, null);
  assert.deepEqual(reabierta.events.map(e => e.action), ['reabierta', 'confirmada', 'propuesta']);
  const congelada = await pg.query(`select snapshot from public.psi_tender_closure_acta_events where action = 'confirmada'`);
  assert.equal(congelada.rows[0].snapshot.acta.status, 'confirmada', 'el historial conserva la versión confirmada');

  await assert.rejects(() => pg.exec(`update public.psi_tender_closure_acta_events set action = 'propuesta'`), /inmutable/i);
  await assert.rejects(() => pg.exec(`delete from public.psi_tender_closure_acta_events`), /inmutable/i);
  await pg.close();
})();

// --- Confirmar exige decisión y al menos un motivo para el conteo
await (async function confirmRequiresDecisionAndReason() {
  const pg = await createDatabase();
  const vacia = await upsert(pg, ADJUDICADA, VIGIA, {});
  assert.equal(vacia.acta.closure_kind, 'adjudicada', 'las adjudicadas también llevan acta');
  await assert.rejects(() => callRpc(pg, 'psi_confirm_tender_closure_acta', [ADJUDICADA, JUAN, vacia.acta.updated_at]), /necesita la decisión/i);
  const conDecision = await upsert(pg, ADJUDICADA, JUAN, { decision_summary: 'La ganamos.' }, vacia.acta.updated_at);
  await assert.rejects(() => callRpc(pg, 'psi_confirm_tender_closure_acta', [ADJUDICADA, JUAN, conDecision.acta.updated_at]), /al menos un motivo/i);
  const completa = await upsert(pg, ADJUDICADA, JUAN, { decision_summary: 'La ganamos.', reasons: ['resultado_favorable'] }, conDecision.acta.updated_at);
  const confirmada = await callRpc(pg, 'psi_confirm_tender_closure_acta', [ADJUDICADA, JUAN, completa.acta.updated_at]);
  assert.equal(confirmada.acta.status, 'confirmada');
  await pg.close();
})();

// --- Archivar también abre acta, aunque la oferta no se hubiera presentado
await (async function archivedOpportunityGetsActa() {
  const pg = await createDatabase();
  await pg.exec(`update public.psi_sales_opportunities set archived_at = now() where id = '${EN_CURSO}'`);
  const acta = await upsert(pg, EN_CURSO, VIGIA, { decision_summary: 'Archivada por falta de sede en tres departamentos.', reasons: ['falta_sede', 'sin_socio_union_temporal'] });
  assert.equal(acta.acta.closure_kind, 'archivada');
  assert.deepEqual(acta.reasons, ['falta_sede', 'sin_socio_union_temporal']);
  await pg.close();
})();

// --- RLS y grants cerrados: nada para anon ni authenticated, ni escritura directa
await (async function rlsAndGrantsFailClosed() {
  const pg = await createDatabase();
  await upsert(pg, NO_GO, VIGIA, caliDraft);
  const grants = await pg.query(`select grantee, privilege_type, table_name from information_schema.role_table_grants where table_name like 'psi_tender_closure%' and grantee in ('anon', 'authenticated', 'public')`);
  assert.equal(grants.rows.length, 0, `grants indebidos: ${JSON.stringify(grants.rows)}`);
  const rls = await pg.query(`select relname, relrowsecurity from pg_class where relname like 'psi_tender_closure%' and relkind = 'r'`);
  assert.ok(rls.rows.length > 0 && rls.rows.every(row => row.relrowsecurity), `RLS sin habilitar: ${JSON.stringify(rls.rows)}`);

  await pg.exec('set role authenticated');
  await assert.rejects(() => pg.query(`select id from public.psi_tender_closure_acta limit 1`), /permission denied/i);
  await assert.rejects(() => pg.query(`select public.psi_confirm_tender_closure_acta('${NO_GO}','${JUAN}', now())`), /permission denied/i);
  await pg.exec('reset role; set role anon');
  await assert.rejects(() => pg.query(`select id from public.psi_tender_closure_acta limit 1`), /permission denied/i);
  await pg.exec('reset role; set role service_role');
  await assert.rejects(
    () => pg.query(`insert into public.psi_tender_closure_acta (opportunity_id, tender_id, closure_kind, proposed_by) values ('${ADJUDICADA}','99999999-9999-4999-8999-999999999999','adjudicada','${JUAN}')`),
    /permission denied/i,
    'incluso service_role escribe sólo por las RPC',
  );
  await pg.exec('reset role');
  await pg.close();
})();

// --- El rollback deja la base como estaba
await (async function rollbackIsClean() {
  const pg = await createDatabase();
  await upsert(pg, NO_GO, VIGIA, caliDraft);
  await pg.exec(rollback134);
  const tablas = await pg.query(`select relname from pg_class where relname like 'psi_tender_closure%'`);
  assert.equal(tablas.rows.length, 0, `quedaron objetos: ${JSON.stringify(tablas.rows)}`);
  const funciones = await pg.query(`select proname from pg_proc where proname like '%tender_closure%'`);
  assert.equal(funciones.rows.length, 0, `quedaron funciones: ${JSON.stringify(funciones.rows)}`);
  await pg.close();
})();

console.log('Acta de cierre de licitación (134) PGlite integration passed');
