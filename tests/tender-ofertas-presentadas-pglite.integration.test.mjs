// Migración 191 — ofertas presentadas (encargo AGT-002 del 2026-11-07): «presentada» exige evidencia, pasa aunque el
// expediente no esté completo y lo deja marcado con lo que faltaba; el resultado mueve el estado; todo es append-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { registerTenderOfferResult, registerTenderOfferSubmission } from '../verticales/licitaciones/tender-offer-records.js';

const read = name => readFileSync(new URL(`../supabase/${name}`, import.meta.url), 'utf8');
const m024 = read('migrations/024_tender_offer_status_transitions.sql');
const m191 = read('migrations/191_tender_ofertas_presentadas.sql');
const r191 = read('rollbacks/191_tender_ofertas_presentadas_rollback.sql');

const JUAN = '60b26173-1226-476b-a958-cf2917661432';
const KATHERINE = '8c172493-12aa-4be1-893a-2e5e93f7fba2';
const O = '6ca7043f-ec54-4938-8674-1696403123bd';
const T = '33333333-3333-4333-8333-333333333333';

async function db({ go = true, ready = false, con191 = true } = {}) {
  const pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true, identity_type text default 'human', role text not null, full_name text);
    create table public.psi_access_permissions (code text primary key, name text not null default '', description text, active boolean not null default true);
    create table public.psi_profile_permissions (profile_id uuid not null, permission_code text not null, primary key(profile_id, permission_code));
    create table public.psi_sales_opportunities (id uuid primary key, tender_offer_status text);
    create table public.psi_public_tenders (id uuid primary key, converted_opportunity_id uuid, value numeric);
    create table public.psi_tender_go_no_go_decisions (id uuid primary key default gen_random_uuid(), opportunity_id uuid, tender_id uuid, decision text, decided_at timestamptz default now());
    insert into public.psi_access_permissions(code) values ('licitaciones');
    insert into public.psi_sales_profiles(id,role,full_name) values ('${JUAN}','admin','Juan Botero'), ('${KATHERINE}','comercial','Katherine Valencia Buitrago');
    insert into public.psi_profile_permissions values ('${KATHERINE}','licitaciones'), ('${JUAN}','licitaciones');
    insert into public.psi_sales_opportunities values ('${O}','en_preparacion');
    insert into public.psi_public_tenders values ('${T}','${O}', 8440291324);
    create function public.psi_evaluate_tender_dossier_readiness(p uuid) returns jsonb language sql as $$
      select jsonb_build_object('ready', ${ready}, 'unapproved_artifacts', jsonb_build_array('Carta de presentación'), 'pending_required_items', jsonb_build_array('RUP'))
    $$;
  `);
  await pg.exec(m024);
  if (go) await pg.exec(`insert into psi_tender_go_no_go_decisions (opportunity_id, tender_id, decision) values ('${O}','${T}','go')`);
  if (con191) await pg.exec(m191);
  return pg;
}

function client(pg) {
  return {
    async rpc(name, args) {
      const keys = Object.keys(args);
      try {
        const r = await pg.query(`select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, keys.map(k => (args[k] && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k])));
        return { data: r.rows[0].r, error: null };
      } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
    },
  };
}

const TERMINAL = { kind: 'presentada', filing_reference: 'RPL 6017126', submitted_at: '2026-11-04T09:12:00-05:00', evidence_url: 'https://seguridadnacional.sharepoint.com/terminal/radicado.pdf' };
const status = async pg => (await pg.query(`select tender_offer_status s from psi_sales_opportunities where id = $1`, [O])).rows[0].s;

test('caso Terminal: se registra presentada con el expediente incompleto, marcada y con lo que faltaba', async () => {
  const pg = await db();
  const row = await registerTenderOfferSubmission(client(pg), { opportunityId: O, actorId: KATHERINE, body: TERMINAL });
  assert.equal(row.dossier_incomplete, true);
  assert.deepEqual(row.missing_at_submission.unapproved_artifacts, ['Carta de presentación']);
  assert.equal(await status(pg), 'presentada');
  const t = (await pg.query(`select from_status, to_status, note from psi_tender_offer_status_transitions`)).rows;
  assert.deepEqual(t.map(r => [r.from_status, r.to_status]), [['en_preparacion', 'presentada']]);
  assert.match(t[0].note, /RPL 6017126.*incompleto/);
  await pg.close();
});

