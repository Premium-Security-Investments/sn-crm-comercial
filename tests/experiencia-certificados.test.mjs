// Mejora 9, primera parte (Juan, 2026-11-10): el certificado de cada experiencia y a qué cliente pedírselo primero. No
// hay carpeta con los certificados: hay que pedirlos, y un cliente certifica varios contratos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { certificateRequestPlan, clientKey } from '../verticales/licitaciones/experience-certificates.js';
import { loadCompanyBase, saveExperienceCertificate } from '../company-base.js';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('el cliente se agrupa sin paréntesis ni forma societaria', () => {
  assert.equal(clientKey('Jerónimo Martins Colombia S.A.S. (Tiendas Ara)'), clientKey('Jerónimo Martins Colombia S.A S'));
  assert.equal(clientKey('Empresa de Energía de Pereira S.A'), clientKey('Empresa de Energía de Pereira'));
  assert.equal(clientKey('Megabús S.A.'), 'megabus');
});

test('la lista va por cliente, en orden del valor que destraba, y deja fuera lo que ya se tiene', () => {
  const plan = certificateRequestPlan([
    { id: '1', contracting_party: 'Jerónimo Martins Colombia S.A.S. (Tiendas Ara)', rup_consecutive: '070', value_smmlv: '49113.99' },
    { id: '2', contracting_party: 'Jerónimo Martins Colombia S.A.S.', rup_consecutive: '099', value_smmlv: 24224.27, certificate_status: 'falta' },
    { id: '3', contracting_party: 'Aeropuerto Internacional Matecaña', rup_consecutive: '050', value_smmlv: 2893.07, certificate_status: 'recibido' },
    { id: '4', contracting_party: 'Aeropuerto Internacional Matecaña', rup_consecutive: '054', value_smmlv: 2837.64, certificate_status: 'falta' },
    { id: '5', contracting_party: 'Terminales de Transporte de Medellín S.A.', rup_consecutive: '086', value_smmlv: 4555.52, certificate_status: 'incompleto' },
    { id: '6', contracting_party: 'Megabús S.A.', rup_consecutive: '088', value_smmlv: 5658.95, certificate_status: 'pedido' },
  ]);
  assert.deepEqual(plan.top.map(client => [client.name, client.contracts.map(item => item.consecutive)]), [
    ['Jerónimo Martins Colombia S.A.S.', ['070', '099']],
    ['Terminales de Transporte de Medellín S.A.', ['086']],
    ['Aeropuerto Internacional Matecaña', ['054']],
  ]);
  assert.deepEqual(plan.counts, { falta: 3, pedido: 1, recibido: 1, incompleto: 1, completo: 0 });
  assert.ok(plan.top[0].accumulated_share > 0.8 && plan.top[2].accumulated_share <= 1);
});

test('la 198 deja los estados, marca lo que consta en SharePoint y es reversible', async () => {
  const pg = new PGlite();
  await pg.exec(`create table public.psi_company_experience (id uuid primary key default gen_random_uuid(), rup_consecutive text, contracting_party text, updated_by uuid);
    insert into public.psi_company_experience (rup_consecutive, contracting_party) values ('050', 'Matecaña'), ('086', 'Medellín'), ('089', 'JM'), ('001', 'UTP');`);
  await pg.exec(read('supabase/migrations/198_experiencia_estado_certificado.sql'));
  await pg.exec(read('supabase/migrations/198_experiencia_estado_certificado.sql'));
  const rows = (await pg.query('select rup_consecutive, certificate_status, certificate_note is not null as nota from psi_company_experience order by 1')).rows;
  assert.deepEqual(rows.map(row => [row.rup_consecutive, row.certificate_status, row.nota]), [['001', 'falta', false], ['050', 'recibido', true], ['086', 'incompleto', true], ['089', 'falta', true]]);
  await assert.rejects(pg.exec(`update psi_company_experience set certificate_status = 'perdido'`));
  await pg.exec(read('supabase/rollbacks/198_experiencia_estado_certificado_rollback.sql'));
  assert.equal((await pg.query(`select count(*)::int n from information_schema.columns where table_name = 'psi_company_experience' and column_name like 'certificate%'`)).rows[0].n, 0);
  await pg.close();
});

test('sin la 198 Empresa sigue leyendo la experiencia y guardar el estado dice qué falta', async () => {
  const selects = [];
  const database = { from: () => {
    const state = {};
    const chain = {
      select(columns) { state.select = columns; selects.push(columns); return chain; },
      order() { return chain; }, eq() { return chain; }, update() { return chain; },
      single: async () => ({ data: null, error: { code: '42703', message: 'column certificate_status does not exist' } }),
      then(resolve) {
        const missing = /certificate_|registry/.test(state.select || '') ? { code: '42703', message: 'column does not exist' } : null;
        return Promise.resolve(missing ? { data: null, error: missing } : { data: [{ id: '1', rup_consecutive: '086', contracting_party: 'Medellín' }], error: null }).then(resolve);
      },
    };
    return chain;
  } };
  const base = await loadCompanyBase(database);
  assert.equal(base.experience.length, 1);
  assert.ok(selects.some(columns => columns.includes('rup_consecutive') && !columns.includes('certificate_status')));
  await assert.rejects(saveExperienceCertificate(database, { id: '1', certificate_status: 'pedido' }, 'u'), /migración 198/);
  await assert.rejects(saveExperienceCertificate(database, { id: '1', certificate_status: 'perdido' }, 'u'), /no es válido/);
});

test('Empresa muestra la lista y la columna del certificado, y la ruta usa el permiso de configurar', () => {
  const ui = read('src/tenders/components/CompanyBaseSections.tsx');
  assert.match(ui, /<CertificateRequestPlan experience=\{experience\} \/>/);
  assert.match(ui, /<th className="company-certificate-col">Certificado<\/th>/);
  const server = read('server/index.js');
  assert.match(server, /app\.post\('\/api\/tender-company-experience\/certificate'[\s\S]{0,200}LICITACIONES_CONFIGURE/);
  assert.equal(server, read('api/[...path].js'));
});
