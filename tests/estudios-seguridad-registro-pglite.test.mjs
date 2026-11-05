// Estudios de Seguridad Física, tramo 1 — registrar un estudio (Juan, 2026-11-05).
//
// Corre la lógica de verticales/estudios-seguridad/estudios.js contra la migración 178 real en PGlite, con un doble
// mínimo de supabase-js que traduce a SQL. Así las restricciones de la base (escalas, controles completos, sede con
// referencia) y las del módulo se prueban juntas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import {
  addAction, addRisk, addZone, cleanStudyInput, createStudy, deleteRisk, deleteZone, getStudy, listStudies, updateRisk, updateStudy,
} from '../verticales/estudios-seguridad/estudios.js';

const PREPARER = { id: '11111111-1111-4111-8111-111111111111', role: 'colaborador' };
const migration = readFileSync(new URL('../supabase/migrations/178_estudios_seguridad_base.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/178_estudios_seguridad_base_rollback.sql', import.meta.url), 'utf8');

async function database() {
  const pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.psi_sales_profiles (id uuid primary key, role text not null);
    create table public.psi_sales_opportunities (id uuid primary key);
    create table public.psi_access_permissions (code text primary key, name text, description text, active boolean);
    create table public.psi_profile_permissions (profile_id uuid, permission_code text);
    insert into public.psi_sales_profiles values ('${PREPARER.id}', 'colaborador');
  `);
  await pg.exec(migration);
  return pg;
}

// Doble de supabase-js sobre PGlite: lo justo que usa el módulo (select/eq/order/single/maybeSingle/insert/update/delete).
function supabaseOver(pg) {
  return {
    from(table) {
      const state = { op: 'select', columns: '*', filters: [], order: [], values: null, returning: false };
      const where = params => state.filters.length ? ` where ${state.filters.map(([column, value]) => { params.push(value); return `"${column}" = $${params.length}`; }).join(' and ')}` : '';
      const run = async () => {
        const params = [];
        let sql;
        if (state.op === 'insert') {
          const keys = Object.keys(state.values);
          sql = `insert into public.${table} (${keys.map(key => `"${key}"`).join(', ')}) values (${keys.map((key, i) => { params.push(state.values[key]); return `$${i + 1}`; }).join(', ')}) returning *`;
        } else if (state.op === 'update') {
          const keys = Object.keys(state.values);
          const sets = keys.map(key => { params.push(state.values[key]); return `"${key}" = $${params.length}`; }).join(', ');
          sql = `update public.${table} set ${sets}${where(params)} returning *`;
        } else if (state.op === 'delete') {
          sql = `delete from public.${table}${where(params)} returning *`;
        } else {
          const columns = state.columns === '*' ? '*' : state.columns.split(',').map(column => `"${column.trim()}"`).join(', ');
          sql = `select ${columns} from public.${table}${where(params)}${state.order.length ? ` order by ${state.order.map(([column, asc]) => `"${column}" ${asc ? 'asc' : 'desc'}`).join(', ')}` : ''}`;
        }
        try {
          const result = await pg.query(sql, params);
          return { data: result.rows, error: null };
        } catch (error) {
          return { data: null, error };
        }
      };
      const chain = {
        select(columns = '*') { if (state.op === 'select') state.columns = columns; return chain; },
        eq(column, value) { state.filters.push([column, value]); return chain; },
        order(column, { ascending = true } = {}) { state.order.push([column, ascending]); return chain; },
        insert(values) { state.op = 'insert'; state.values = values; return chain; },
        update(values) { state.op = 'update'; state.values = values; return chain; },
        delete() { state.op = 'delete'; return chain; },
        async single() { const { data, error } = await run(); return error ? { data: null, error } : data.length === 1 ? { data: data[0], error: null } : { data: null, error: new Error(`single: ${data.length} filas`) }; },
        async maybeSingle() { const { data, error } = await run(); return error ? { data: null, error } : { data: data[0] ?? null, error: null }; },
        then(resolve, reject) { return run().then(resolve, reject); },
      };
      return chain;
    },
  };
}

const AVANCYS_STUDY = {
  title: 'Estudio de seguridad bodega principal',
  client_source: 'avancys', client_ref: '900123456', client_name: 'Cliente de prueba S.A.S.', client_nit: '900123456',
  site_source: 'avancys_puesto', site_ref: 'PU-0001', site_name: 'Bodega principal', site_city: 'Pereira',
  visit_date: '2026-11-10',
};

test('migración 178: permiso, restricciones, grants, RLS y reversa', async () => {
  const pg = await database();
  const permission = await pg.query(`select code, active from public.psi_access_permissions where code = 'estudios_seguridad'`);
  assert.deepEqual(permission.rows, [{ code: 'estudios_seguridad', active: true }]);

  const study = await pg.query(`insert into public.psi_security_studies (title, client_source, client_ref, client_name, site_source, site_ref, site_name, prepared_by)
    values ('Prueba de base', 'avancys', '900123456', 'Cliente', 'avancys_puesto', 'PU-1', 'Sede', '${PREPARER.id}') returning id, code, status, methodology_id`);
  assert.match(study.rows[0].code, /^EST-\d{4}-0001$/, 'el código legible lo pone la base');
  assert.equal(study.rows[0].status, 'borrador');
  assert.equal(study.rows[0].methodology_id, 'instalaciones-fisicas-v1');
  const studyId = study.rows[0].id;

  await assert.rejects(pg.exec(`insert into public.psi_security_studies (title, client_source, client_ref, client_name, site_source, site_name, prepared_by)
    values ('Sin referencia', 'avancys', '1', 'Cliente', 'avancys_puesto', 'Sede', '${PREPARER.id}')`), /site_ref_required/, 'una sede de la fuente necesita su referencia');
  await assert.rejects(pg.exec(`insert into public.psi_security_studies (title, client_source, client_ref, client_name, site_source, site_name, prepared_by)
    values ('Cliente a mano', 'manual', '1', 'Cliente', 'manual', 'Sede', '${PREPARER.id}')`), /client_source/, 'el cliente no se escribe a mano');
  const risk = `insert into public.psi_security_study_risks (study_id, number, title, probability, impact_company, impact_people, created_by`;
  await assert.rejects(pg.exec(`${risk}) values ('${studyId}', 1, 'Fuera de escala', 6, 3, 3, '${PREPARER.id}')`), /probability/);
  await assert.rejects(pg.exec(`${risk}, current_quality) values ('${studyId}', 1, 'Control a medias', 3, 3, 3, '${PREPARER.id}', 4)`), /current_rating_complete/);

  for (const table of ['psi_security_studies', 'psi_security_study_zones', 'psi_security_study_risks', 'psi_security_study_actions']) {
    const grants = await pg.query(`select grantee, privilege_type from information_schema.role_table_grants where table_name = $1 order by grantee, privilege_type`, [table]);
    assert.deepEqual(grants.rows.map(row => `${row.grantee}:${row.privilege_type}`).filter(item => !item.startsWith('postgres')),
      ['service_role:DELETE', 'service_role:INSERT', 'service_role:SELECT', 'service_role:UPDATE'], `${table}: sólo el servidor`);
    const rls = await pg.query(`select relrowsecurity from pg_class where relname = $1`, [table]);
    assert.equal(rls.rows[0].relrowsecurity, true, `${table}: RLS activo`);
  }

  await pg.exec(rollback);
  const gone = await pg.query(`select to_regclass('public.psi_security_studies') as name`);
  assert.equal(gone.rows[0].name, null);
  const inactive = await pg.query(`select active from public.psi_access_permissions where code = 'estudios_seguridad'`);
  assert.equal(inactive.rows[0].active, false);
});

test('un estudio se registra completo y el servidor calcula la valoración', async () => {
  const db = supabaseOver(await database());
  const study = await createStudy(db, AVANCYS_STUDY, PREPARER);
  assert.equal(study.status, 'borrador');
  assert.equal(study.prepared_by, PREPARER.id);

  const bodega = await addZone(db, study.id, { name: 'Bodega 3', description: 'Almacenamiento de producto terminado' }, PREPARER);
  const porteria = await addZone(db, study.id, { name: 'Portería vehicular' }, PREPARER);
  assert.deepEqual([bodega.position, porteria.position], [1, 2]);

  // El R4 de HADA (acceso indebido a bodegas): P4, I4, control 3/4/3 → actual 12 alto con la v1.
  const r1 = await addRisk(db, study.id, {
    zone_id: bodega.id, catalog_risk_code: 'R08', process_code: 'P11', title: 'Acceso indebido a zonas de almacenamiento',
    causes: 'Malla rota en el costado norte', probability: 4, impact_company: 4, impact_people: 2,
    current_control: 'Ronda cada dos horas', current_quality: 3, current_efficacy: 4, current_efficiency: 3,
    proposed_control: 'Reparar la malla y poner cámara con analítica', proposed_quality: 4, proposed_efficacy: 4, proposed_efficiency: 4,
  }, PREPARER);
  assert.equal(r1.number, 1);
  assert.deepEqual([r1.valuation.actual.magnitud, r1.valuation.actual.nivel, r1.valuation.residual.magnitud, r1.valuation.residual.nivel], [12, 'alto', 8, 'moderado']);

  // Riesgo propio, sin catálogo ni controles calificados: el residual es el inherente.
  const r2 = await addRisk(db, study.id, { zone_id: porteria.id, title: 'Ingreso de vehículos sin registro', probability: '3', impact_company: '3', impact_people: '4' }, PREPARER, { origin: 'agente' });
  assert.equal(r2.number, 2);
  assert.equal(r2.origin, 'agente');
  assert.equal(r2.valuation.residual.magnitud, 12);

  await addAction(db, study.id, { risk_id: r1.id, description: 'Reparar la malla del costado norte', owner_label: 'Mantenimiento del cliente', due_date: '2026-12-15', priority: 'alta' }, PREPARER);

  const full = await getStudy(db, study.id);
  assert.equal(full.editable, true);
  assert.equal(full.risks.length, 2);
  assert.equal(full.actions.length, 1);
  assert.deepEqual(full.summary.levels.actual, { alto: 2 });
  assert.equal(full.catalog.procesos.length, 22);
  assert.equal(full.catalog.riesgos.length, 26);

  // Corregir una calificación recalcula; nadie escribe el nivel.
  const corrected = await updateRisk(db, study.id, r1.id, { probability: 2, level: 'bajo', valuation: { actual: { nivel: 'bajo' } } }, PREPARER);
  assert.deepEqual([corrected.valuation.actual.magnitud, corrected.valuation.actual.nivel], [8, 'moderado']);

  // Borrar una zona no borra sus riesgos: quedan sin zona.
  await deleteZone(db, study.id, porteria.id, PREPARER);
  const afterZone = await getStudy(db, study.id);
  assert.equal(afterZone.risks.find(risk => risk.id === r2.id).zone_id, null);

  await deleteRisk(db, study.id, r1.id, PREPARER);
  const listed = await listStudies(db);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].risk_count, 1);
  assert.match(listed[0].code, /^EST-/);
});

test('reglas de captura: cliente de una fuente, escalas completas, catálogo y estudio cerrado', async () => {
  assert.throws(() => cleanStudyInput({ ...AVANCYS_STUDY, client_source: 'manual' }), /no se escriben a mano/);
  assert.throws(() => cleanStudyInput({ ...AVANCYS_STUDY, site_ref: '' }), /referencia de la fuente/);
  assert.doesNotThrow(() => cleanStudyInput({ ...AVANCYS_STUDY, site_source: 'manual', site_ref: null, site_name: 'Lote del prospecto' }));

  const pg = await database();
  const db = supabaseOver(pg);
  const study = await createStudy(db, AVANCYS_STUDY, PREPARER);
  const base = { title: 'Riesgo de prueba', probability: 3, impact_company: 3, impact_people: 3 };
  await assert.rejects(addRisk(db, study.id, { ...base, probability: 7 }), /Probabilidad: debe ser un número entero de 1 a 5/);
  await assert.rejects(addRisk(db, study.id, { ...base, current_quality: 3 }), /califique calidad, eficacia y eficiencia/);
  await assert.rejects(addRisk(db, study.id, { ...base, catalog_risk_code: 'R99' }), /catálogo inválido/);
  await assert.rejects(addRisk(db, study.id, { ...base, zone_id: '22222222-2222-4222-8222-222222222222' }), /Zona: no existe en este estudio/);
  await assert.rejects(addAction(db, study.id, { risk_id: '22222222-2222-4222-8222-222222222222', description: 'Algo' }), /Riesgo: no existe en este estudio/);
  await assert.rejects(getStudy(db, '33333333-3333-4333-8333-333333333333'), error => error.status === 404);
  await assert.rejects(getStudy(db, 'no-es-uuid'), /identificador inválido/);

  // Fuera de borrador el estudio no se toca (el flujo de revisión llega en el tramo 3).
  await pg.query(`update public.psi_security_studies set status = 'en_revision' where id = $1`, [study.id]);
  await assert.rejects(addRisk(db, study.id, base), error => error.status === 409);
  await assert.rejects(updateStudy(db, study.id, { title: 'Otro título' }), error => error.status === 409);
});
