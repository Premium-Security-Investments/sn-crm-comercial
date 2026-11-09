// Mejora 8 (encargo desde Terminal; Juan, 2026-11-09): el consecutivo del contrato en el RUP en cada experiencia. En
// Terminal hubo que buscar a mano que la experiencia 84 es el contrato 086.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { loadCompanyBase } from '../company-base.js';
import { resolverExperiencia } from '../catalogo-fuentes.js';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const m194 = read('supabase/migrations/194_experiencia_consecutivo_rup.sql');

test('la 194 llena las 101 experiencias (84 → 086), no pisa lo que ya tenga y es reversible', async () => {
  const pg = new PGlite();
  await pg.exec(`create table public.psi_company_experience (id uuid primary key default gen_random_uuid(), rup_number integer, contracting_party text, updated_at timestamptz);
    insert into public.psi_company_experience (rup_number, contracting_party) select n, 'c' || n from generate_series(1, 101) n;
    insert into public.psi_company_experience (rup_number, contracting_party) values (null, 'sin número');`);
  await pg.exec(m194);
  const get = async n => (await pg.query(`select rup_consecutive c from psi_company_experience where rup_number = $1`, [n])).rows[0].c;
  assert.equal(await get(84), '086');
  assert.equal(await get(35), '035');
  assert.equal(await get(76), '076');
  assert.equal(await get(77), '079', 'desde la 77 se separan');
  assert.equal(await get(101), '105');
  assert.equal((await pg.query(`select count(*)::int n from psi_company_experience where rup_consecutive is not null`)).rows[0].n, 101);
  await pg.exec(`update psi_company_experience set rup_consecutive = '999' where rup_number = 1`);
  await pg.exec(m194);
  assert.equal(await get(1), '999', 'correr dos veces no pisa');
  await pg.exec(read('supabase/rollbacks/194_experiencia_consecutivo_rup_rollback.sql'));
  assert.equal((await pg.query(`select count(*)::int n from information_schema.columns where table_name = 'psi_company_experience' and column_name = 'rup_consecutive'`)).rows[0].n, 0);
  await pg.close();
});

function db({ withColumn }) {
  const rows = [{ id: '1', rup_number: 84, ...(withColumn ? { rup_consecutive: '086' } : {}), contracting_party: 'Terminales de Transporte de Medellín S.A.', value_smmlv: 4555.52 }];
  const query = table => {
    const state = { select: '' };
    const chain = {
      select(select) { state.select = select; return chain; },
      order() { return chain; }, eq() { return chain; },
      then(resolve) {
        if (table !== 'psi_company_experience') return Promise.resolve({ data: [], error: null }).then(resolve);
        if (!withColumn && state.select.includes('rup_consecutive')) return Promise.resolve({ data: null, error: { code: '42703', message: 'column rup_consecutive does not exist' } }).then(resolve);
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return chain;
  };
  return { from: query };
}

test('Empresa y la Mesa leen el consecutivo; sin la 194 siguen funcionando sin él', async () => {
  const conColumna = await resolverExperiencia(db({ withColumn: true }), { pregunta: 'terminales medellin' });
  assert.equal(conColumna.valor.experiencias[0].consecutivo_del_contrato_en_el_rup, '086');
  const sinColumna = await resolverExperiencia(db({ withColumn: false }), { pregunta: 'terminales medellin' });
  assert.equal(sinColumna.valor.experiencias[0].consecutivo_del_contrato_en_el_rup, null);
  assert.equal(sinColumna.valor.experiencias[0].numero_rup, 84);
  const base = await loadCompanyBase(db({ withColumn: false }));
  assert.equal(base.experience.length, 1);
  assert.match(read('src/tenders/components/CompanyBaseSections.tsx'), /row\.rup_consecutive \?\?/);
});
