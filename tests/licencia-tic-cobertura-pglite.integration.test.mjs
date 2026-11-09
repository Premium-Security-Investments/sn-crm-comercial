// Migración 195 (F12 reabierto, punto 4): la cobertura de la licencia TIC en la ficha, para que Vig-IA la compare con
// lo que pide cada pliego (Fiscalía pedía Quibdó; la SIC, Bogotá).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFileSync(new URL(`../supabase/${name}`, import.meta.url), 'utf8');

async function db() {
  const pg = new PGlite();
  await pg.exec(`create table public.psi_agt002_company_evidence_registry (id uuid primary key default gen_random_uuid(), entry_id text not null, version integer not null,
    current boolean not null, vigencia_text text not null, expiry date, notes text, source_reference text not null, existence_status text not null,
    human_review_status text not null, decision_humana text, decision_humana_fecha date, decision_humana_por uuid, created_by uuid,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (entry_id, version));
    create unique index one_current on public.psi_agt002_company_evidence_registry (entry_id) where current;
    insert into public.psi_agt002_company_evidence_registry (entry_id, version, current, vigencia_text, source_reference, existence_status, human_review_status, decision_humana, decision_humana_fecha)
      values ('communications_license', 2, true, 'Compuesto de cinco permisos; vigencia no determinable', 'LICENCIA DE COMUNICACIONES', 'verified', 'approved', 'Actualizado', '2026-10-30');`);
  return pg;
}
const current = pg => pg.query(`select version, vigencia_text, expiry::text, notes from psi_agt002_company_evidence_registry where current`).then(r => r.rows[0]);

test('la ficha dice dónde cubre la licencia y hasta cuándo, y que no cubre Bogotá ni Quibdó', async () => {
  const pg = await db();
  await pg.exec(read('migrations/195_licencia_tic_cobertura.sql'));
  const row = await current(pg);
  assert.equal(row.version, 3);
  assert.equal(row.expiry, '2035-12-31');
  assert.match(row.vigencia_text, /todo RISARALDA/);
  assert.match(row.vigencia_text, /NO cubre otros departamentos.*Bogotá, Chocó\/Quibdó/);
  const notes = JSON.parse(row.notes);
  assert.deepEqual(notes.cobertura_tic.redes[0].municipios['Quindío'].length, 7);
  await pg.exec(read('migrations/195_licencia_tic_cobertura.sql'));
  assert.equal((await current(pg)).version, 3, 'correr dos veces no crea otra versión');
  await pg.exec(read('rollbacks/195_licencia_tic_cobertura_rollback.sql'));
  assert.equal((await current(pg)).version, 2);
  await pg.close();
});
