import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { cleanFollowupInput, createFollowup, followupPermissions, followupsToAutoClose, listFollowups, updateFollowup } from '../verticales/gerencial/siio-followups.js';

const OWNER = { id: '11111111-1111-4111-8111-111111111111', role: 'gerencia' };
const BOARD = { id: '22222222-2222-4222-8222-222222222222', role: 'junta' };
const ADVISOR = { id: '33333333-3333-4333-8333-333333333333', role: 'consulta' };
const DIRECTOR = { id: '44444444-4444-4444-8444-444444444444', role: 'director' };

test('permisos por rol: dueños crean y cierran, Junta crea, consulta sólo lee, directivo fuera', () => {
  assert.deepEqual(followupPermissions('admin'), { view: true, create: true, edit: true });
  assert.deepEqual(followupPermissions('gerencia'), { view: true, create: true, edit: true });
  assert.deepEqual(followupPermissions('junta'), { view: true, create: true, edit: false });
  assert.deepEqual(followupPermissions('consulta'), { view: true, create: false, edit: false });
  assert.deepEqual(followupPermissions('director'), { view: false, create: false, edit: false });
  assert.deepEqual(followupPermissions('comercial'), { view: false, create: false, edit: false });
});

test('validación de entrada', () => {
  const clean = cleanFollowupInput({ title: '  Decidir si nos presentamos  a Risaralda ', owner_label: 'Licitaciones', due_date: '2026-10-13', origin_type: 'licitacion', origin_ref: 'opp-1', origin_label: 'Gobernación de Risaralda', auto_rule: 'tender_decision' });
  assert.equal(clean.title, 'Decidir si nos presentamos a Risaralda');
  assert.throws(() => cleanFollowupInput({ title: 'ok ok', owner_label: 'X', due_date: '2026-10-13', origin_type: 'reunion' }), /Responsable/);
  assert.throws(() => cleanFollowupInput({ title: 'ok ok', owner_label: 'Ana', due_date: '13/10/2026', origin_type: 'reunion' }), /fecha/i);
  assert.throws(() => cleanFollowupInput({ title: 'ok ok', owner_label: 'Ana', due_date: '2026-10-13', origin_type: 'reunion', auto_rule: 'tender_decision', origin_ref: 'x' }), /Regla/);
  assert.throws(() => cleanFollowupInput({ title: 'ok ok', owner_label: 'Ana', due_date: '2026-10-13', origin_type: 'licitacion', auto_rule: 'tender_decision' }), /registro de origen/);
  assert.throws(() => cleanFollowupInput({ title: 'ok ok', owner_label: 'Ana', due_date: '2026-10-13', origin_type: 'hack' }), /Origen/);
});

