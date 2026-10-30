// AGT-002 — migración 167 contra Postgres de verdad: Vig-IA puede registrar un documento de empresa y la ficha
// NUNCA queda aprobada por eso.
//
// Lo que fija:
//   1. las dos puertas comparten el mismo núcleo, así que las validaciones no pueden separarse con el tiempo;
//   2. la puerta humana sigue exigiendo custodia humana y se comporta igual que antes (incluido el `rup`, que
//      supersede su versión anterior, y los demás tipos, que conviven);
//   3. la puerta del agente exige identidad de agente —rechaza a una persona, incluso con custodia— y exige que el
//      bloque exista vigente en el registro: un agente no inventa tipos;
//   4. **ninguna de las dos escribe el registro de evidencia**: cargar no aprueba;
//   5. el rollback deja la puerta humana como estaba y retira la del agente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const sql = name => readFileSync(new URL(`../supabase/${name}`, import.meta.url), 'utf8');
// La migración se corre CON su `begin`/`commit`, no recortada: así el DDL queda confirmado antes de la primera
// llamada. Importa porque `lock table` dentro de la función abre transacción y, si el DDL siguiera dentro de la
// transacción implícita de pglite, el `rollback` que repone la sesión tras un error esperado se llevaría también las
// funciones (pasó al escribir esta prueba: "function ... does not exist" a mitad del caso).

const KATHERINE = '11111111-1111-4111-8111-111111111111';
const SIN_CUSTODIA = '22222222-2222-4222-8222-222222222222';
const VIGIA = 'a0020000-0000-4000-8000-000000000002';
const HASH = 'a'.repeat(64);

