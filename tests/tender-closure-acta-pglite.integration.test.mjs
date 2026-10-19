// Acta de cierre de licitación (migración 134): parte de la nota de cierre que
// escribió la persona, Vig-IA la profundiza con lo que tiene aprendido del
// expediente, y una persona autorizada corrige y confirma. No hay catálogo de
// motivos: los propone Vig-IA en el acta. El acta nunca bloquea el cierre.
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
const TENDER_NO_GO = '66666666-6666-4666-8666-666666666666';

// La nota de cierre de Juan en el caso Cali Seguridad (NO-GO del 17-oct-2026).
const NOTA_DE_JUAN = 'Es un proceso 100% de tecnología y aún no cumplimos los requisitos para este tipo de proyectos; debemos ir trabajando en ciertos requisitos y/o buscar un aliado que nos complemente.';

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

/** Para las funciones que devuelven filas (`returns table`), no un solo valor. */
async function callTableRpc(pg, name, args) {
  const result = await pg.query(`select * from public.${name}(${args.map(sqlLiteral).join(',')})`);
  return result.rows;
}

async function createDatabase() {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated; create role service_role; create role anon;
    alter role service_role bypassrls;
    grant service_role to current_user;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true, identity_type text default 'human', role text not null default 'comercial', full_name text);
    create table public.psi_sales_opportunities (id uuid primary key, company_name text, tender_offer_status text, archived_at timestamptz, archived_by uuid, archive_note text, updated_at timestamptz not null default now());
    create table public.psi_public_tenders (id uuid primary key, nombre text, converted_opportunity_id uuid references public.psi_sales_opportunities(id));
    create table public.psi_tender_offer_status_transitions (id uuid primary key default gen_random_uuid(), opportunity_id uuid not null, tender_id uuid not null, actor_id uuid not null, from_status text, to_status text, note text, changed_at timestamptz not null default now());
    create table public.psi_tender_go_no_go_decisions (id uuid primary key default gen_random_uuid(), opportunity_id uuid not null, tender_id uuid not null, decision text not null, justification text, decided_by uuid not null, decided_at timestamptz not null default now(), supersedes_decision_id uuid);
    create table public.psi_tender_analysis_runs (id uuid primary key default gen_random_uuid(), opportunity_id uuid not null, tender_id uuid not null, result jsonb, created_at timestamptz not null default now());
    insert into public.psi_sales_profiles values ('${JUAN}', true, 'human', 'admin', 'Juan Botero');
    insert into public.psi_sales_profiles values ('${VIGIA}', true, 'agent', 'comercial', 'Vig-IA');
    insert into public.psi_sales_profiles values ('${COMERCIAL}', true, 'human', 'comercial', 'Asesor Comercial');
    insert into public.psi_sales_opportunities (id, company_name, tender_offer_status) values ('${NO_GO}', 'Cali Seguridad', 'cerrada_no_go');
    insert into public.psi_sales_opportunities (id, company_name, tender_offer_status) values ('${EN_CURSO}', 'Fiscalía', 'en_preparacion');
    insert into public.psi_sales_opportunities (id, company_name, tender_offer_status) values ('${ADJUDICADA}', 'Supersalud', 'adjudicada');
    insert into public.psi_public_tenders (id, nombre, converted_opportunity_id) values ('${TENDER_NO_GO}', 'Cali — Secretaría de Seguridad', '${NO_GO}');
    insert into public.psi_public_tenders (id, nombre, converted_opportunity_id) values ('77777777-7777-4777-8777-777777777777', 'Fiscalía', '${EN_CURSO}');
    insert into public.psi_public_tenders (id, nombre, converted_opportunity_id) values ('99999999-9999-4999-8999-999999999999', 'Supersalud', '${ADJUDICADA}');
    insert into public.psi_tender_go_no_go_decisions (opportunity_id, tender_id, decision, justification, decided_by)
      values ('${NO_GO}', '${TENDER_NO_GO}', 'no_go', '${NOTA_DE_JUAN.replace(/'/g, "''")}', '${JUAN}');
  `);
  await pg.exec(migration134);
  return pg;
}

// Lo que Vig-IA profundiza a partir de la nota de Juan y del expediente.
const profundizacionVigia = {
  decision_summary: 'No nos presentamos porque es un proyecto 100% de tecnología, sin componente de vigilancia.',
  decision_quote: NOTA_DE_JUAN,
  requirements_unmet: [{ titulo: 'Experiencia general', detalle: 'El RUP coincide solo en 4 códigos UNSPSC.', fuente: 'Complemento al pliego definitivo, num. 11.2' }],
  factors_against: [{ detalle: 'Solo hay unas 11 semanas para importar, instalar y poner en marcha.', fuente: 'Estudios previos, num. 9.2' }],
  gaps_to_compete: [{ detalle: 'Aliado integrador en unión temporal que aporte los códigos UNSPSC.' }],
  recommendation: 'Seguimos trabajando las licitaciones de tecnología; no se descartan de entrada.',
  reasons: ['Es de tecnología y no de vigilancia', 'Nos falta experiencia', 'No cumplimos un requisito habilitante (códigos del RUP y cartas de fabricante)'],
  system_lesson: 'Cuando llegue una parecida, el Radar debe marcarla "tecnología: parecida a Cali Seguridad; buscar aliado integrador" y mostrarla igual.',
};

const upsert = (pg, opportunityId, actorId, payload, expectedUpdatedAt = null) =>
  callRpc(pg, 'psi_upsert_tender_closure_acta', [opportunityId, actorId, jsonbArg(payload), expectedUpdatedAt]);

// --- El acta sólo existe para licitaciones cerradas, y sólo la redacta quien debe
await (async function onlyClosedAndOnlyAuthorized() {
  const pg = await createDatabase();
  assert.equal(await callRpc(pg, 'psi_get_tender_closure_acta', [NO_GO]), null, 'sin acta no se inventa una vacía');
  await assert.rejects(() => upsert(pg, EN_CURSO, VIGIA, profundizacionVigia), /sólo se abre cuando la licitación está cerrada/i);
  await assert.rejects(() => upsert(pg, NO_GO, COMERCIAL, profundizacionVigia), /No tiene permisos/i);
  await pg.close();
})();

// --- La nota de cierro ya escrita es el punto de partida: no se le pide otra vez
await (async function closingNoteComesFromWhereThePersonWroteIt() {
  const pg = await createDatabase();

  // NO-GO: la nota vive en la justificación de la decisión.
  assert.deepEqual(await callRpc(pg, 'psi_tender_closure_note', [NO_GO]), { note: NOTA_DE_JUAN, source: 'no_go_justification' });
  const actaNoGo = await upsert(pg, NO_GO, VIGIA, { decision_summary: 'x', reasons: ['Es de tecnología'] });
  assert.equal(actaNoGo.acta.closing_note, NOTA_DE_JUAN, 'el acta arranca de la nota de Juan, sin que nadie la reescriba');
  assert.equal(actaNoGo.acta.closing_note_source, 'no_go_justification');

  // Adjudicada / no adjudicada: la nota vive en la transición de estado.
  await pg.exec(`insert into public.psi_tender_offer_status_transitions (opportunity_id, tender_id, actor_id, from_status, to_status, note)
    values ('${ADJUDICADA}', '99999999-9999-4999-8999-999999999999', '${JUAN}', 'presentada', 'adjudicada', 'La ganamos por precio y por el equipo propuesto.')`);
  assert.deepEqual(await callRpc(pg, 'psi_tender_closure_note', [ADJUDICADA]), { note: 'La ganamos por precio y por el equipo propuesto.', source: 'status_transition' });

  // Archivada: la nota vive en archive_note y manda sobre las demás.
  await pg.exec(`update public.psi_sales_opportunities set archived_at = now(), archive_note = 'Falta de sede en Bolívar, Casanare y Nariño.' where id = '${NO_GO}'`);
  assert.deepEqual(await callRpc(pg, 'psi_tender_closure_note', [NO_GO]), { note: 'Falta de sede en Bolívar, Casanare y Nariño.', source: 'archive_note' });

  // Sin nota en ninguna parte, el acta se abre igual y queda sin punto de partida.
  await pg.exec(`insert into public.psi_sales_opportunities (id, company_name, tender_offer_status) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Pereira', 'no_adjudicada');
    insert into public.psi_public_tenders (id, nombre, converted_opportunity_id) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Pereira', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');`);
  assert.equal(await callRpc(pg, 'psi_tender_closure_note', ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']), null);
  const sinNota = await upsert(pg, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', VIGIA, {});
  assert.equal(sinNota.acta.closing_note, null);
  assert.equal(sinNota.acta.closing_note_source, null);
  await pg.close();
})();

// --- Vig-IA profundiza la nota, Juan corrige, Juan confirma
await (async function deepenCorrectConfirm() {
  const pg = await createDatabase();
  const propuesta = await upsert(pg, NO_GO, VIGIA, profundizacionVigia);
  assert.equal(propuesta.acta.status, 'borrador', 'lo que propone el agente nace como borrador');
  assert.equal(propuesta.acta.closure_kind, 'cerrada_no_go');
  assert.equal(propuesta.acta.closing_note, NOTA_DE_JUAN);
  assert.equal(propuesta.acta.proposed_by, VIGIA);
  assert.equal(propuesta.proposed_by_name, 'Vig-IA');
  assert.deepEqual(propuesta.reasons, profundizacionVigia.reasons, 'los motivos son los que redactó Vig-IA, en su orden');
  assert.deepEqual(propuesta.events.map(e => e.action), ['propuesta']);

  await assert.rejects(() => callRpc(pg, 'psi_confirm_tender_closure_acta', [NO_GO, VIGIA, propuesta.acta.updated_at]), /Sólo una persona autorizada/i, 'Vig-IA no confirma su propia acta');

  const corregida = await upsert(pg, NO_GO, JUAN, {
    ...profundizacionVigia,
    recommendation: 'Corregido por Juan: no se descartan de entrada y desde el primer día se busca aliado.',
    reasons: [...profundizacionVigia.reasons, 'No alcanzaba el tiempo'],
  }, propuesta.acta.updated_at);
  assert.match(corregida.acta.recommendation, /Corregido por Juan/);
  assert.equal(corregida.reasons.length, 4, 'Juan puede añadir un motivo que Vig-IA no vio');
  assert.equal(corregida.acta.closing_note, NOTA_DE_JUAN, 'corregir el acta no toca la nota de cierre original');
  assert.equal(corregida.acta.closing_note_source, 'no_go_justification');
  assert.equal(corregida.acta.proposed_by, VIGIA, 'corregir no borra quién propuso el borrador');
  assert.deepEqual(corregida.events.map(e => e.action), ['editada', 'propuesta']);

  const confirmada = await callRpc(pg, 'psi_confirm_tender_closure_acta', [NO_GO, JUAN, corregida.acta.updated_at]);
  assert.equal(confirmada.acta.status, 'confirmada');
  assert.equal(confirmada.acta.confirmed_by, JUAN);
  assert.equal(confirmada.confirmed_by_name, 'Juan Botero');
  assert.ok(confirmada.acta.confirmed_at);
  await pg.close();
})();

// --- Reescribir la nota a mano queda marcado como tal
await (async function manualNoteIsMarked() {
  const pg = await createDatabase();
  const propuesta = await upsert(pg, NO_GO, VIGIA, { decision_summary: 'x', reasons: ['Es de tecnología'] });
  const reescrita = await upsert(pg, NO_GO, JUAN, { decision_summary: 'x', reasons: ['Es de tecnología'], closing_note: 'Lo cierro por otra razón: el presupuesto no daba.' }, propuesta.acta.updated_at);
  assert.equal(reescrita.acta.closing_note, 'Lo cierro por otra razón: el presupuesto no daba.');
  assert.equal(reescrita.acta.closing_note_source, 'manual');
  await pg.close();
})();

// --- Una sola acta por licitación, con bloqueo optimista
await (async function singleActaAndOptimisticLock() {
  const pg = await createDatabase();
  const propuesta = await upsert(pg, NO_GO, VIGIA, profundizacionVigia);
  await assert.rejects(() => upsert(pg, NO_GO, JUAN, profundizacionVigia), /cambió mientras la editaba/i, 'no se crea una segunda acta');
  await assert.rejects(() => upsert(pg, NO_GO, JUAN, profundizacionVigia, '2020-01-01T00:00:00Z'), /cambió mientras la editaba/i);
  await assert.rejects(() => upsert(pg, ADJUDICADA, JUAN, profundizacionVigia, '2020-01-01T00:00:00Z'), /El acta no existe todavía/i);
  const unicas = await pg.query(`select count(*)::int as total from public.psi_tender_closure_acta where opportunity_id = '${NO_GO}'`);
  assert.equal(unicas.rows[0].total, 1);
  assert.ok(propuesta.acta.id);
  await pg.close();
})();

// --- Confirmar un acta la congela; reabrirla deja el historial intacto
await (async function confirmFreezesAndReopenKeepsHistory() {
  const pg = await createDatabase();
  const propuesta = await upsert(pg, NO_GO, VIGIA, profundizacionVigia);
  const confirmada = await callRpc(pg, 'psi_confirm_tender_closure_acta', [NO_GO, JUAN, propuesta.acta.updated_at]);
  await assert.rejects(() => upsert(pg, NO_GO, JUAN, profundizacionVigia, confirmada.acta.updated_at), /debe reabrirla/i);
  await assert.rejects(() => callRpc(pg, 'psi_confirm_tender_closure_acta', [NO_GO, JUAN, confirmada.acta.updated_at]), /ya está confirmada/i);
  await assert.rejects(() => callRpc(pg, 'psi_reopen_tender_closure_acta', [NO_GO, COMERCIAL, confirmada.acta.updated_at]), /Sólo una persona autorizada/i);

  const reabierta = await callRpc(pg, 'psi_reopen_tender_closure_acta', [NO_GO, JUAN, confirmada.acta.updated_at]);
  assert.equal(reabierta.acta.status, 'borrador');
  assert.equal(reabierta.acta.confirmed_by, null);
  assert.equal(reabierta.acta.confirmed_at, null);
  assert.deepEqual(reabierta.events.map(e => e.action), ['reabierta', 'confirmada', 'propuesta']);
  const congelada = await pg.query(`select snapshot from public.psi_tender_closure_acta_events where action = 'confirmada'`);
  assert.equal(congelada.rows[0].snapshot.acta.status, 'confirmada', 'el historial conserva la versión confirmada');
  assert.deepEqual(congelada.rows[0].snapshot.reasons, profundizacionVigia.reasons);

  await assert.rejects(() => pg.exec(`update public.psi_tender_closure_acta_events set action = 'propuesta'`), /inmutable/i);
  await assert.rejects(() => pg.exec(`delete from public.psi_tender_closure_acta_events`), /inmutable/i);
  await pg.close();
})();

// --- Confirmar exige la decisión redactada y al menos un motivo
await (async function confirmRequiresDecisionAndReason() {
  const pg = await createDatabase();
  const vacia = await upsert(pg, ADJUDICADA, VIGIA, {});
  assert.equal(vacia.acta.closure_kind, 'adjudicada', 'las adjudicadas también llevan acta');
  await assert.rejects(() => callRpc(pg, 'psi_confirm_tender_closure_acta', [ADJUDICADA, JUAN, vacia.acta.updated_at]), /necesita la decisión/i);
  const conDecision = await upsert(pg, ADJUDICADA, JUAN, { decision_summary: 'La ganamos.' }, vacia.acta.updated_at);
  await assert.rejects(() => callRpc(pg, 'psi_confirm_tender_closure_acta', [ADJUDICADA, JUAN, conDecision.acta.updated_at]), /al menos un motivo/i);
  const completa = await upsert(pg, ADJUDICADA, JUAN, { decision_summary: 'La ganamos.', reasons: ['La ganamos por precio y por el equipo propuesto'] }, conDecision.acta.updated_at);
  const confirmada = await callRpc(pg, 'psi_confirm_tender_closure_acta', [ADJUDICADA, JUAN, completa.acta.updated_at]);
  assert.equal(confirmada.acta.status, 'confirmada');
  await pg.close();
})();

// --- Los motivos se pueden contar entre actas, aunque los redacte Vig-IA
await (async function reasonsAreCountableAcrossActas() {
  const pg = await createDatabase();
  await upsert(pg, NO_GO, VIGIA, profundizacionVigia);
  await upsert(pg, ADJUDICADA, VIGIA, { decision_summary: 'x', reasons: ['Nos falta experiencia', 'Precio no competitivo'] });
  const conteo = await pg.query(`select label, count(*)::int as total from public.psi_tender_closure_acta_reason group by label order by total desc, label asc`);
  assert.equal(conteo.rows[0].label, 'Nos falta experiencia');
  assert.equal(conteo.rows[0].total, 2, 'el mismo motivo en dos actas se cuenta junto');
  // Un motivo repetido dentro de la misma acta no se duplica.
  const acta = await callRpc(pg, 'psi_get_tender_closure_acta', [NO_GO]);
  const reescrita = await upsert(pg, NO_GO, JUAN, { ...profundizacionVigia, reasons: ['Nos falta experiencia', 'Nos falta experiencia'] }, acta.acta.updated_at);
  assert.deepEqual(reescrita.reasons, ['Nos falta experiencia']);
  await pg.close();
})();

// --- Archivar también abre acta, aunque la oferta no se hubiera presentado
await (async function archivedOpportunityGetsActa() {
  const pg = await createDatabase();
  await pg.exec(`update public.psi_sales_opportunities set archived_at = now(), archive_note = 'No hubo socio de unión temporal a tiempo.' where id = '${EN_CURSO}'`);
  const acta = await upsert(pg, EN_CURSO, VIGIA, { decision_summary: 'Archivada sin presentar.', reasons: ['No hubo socio de unión temporal a tiempo'] });
  assert.equal(acta.acta.closure_kind, 'archivada');
  assert.equal(acta.acta.closing_note, 'No hubo socio de unión temporal a tiempo.');
  assert.equal(acta.acta.closing_note_source, 'archive_note');
  await pg.close();
})();

// --- La lista de pendientes es lo que Vig-IA tiene por redactar
await (async function pendingListForVigia() {
  const pg = await createDatabase();
  // Cali (NO-GO) tiene nota; la adjudicada todavía no, así que no está pendiente.
  await pg.exec(`insert into public.psi_tender_analysis_runs (opportunity_id, tender_id, result)
    values ('${NO_GO}', '${TENDER_NO_GO}', '{"integral_analysis":{"analysis_units":[{"unit_id":"u1","title":"Experiencia general"}]}}'::jsonb)`);
  const primera = await callTableRpc(pg, 'psi_list_tender_closure_acta_pending', [10]);
  assert.equal(primera.length, 1, 'sin nota de cierre no hay nada que profundizar');
  assert.equal(primera[0].opportunity_id, NO_GO);
  assert.equal(primera[0].closure_kind, 'cerrada_no_go');
  assert.equal(primera[0].closing_note, NOTA_DE_JUAN);
  assert.equal(primera[0].tender_name, 'Cali — Secretaría de Seguridad');
  assert.equal(primera[0].analysis_result.integral_analysis.analysis_units[0].title, 'Experiencia general');

  // Al escribir el acta, deja de estar pendiente.
  await upsert(pg, NO_GO, VIGIA, profundizacionVigia);
  assert.deepEqual(await callTableRpc(pg, 'psi_list_tender_closure_acta_pending', [10]), []);

  // La que sigue abierta nunca aparece, ni con nota.
  await pg.exec(`insert into public.psi_tender_offer_status_transitions (opportunity_id, tender_id, actor_id, from_status, to_status, note)
    values ('${EN_CURSO}', '77777777-7777-4777-8777-777777777777', '${JUAN}', 'presentada', 'adjudicada', 'nota de una licitación abierta')`);
  assert.deepEqual(await callTableRpc(pg, 'psi_list_tender_closure_acta_pending', [10]), []);

  // Al archivarla con nota, entra a la lista.
  await pg.exec(`update public.psi_sales_opportunities set archived_at = now(), archive_note = 'No hubo socio.' where id = '${EN_CURSO}'`);
  const segunda = await callTableRpc(pg, 'psi_list_tender_closure_acta_pending', [10]);
  assert.equal(segunda.length, 1);
  assert.equal(segunda[0].closure_kind, 'archivada');
  assert.equal(segunda[0].analysis_result, null, 'sin análisis, el acta se redacta con la nota sola');

  await assert.rejects(() => callTableRpc(pg, 'psi_list_tender_closure_acta_pending', [0]), /entre 1 y 50/i);
  await pg.close();
})();

// --- RLS y grants cerrados: nada para anon ni authenticated, ni escritura directa
await (async function rlsAndGrantsFailClosed() {
  const pg = await createDatabase();
  await upsert(pg, NO_GO, VIGIA, profundizacionVigia);
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

// --- Ninguna función del acta queda con search_path mutable (advisor de Supabase)
await (async function everyFunctionPinsSearchPath() {
  const pg = await createDatabase();
  const sinFijar = await pg.query(`
    select p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like '%tender_closure%'
      and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path%'
  `);
  assert.deepEqual(sinFijar.rows, [], `funciones con search_path mutable: ${JSON.stringify(sinFijar.rows)}`);
  await pg.close();
})();

// --- El rollback deja la base como estaba
await (async function rollbackIsClean() {
  const pg = await createDatabase();
  await upsert(pg, NO_GO, VIGIA, profundizacionVigia);
  await pg.exec(rollback134);
  const tablas = await pg.query(`select relname from pg_class where relname like 'psi_tender_closure%'`);
  assert.equal(tablas.rows.length, 0, `quedaron objetos: ${JSON.stringify(tablas.rows)}`);
  const funciones = await pg.query(`select proname from pg_proc where proname like '%tender_closure%'`);
  assert.equal(funciones.rows.length, 0, `quedaron funciones: ${JSON.stringify(funciones.rows)}`);
  await pg.close();
})();

console.log('Acta de cierre de licitación (134) PGlite integration passed');