test('cierre automático sólo cuando el CRM lo comprueba después de crear el seguimiento', () => {
  const base = { status: 'abierto', created_at: '2026-10-11T12:00:00Z' };
  const followups = [
    { ...base, id: 'a', auto_rule: 'tender_decision', origin_ref: 'opp-1' },
    { ...base, id: 'b', auto_rule: 'tender_decision', origin_ref: 'opp-2' },
    { ...base, id: 'c', auto_rule: 'tender_status', origin_ref: 'opp-3' },
    { ...base, id: 'd', auto_rule: 'opportunity_activity', origin_ref: 'opp-4' },
    { ...base, id: 'e', auto_rule: 'opportunity_activity', origin_ref: 'opp-5' },
    { ...base, id: 'f', auto_rule: null, origin_ref: null },
    { ...base, id: 'g', status: 'cancelado', auto_rule: 'tender_decision', origin_ref: 'opp-1' },
  ];
  const closes = followupsToAutoClose(followups, {
    decisions: [
      { opportunity_id: 'opp-1', decision: 'go', decided_at: '2026-10-12T09:00:00Z' },
      { opportunity_id: 'opp-2', decision: 'no_go', decided_at: '2026-10-01T09:00:00Z' },
    ],
    opportunities: [
      { id: 'opp-3', tender_offer_status: 'presentada', last_interaction_at: null },
      { id: 'opp-4', tender_offer_status: null, last_interaction_at: '2026-10-12T15:00:00Z' },
      { id: 'opp-5', tender_offer_status: null, last_interaction_at: '2026-09-01T15:00:00Z' },
    ],
  });
  assert.deepEqual(closes.map(item => item.id), ['a', 'c', 'd']);
  assert.match(closes[0].evidence, /presentarse/);
});

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.psi_sales_profiles (id uuid primary key, role text not null);
    insert into public.psi_sales_profiles values ('${OWNER.id}','gerencia'),('${BOARD.id}','junta');
  `);
  await db.exec(readFileSync(new URL('../supabase/migrations/123_siio_followups.sql', import.meta.url), 'utf8'));
  return db;
}

test('migración 123: restricciones de estado, grants y reversa', async () => {
  const db = await database();
  await db.exec(`insert into public.siio_followups (title, owner_label, due_date, origin_type, created_role) values ('Revisar costos', 'Finanzas', '2026-10-20', 'finanzas', 'gerencia')`);
  await assert.rejects(db.exec(`insert into public.siio_followups (title, owner_label, due_date, origin_type, created_role, status) values ('Cerrado sin fecha', 'Finanzas', '2026-10-20', 'finanzas', 'gerencia', 'cumplido')`), /closed_consistency/);
  await assert.rejects(db.exec(`insert into public.siio_followups (title, owner_label, due_date, origin_type, created_role) values ('Comercial crea', 'Ana', '2026-10-20', 'reunion', 'comercial')`), /created_role/);
  await assert.rejects(db.exec(`insert into public.siio_followups (title, owner_label, due_date, origin_type, created_role, auto_rule) values ('Sin ref', 'Ana', '2026-10-20', 'licitacion', 'gerencia', 'tender_decision')`), /auto_rule_needs_ref/);
  const grants = await db.query(`select grantee, privilege_type from information_schema.role_table_grants where table_name = 'siio_followups' order by grantee, privilege_type`);
  assert.deepEqual(grants.rows.map(row => `${row.grantee}:${row.privilege_type}`).filter(item => !item.startsWith('postgres')), ['service_role:INSERT', 'service_role:SELECT', 'service_role:UPDATE']);
  const rls = await db.query(`select relrowsecurity from pg_class where relname = 'siio_followups'`);
  assert.equal(rls.rows[0].relrowsecurity, true);
  await db.exec(readFileSync(new URL('../supabase/rollbacks/123_siio_followups_rollback.sql', import.meta.url), 'utf8'));
  const gone = await db.query(`select to_regclass('public.siio_followups') as name`);
  assert.equal(gone.rows[0].name, null);
});

// Minimal supabase-js style double over an in-memory array.
function fakeDb(seed = {}) {
  const tables = { siio_followups: [], psi_tender_go_no_go_decisions: [], psi_sales_opportunities: [], ...seed };
  let counter = 0;
  return {
    tables,
    from(table) {
      const state = { filters: [], op: 'select', values: null };
      const rows = () => tables[table].filter(row => state.filters.every(([column, kind, value]) => kind === 'in' ? value.includes(row[column]) : row[column] === value));
      const run = () => {
        if (state.op === 'insert') { const row = { id: `f${++counter}`, status: 'abierto', notes: [], ...state.values }; tables[table].push(row); return [row]; }
        if (state.op === 'update') { const hits = rows(); hits.forEach(row => Object.assign(row, state.values)); return hits; }
        return rows();
      };
      const chain = {
        select() { return chain; }, order() { return chain; }, limit() { return chain; },
        eq(column, value) { state.filters.push([column, 'eq', value]); return chain; },
        in(column, value) { state.filters.push([column, 'in', value]); return chain; },
        insert(values) { state.op = 'insert'; state.values = values; return chain; },
        update(values) { state.op = 'update'; state.values = values; return chain; },
        single() { const result = run(); return Promise.resolve({ data: result[0] || null, error: null }); },
        then(resolve, reject) { return Promise.resolve({ data: run(), error: null }).then(resolve, reject); },
      };
      return chain;
    },
  };
}

test('flujo: Junta crea, consulta no crea, dueño cierra, el CRM cierra solo', async () => {
  const db = fakeDb({ psi_tender_go_no_go_decisions: [{ opportunity_id: 'opp-9', decision: 'go', decided_at: '2026-10-12T10:00:00Z' }] });
  const now = new Date('2026-10-11T12:00:00Z');
  const fromBoard = await createFollowup(db, { title: 'Informe de rotación por ciudad', owner_label: 'Gestión Humana', due_date: '2026-10-30', origin_type: 'junta' }, BOARD, now);
  assert.equal(fromBoard.created_role, 'junta');
  await assert.rejects(createFollowup(db, { title: 'No debe', owner_label: 'Nadie', due_date: '2026-10-30', origin_type: 'reunion' }, ADVISOR, now), error => error.status === 403);
  await assert.rejects(createFollowup(db, { title: 'No debe', owner_label: 'Nadie', due_date: '2026-10-30', origin_type: 'reunion' }, DIRECTOR, now), error => error.status === 403);
  await assert.rejects(updateFollowup(db, fromBoard.id, { action: 'cumplir' }, BOARD, now), error => error.status === 403);
  const done = await updateFollowup(db, fromBoard.id, { action: 'cumplir', note: 'Entregado en comité' }, OWNER, now);
  assert.equal(done.status, 'cumplido');
  assert.equal(done.close_reason, 'manual');
  assert.equal(done.notes.length, 1);
  await assert.rejects(updateFollowup(db, fromBoard.id, { action: 'cancelar' }, OWNER, now), /ya está cerrado/);

  await createFollowup(db, { title: 'Decidir si nos presentamos a Fiscalía', owner_label: 'Licitaciones', due_date: '2026-10-20', origin_type: 'licitacion', origin_ref: 'opp-9', origin_label: 'Fiscalía', auto_rule: 'tender_decision' }, OWNER, now);
  const listed = await listFollowups(db, ADVISOR, new Date('2026-10-12T12:00:00Z'));
  const auto = listed.followups.find(item => item.origin_ref === 'opp-9');
  assert.equal(auto.status, 'cumplido');
  assert.equal(auto.close_reason, 'automatico');
  assert.match(auto.close_evidence, /presentarse/);
  assert.deepEqual(listed.permissions, { view: true, create: false, edit: false });
  await assert.rejects(listFollowups(db, DIRECTOR, now), error => error.status === 403);
});