test('sin evidencia, sin GO o dos veces, no se registra', async () => {
  const pg = await db();
  await assert.rejects(registerTenderOfferSubmission(client(pg), { opportunityId: O, actorId: KATHERINE, body: { ...TERMINAL, evidence_url: '' } }), /enlace/);
  await assert.rejects(registerTenderOfferSubmission(client(pg), { opportunityId: O, actorId: KATHERINE, body: { ...TERMINAL, filing_reference: '' } }), /radicado/);
  await registerTenderOfferSubmission(client(pg), { opportunityId: O, actorId: KATHERINE, body: TERMINAL });
  await assert.rejects(registerTenderOfferSubmission(client(pg), { opportunityId: O, actorId: KATHERINE, body: TERMINAL }), error => error.status === 409);
  await pg.close();
  const sinGo = await db({ go: false });
  await assert.rejects(registerTenderOfferSubmission(client(sinGo), { opportunityId: O, actorId: KATHERINE, body: TERMINAL }), /GO vigente/);
  await sinGo.close();
});

test('el resultado exige fuente, valor si se gana, y mueve el estado', async () => {
  const pg = await db();
  const database = client(pg);
  await assert.rejects(registerTenderOfferResult(database, { opportunityId: O, actorId: KATHERINE, body: { result: 'perdida', source_kind: 'informe_evaluacion', source_url: 'https://x.co/i' } }), /oferta presentada/);
  await registerTenderOfferSubmission(database, { opportunityId: O, actorId: KATHERINE, body: TERMINAL });
  await assert.rejects(registerTenderOfferResult(database, { opportunityId: O, actorId: KATHERINE, body: { result: 'ganada', source_kind: 'acto_adjudicacion', source_url: 'https://x.co/a' } }), /valor adjudicado/);
  const result = await registerTenderOfferResult(database, { opportunityId: O, actorId: KATHERINE, body: { result: 'perdida', source_kind: 'informe_evaluacion', source_url: 'https://x.co/informe', rank: 22, bidders: 28 } });
  assert.equal(result.rank, 22);
  assert.equal(await status(pg), 'no_adjudicada');
  await pg.close();
});

test('«no presentada» pide motivo y no cambia el estado', async () => {
  const pg = await db();
  await assert.rejects(registerTenderOfferSubmission(client(pg), { opportunityId: O, actorId: KATHERINE, body: { kind: 'no_presentada' } }), /por qué/);
  const row = await registerTenderOfferSubmission(client(pg), { opportunityId: O, actorId: KATHERINE, body: { kind: 'no_presentada', reason: 'No llegó la póliza.' } });
  assert.equal(row.kind, 'no_presentada');
  assert.equal(await status(pg), 'en_preparacion');
  await pg.close();
});

test('append-only, sólo service_role, meta 2027 de Juan, y la reversa', async () => {
  const pg = await db();
  await registerTenderOfferSubmission(client(pg), { opportunityId: O, actorId: KATHERINE, body: TERMINAL });
  await assert.rejects(pg.exec(`update psi_tender_offer_submissions set filing_reference = 'otro'`), /no se edita/);
  await assert.rejects(pg.exec(`delete from psi_tender_offer_submissions`), /no se edita/);
  const p = (await pg.query(`select has_function_privilege('authenticated','public.psi_register_tender_offer_submission(uuid,uuid,jsonb)','execute') a, has_table_privilege('authenticated','public.psi_tender_offer_results','select') b`)).rows[0];
  assert.deepEqual([p.a, p.b], [false, false]);
  const goal = (await pg.query(`select year, target_value::text v from psi_tender_offer_goals`)).rows;
  assert.deepEqual(goal, [{ year: 2027, v: '150000000000' }]);
  await assert.rejects(pg.query(`select public.psi_set_tender_offer_goal($1, 2027, 1)`, [KATHERINE]), /administrador/);
  await pg.close();
  const limpio = await db();
  await limpio.exec(r191);
  assert.equal((await limpio.query(`select to_regclass('public.psi_tender_offer_submissions') r`)).rows[0].r, null);
  await limpio.close();
});

test('sin la 191 escribir responde 503', async () => {
  const pg = await db({ con191: false });
  await assert.rejects(registerTenderOfferSubmission(client(pg), { opportunityId: O, actorId: KATHERINE, body: TERMINAL }), error => error.status === 503);
  await pg.close();
});