async function database() {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated; create role service_role; create role anon;
    grant service_role to current_user;
    create table public.psi_sales_profiles (
      id uuid primary key, full_name text, active boolean not null default true, identity_type text
    );
    create table public.psi_access_permissions (code text primary key, active boolean not null default true);
    create table public.psi_profile_permissions (profile_id uuid not null, permission_code text not null);
    create table public.psi_agt002_company_evidence_registry (
      entry_id text not null, current boolean not null default true, integration_active boolean not null default true,
      human_review_status text not null default 'pending_human_review'
    );
    create table public.psi_company_procurement_documents (
      id uuid primary key default gen_random_uuid(), document_type text not null, display_name text not null,
      issued_at date not null, expires_at date, version integer not null, content_hash text not null,
      storage_path text not null, mime_type text not null, size_bytes bigint not null,
      current boolean not null default true, uploaded_by uuid references public.psi_sales_profiles(id),
      created_at timestamptz not null default now()
    );
    create function public.psi_profile_has_tender_custody(p_profile_id uuid) returns boolean language sql stable as $$
      select exists (
        select 1 from public.psi_sales_profiles p
        where p.id = p_profile_id and p.active and coalesce(p.identity_type,'human') = 'human'
          and exists (select 1 from public.psi_profile_permissions pp where pp.profile_id = p.id and pp.permission_code = 'licitaciones')
          and exists (select 1 from public.psi_profile_permissions pp where pp.profile_id = p.id and pp.permission_code = 'licitaciones_custodia')
      )
    $$;
    insert into public.psi_access_permissions (code) values ('licitaciones'), ('licitaciones_custodia');
    insert into public.psi_sales_profiles (id, full_name, active, identity_type) values
      ('${KATHERINE}', 'Katherine Valencia', true, 'human'),
      ('${SIN_CUSTODIA}', 'Comercial sin custodia', true, 'human'),
      ('${VIGIA}', 'Vig-IA', true, 'agent');
    insert into public.psi_profile_permissions (profile_id, permission_code) values
      ('${KATHERINE}', 'licitaciones'), ('${KATHERINE}', 'licitaciones_custodia'),
      ('${SIN_CUSTODIA}', 'licitaciones');
    insert into public.psi_agt002_company_evidence_registry (entry_id) values ('quality_certifications'), ('rup');
  `);
  await pg.exec(sql('migrations/167_documento_de_empresa_por_vigia.sql'));
  return pg;
}

const comoPersona = (pg, overrides = {}) => cargar(pg, 'psi_record_company_procurement_document', {
  type: 'rup', name: 'RUP.pdf', issued: '2026-09-28', expires: null, hash: HASH,
  path: 'company-profile/documents/x/rup.pdf', mime: 'application/pdf', size: 1024, actor: KATHERINE, ...overrides,
}, true);
const comoAgente = (pg, overrides = {}) => cargar(pg, 'psi_record_company_procurement_document_as_agent', {
  type: 'quality_certifications', name: 'BASC_V6.pdf', issued: '2026-06-17', expires: '2027-06-17', hash: HASH,
  path: `company-profile/documents/${VIGIA}/basc.pdf`, mime: 'application/pdf', size: 2048, actor: VIGIA, ...overrides,
}, false);

/**
 * Una llamada que debe fallar. `lock table` dentro de la función abre transacción, y pglite deja la sesión abortada
 * tras el error ("current transaction is aborted"), así que hay que devolverla a su sitio antes del siguiente caso.
 */
async function esperaError(pg, call, patron, mensaje) {
  await assert.rejects(call, patron, mensaje);
  try { await pg.exec('rollback'); } catch { /* no había transacción abierta */ }
}

async function cargar(pg, fn, p, conReemplazo) {
  const args = conReemplazo
    ? '$1::text,$2::text,$3::date,$4::date,$5::text,$6::text,$7::text,$8::bigint,$9::uuid,$10::uuid'
    : '$1::text,$2::text,$3::date,$4::date,$5::text,$6::text,$7::text,$8::bigint,$9::uuid';
  const values = [p.type, p.name, p.issued, p.expires, p.hash, p.path, p.mime, p.size, p.actor];
  if (conReemplazo) values.push(p.replace ?? null);
  const { rows } = await pg.query(`select public.${fn}(${args}) r`, values);
  return rows[0].r;
}

test('la puerta humana sigue exigiendo custodia humana y no cambió de comportamiento', async () => {
  const pg = await database();
  const creado = await comoPersona(pg);
  assert.equal(creado.document_type, 'rup');
  assert.equal(creado.version, 1);
  assert.equal(creado.current, true);

  // El mismo contenido no crea otra versión: devuelve la que ya existe.
  assert.equal((await comoPersona(pg)).id, creado.id);

  // El `rup` sí supersede su versión anterior (regla de la función viva, intacta).
  const nuevo = await comoPersona(pg, { hash: 'b'.repeat(64), path: 'company-profile/documents/x/rup2.pdf' });
  assert.equal(nuevo.version, 2);
  const { rows: rups } = await pg.query("select current from public.psi_company_procurement_documents where document_type='rup' order by version");
  assert.deepEqual(rups.map(r => r.current), [false, true]);

  // Y sigue rechazando a quien no tiene custodia, y a un agente por esta puerta.
  await esperaError(pg, () => comoPersona(pg, { actor: SIN_CUSTODIA, hash: 'c'.repeat(64) }), /perfil humano activo/);
  await esperaError(pg, () => comoPersona(pg, { actor: VIGIA, hash: 'c'.repeat(64) }), /perfil humano activo/);
  await pg.close();
});

test('la puerta del agente carga el documento y lo deja vigente', async () => {
  const pg = await database();
  const creado = await comoAgente(pg);
  assert.equal(creado.document_type, 'quality_certifications');
  assert.equal(creado.current, true);
  const { rows } = await pg.query('select uploaded_by, expires_at, display_name from public.psi_company_procurement_documents where id = $1', [creado.id]);
  assert.equal(rows[0].uploaded_by, VIGIA, 'queda registrado que lo cargó el agente, no una persona');
  assert.equal(rows[0].expires_at.toISOString().slice(0, 10), '2027-06-17');

  // Varios soportes del mismo bloque conviven: las cuatro certificaciones de calidad no se pisan entre ellas.
  await comoAgente(pg, { hash: 'd'.repeat(64), name: 'ISO_9001.pdf', issued: '2025-12-23', expires: '2028-12-22', path: `company-profile/documents/${VIGIA}/iso9001.pdf` });
  const { rows: vigentes } = await pg.query("select count(*)::int n from public.psi_company_procurement_documents where document_type='quality_certifications' and current");
  assert.equal(vigentes[0].n, 2);
  await pg.close();
});

test('cargar NO aprueba la ficha: el registro de evidencia queda intacto', async () => {
  const pg = await database();
  await comoAgente(pg);
  await comoPersona(pg);
  const { rows } = await pg.query('select entry_id, human_review_status from public.psi_agt002_company_evidence_registry order by entry_id');
  assert.deepEqual(rows, [
    { entry_id: 'quality_certifications', human_review_status: 'pending_human_review' },
    { entry_id: 'rup', human_review_status: 'pending_human_review' },
  ]);
  await pg.close();
});

test('la puerta del agente exige identidad de agente y un bloque vigente', async () => {
  const pg = await database();
  // Una persona, incluso con custodia, no entra por aquí: cada puerta tiene su identidad.
  await esperaError(pg, () => comoAgente(pg, { actor: KATHERINE }), /identidad de agente activa/);
  // Un bloque que no existe en el registro, tampoco: un agente no inventa tipos.
  await esperaError(pg, () => comoAgente(pg, { type: 'certificado' }), /no existe vigente en el registro/);
  await esperaError(pg, () => comoAgente(pg, { type: 'otro' }), /no existe vigente en el registro/);
  // Ni un bloque desactivado.
  await pg.query("update public.psi_agt002_company_evidence_registry set integration_active = false where entry_id = 'quality_certifications'");
  await esperaError(pg, () => comoAgente(pg), /no existe vigente en el registro/);
  await pg.close();
});

test('las dos puertas comparten las validaciones del núcleo', async () => {
  const pg = await database();
  const casos = [
    [{ hash: 'nohex' }, /SHA-256/],
    [{ path: 'otra-carpeta/archivo.pdf' }, /company-profile/],
    [{ path: 'company-profile/../secreto.pdf' }, /company-profile/],
    [{ size: 0 }, /entre 1 byte y 50 MB/],
    [{ size: 50 * 1024 * 1024 + 1 }, /entre 1 byte y 50 MB/],
    [{ name: '   ' }, /obligatorios/],
    [{ expires: '2026-06-16', issued: '2026-06-17' }, /fechas del documento/],
  ];
  for (const [override, patron] of casos) {
    await esperaError(pg, () => comoAgente(pg, override), patron, `agente: ${JSON.stringify(override)}`);
    await esperaError(pg, () => comoPersona(pg, override), patron, `persona: ${JSON.stringify(override)}`);
  }
  await pg.close();
});

test('el núcleo no es una puerta: la aplicación no lo puede llamar', async () => {
  const pg = await database();
  const { rows } = await pg.query(`select has_function_privilege('service_role',
    'public.psi_record_company_procurement_document_core(text,text,date,date,text,text,text,bigint,uuid,uuid)', 'execute') ok`);
  assert.equal(rows[0].ok, false);
  const { rows: agente } = await pg.query(`select has_function_privilege('service_role',
    'public.psi_record_company_procurement_document_as_agent(text,text,date,date,text,text,text,bigint,uuid)', 'execute') ok`);
  assert.equal(agente[0].ok, true, 'la puerta del agente sí la llama el servidor');
  await pg.close();
});

test('la reversa deja la puerta humana en pie y retira la del agente', async () => {
  const pg = await database();
  await pg.exec(sql('rollbacks/167_documento_de_empresa_por_vigia_rollback.sql'));
  const creado = await comoPersona(pg);
  assert.equal(creado.version, 1, 'la carga humana sigue funcionando después de revertir');
  await esperaError(pg, () => comoAgente(pg), /does not exist|no existe/i);
  const { rows } = await pg.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'psi_record_company_procurement_document_core'`);
  assert.equal(rows[0].n, 0);
  await pg.close();
});
