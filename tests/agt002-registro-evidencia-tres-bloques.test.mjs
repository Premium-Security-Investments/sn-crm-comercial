// AGT-002 — los tres bloques nuevos del registro de evidencia empresarial (migración 166, autorizada por Juan el
// 2026-10-30) contra Postgres de verdad, y el ancla de la decisión cuando un bloque tiene VARIOS soportes vigentes.
//
// Lo que fija:
//   1. los tres bloques quedan vigentes y activos, con la vigencia verificada y el vencimiento más próximo del que
//      agrupa varios certificados;
//   2. la migración es idempotente y no pisa una decisión humana ya registrada;
//   3. **cargar un documento en un bloque nuevo lo deja verificado solo**: el payload exacto de
//      `recordUploadAsVerification` pasa los CHECK de la 061 y toca sólo columnas que la aplicación tiene permitido
//      escribir (eso es lo que Juan pidió comprobar);
//   4. el candado de la 061 sigue en pie: la aplicación no puede INSERT ni DELETE en el registro;
//   5. la reversa desactiva el bloque y no borra nada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { saveCompanyEvidenceDecision } from '../company-base.js';

const TABLE = 'public.psi_agt002_company_evidence_registry';
const ACTOR = '11111111-1111-4111-8111-111111111111';
const BLOQUES = ['quality_certifications', 'agency_authorizations', 'chamber_of_commerce'];

const sql = name => readFileSync(new URL(`../supabase/${name}`, import.meta.url), 'utf8');
const stripTxn = text => text.replace(/^\s*begin\s*;/i, '').replace(/commit\s*;\s*$/i, '').trim();

async function database() {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated; create role service_role; create role anon;
    grant service_role to current_user;
    create function public.psi_sales_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true);
    insert into public.psi_sales_profiles (id) values ('${ACTOR}');
    create table public.psi_company_procurement_documents (id uuid primary key default gen_random_uuid());
  `);
  await pg.exec(stripTxn(sql('migrations/061_agt002_company_evidence_registry.sql')));
  await pg.exec(stripTxn(sql('migrations/158_agt002_company_evidence_human_decision.sql')));
  await pg.exec(stripTxn(sql('migrations/159_agt002_company_evidence_decision_document.sql')));
  await pg.exec(stripTxn(sql('migrations/166_registro_evidencia_tres_bloques.sql')));
  return pg;
}

test('los tres bloques quedan vigentes, activos y pendientes de revisión humana', async () => {
  const pg = await database();
  const { rows } = await pg.query(`select entry_id, version, current, integration_active, existence_status,
      human_review_status, applicability_status, expiry, vigencia_text, document_class, vigente_para_habilitacion,
      source_manifest_version, decision_humana
    from ${TABLE} where entry_id = any($1) order by entry_id`, [BLOQUES]);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.version, 1);
    assert.equal(row.current, true);
    assert.equal(row.integration_active, true);
    // Lo cierto al abrir el bloque: el dato está verificado contra el PDF, el archivo todavía no está cargado.
    assert.equal(row.existence_status, 'reported');
    assert.equal(row.human_review_status, 'pending_human_review');
    assert.equal(row.applicability_status, 'pending_case_validation');
    assert.equal(row.decision_humana, null);
    assert.equal(row.source_manifest_version, 'v0.3.2-bloques-nuevos-20261030');
    assert.ok(row.vigencia_text.length > 40, `${row.entry_id} necesita su vigencia escrita`);
  }
  const porId = Object.fromEntries(rows.map(row => [row.entry_id, row]));

  // El bloque que agrupa cuatro certificados lleva el vencimiento MÁS PRÓXIMO: el BASC.
  assert.equal(porId.quality_certifications.expiry.toISOString().slice(0, 10), '2027-06-17');
  assert.match(porId.quality_certifications.vigencia_text, /BASC Versión 6-2022 N.º COLPEI00007-1-21/);
  assert.match(porId.quality_certifications.vigencia_text, /ISO 9001 CO25\.07944/);
  assert.match(porId.quality_certifications.vigencia_text, /vencen 2028-12-22/);
  // Suma puntos, no habilita.
  assert.equal(porId.quality_certifications.vigente_para_habilitacion, false);

  // Las resoluciones de agencia no vencen, y la prosa explica las dos formas válidas de acreditar una ciudad.
  assert.equal(porId.agency_authorizations.expiry, null);
  assert.equal(porId.agency_authorizations.vigente_para_habilitacion, true);
  assert.match(porId.agency_authorizations.vigencia_text, /Bogotá 2020-0049297/);
  assert.match(porId.agency_authorizations.vigencia_text, /Pereira, Cartago y Manizales no tienen resolución propia/);
  assert.match(porId.agency_authorizations.vigencia_text, /En Medellín manda la de 2024/);

  assert.equal(porId.chamber_of_commerce.expiry, null);
  assert.match(porId.chamber_of_commerce.vigencia_text, /lo que caduca es su antigüedad/);
  await pg.close();
});

test('la migración se puede repetir y no pisa una decisión ya registrada', async () => {
  const pg = await database();
  await pg.query(`update ${TABLE} set human_review_status = 'approved', existence_status = 'verified',
      decision_humana = 'Soporte cargado y revisado.', decision_humana_fecha = date '2026-10-30', decision_humana_por = $1
    where entry_id = 'chamber_of_commerce'`, [ACTOR]);
  await pg.exec(stripTxn(sql('migrations/166_registro_evidencia_tres_bloques.sql')));
  const { rows } = await pg.query(`select count(*)::int total from ${TABLE} where entry_id = any($1)`, [BLOQUES]);
  assert.equal(rows[0].total, 3, 'no se insertan versiones nuevas al repetir');
  const { rows: decidido } = await pg.query(`select human_review_status, decision_humana from ${TABLE} where entry_id = 'chamber_of_commerce'`);
  assert.equal(decidido[0].human_review_status, 'approved');
  assert.match(decidido[0].decision_humana, /Soporte cargado y revisado/);
  await pg.close();
});

test('cargar un documento en un bloque nuevo lo deja verificado solo', async () => {
  const pg = await database();
  const { rows: documento } = await pg.query('insert into public.psi_company_procurement_documents default values returning id');
  // El payload EXACTO de recordUploadAsVerification (company-base.js), sobre el bloque recién abierto.
  const payload = {
    human_review_status: 'approved',
    existence_status: 'verified',
    decision_humana: 'Soporte cargado por Katherine Valencia: expedido el 2026-06-17, BASC V6 COLPEI00007-1-21.pdf.',
    decision_humana_fecha: '2026-06-17',
    decision_humana_por: ACTOR,
    estado_posterior_decision: 'Verificado al cargar el soporte',
    decision_support_document_id: documento[0].id,
  };
  const columnas = Object.keys(payload);
  // Primero: la aplicación tiene permiso de escribir EXACTAMENTE esas columnas (158 y 159, por columna).
  for (const columna of columnas) {
    const { rows } = await pg.query(`select has_column_privilege('service_role', '${TABLE}', $1, 'UPDATE') ok`, [columna]);
    assert.equal(rows[0].ok, true, `service_role debe poder escribir ${columna}`);
  }
  // Y después: el payload pasa los CHECK de la 061 sobre una fila nueva.
  const { rows: actualizado } = await pg.query(
    `update ${TABLE} set human_review_status = $2, existence_status = $3, decision_humana = $4,
       decision_humana_fecha = $5, decision_humana_por = $6, estado_posterior_decision = $7,
       decision_support_document_id = $8
     where entry_id = $1 and current = true
     returning entry_id, human_review_status, existence_status, decision_support_document_id`,
    ['quality_certifications', payload.human_review_status, payload.existence_status, payload.decision_humana,
      payload.decision_humana_fecha, payload.decision_humana_por, payload.estado_posterior_decision,
      payload.decision_support_document_id],
  );
  assert.equal(actualizado.length, 1);
  assert.equal(actualizado[0].human_review_status, 'approved');
  assert.equal(actualizado[0].existence_status, 'verified');
  assert.equal(actualizado[0].decision_support_document_id, documento[0].id, 'la aprobación queda amarrada al documento');
  await pg.close();
});

test('el candado de la 061 sigue en pie: la aplicación no inventa ni borra bloques', async () => {
  const pg = await database();
  for (const [privilegio, nombre] of [['INSERT', 'insertar'], ['DELETE', 'borrar']]) {
    const { rows } = await pg.query(`select has_table_privilege('service_role', '${TABLE}', $1) ok`, [privilegio]);
    assert.equal(rows[0].ok, false, `service_role no puede ${nombre} en el registro`);
  }
  // Y las columnas que fijan el gobierno del bloque siguen cerradas a la aplicación.
  for (const columna of ['entry_id', 'current', 'integration_active', 'vigencia_text', 'expiry', 'vigente_para_habilitacion', 'applicability_status']) {
    const { rows } = await pg.query(`select has_column_privilege('service_role', '${TABLE}', $1, 'UPDATE') ok`, [columna]);
    assert.equal(rows[0].ok, false, `${columna} no se escribe desde la aplicación`);
  }
  await pg.close();
});

test('la reversa desactiva los tres bloques y no borra nada', async () => {
  const pg = await database();
  await pg.exec(stripTxn(sql('rollbacks/166_registro_evidencia_tres_bloques_rollback.sql')));
  const { rows } = await pg.query(`select entry_id, current, integration_active from ${TABLE} where entry_id = any($1) order by entry_id`, [BLOQUES]);
  assert.equal(rows.length, 3, 'las filas se conservan con su historia');
  for (const row of rows) {
    assert.equal(row.integration_active, false, `${row.entry_id} deja de ofrecerse`);
    assert.equal(row.current, true, 'la reversa desactiva, no retira la versión');
  }
  await pg.close();
});

// --- El ancla de la decisión cuando el bloque tiene VARIOS soportes vigentes -------------------------------------
// `psi_record_company_procurement_document` sólo supersede automáticamente el `rup`, así que los cuatro certificados
// de calidad y las tres resoluciones de agencia conviven como `current`. Antes se pedía `.maybeSingle()` y la
// decisión humana se caía con "más de una fila" justo en los bloques que más soportes tienen.
function fakeDatabaseConVariosSoportes(documentos) {
  const consultas = [];
  return {
    consultas,
    from(table) {
      if (table === 'psi_company_procurement_documents') {
        const consulta = { table, filtros: {}, orden: [], limite: null };
        consultas.push(consulta);
        const chain = {
          select() { return chain; },
          eq(column, value) { consulta.filtros[column] = value; return chain; },
          order(column, options) { consulta.orden.push([column, options?.ascending === true ? 'asc' : 'desc']); return chain; },
          limit(value) { consulta.limite = value; return Promise.resolve({ data: documentos.slice(0, value), error: null }); },
          maybeSingle() { throw new Error('no debe usarse maybeSingle: un bloque puede tener varios soportes vigentes'); },
        };
        return chain;
      }
      const registro = {
        update(payload) { registro.payload = payload; return registro; },
        eq() { return registro; },
        select() { return registro; },
        maybeSingle() { return Promise.resolve({ data: { entry_id: 'quality_certifications', ...registro.payload }, error: null }); },
      };
      consultas.push({ table, registro });
      return registro;
    },
  };
}

test('con varios soportes vigentes la decisión se ancla al más reciente, sin caerse', async () => {
  const database = fakeDatabaseConVariosSoportes([
    { id: 'doc-basc', issued_at: '2026-06-17', version: 1 },
    { id: 'doc-iso9001', issued_at: '2025-12-23', version: 1 },
  ]);
  const guardado = await saveCompanyEvidenceDecision(database, {
    entry_id: 'quality_certifications',
    decision: 'approved',
    decision_humana: 'BASC y las tres ISO leídas en el original.',
  }, ACTOR, new Date('2026-10-30T12:00:00Z'));
  assert.equal(guardado.entry_id, 'quality_certifications');
  assert.equal(guardado.decision_support_document_id, 'doc-basc', 'el más reciente por expedición');

  const consulta = database.consultas.find(item => item.table === 'psi_company_procurement_documents');
  assert.deepEqual(consulta.filtros, { document_type: 'quality_certifications', current: true });
  assert.equal(consulta.limite, 1, 'se pide una sola fila, no se exige que haya una sola');
  // Orden determinístico: expedición, versión y, para desempatar, el id.
  assert.deepEqual(consulta.orden, [['issued_at', 'desc'], ['version', 'desc'], ['id', 'asc']]);
});

// --- Enlazar una sede con el documento que la respalda -----------------------------------------------------------
// Las siete sedes ya tienen su resolución escrita, pero sin el documento enlazado (Juan, 2026-10-30: "cuando existan
// los bloques y se suban los PDF, hay que poder enlazarlos").
test('la sede muestra y permite escoger el documento que la respalda', async () => {
  const { readFileSync: read } = await import('node:fs');
  const { loadReactComponent, renderReactComponent } = await import('./helpers/bundle-react-component.mjs');
  const CompanySitesSection = await loadReactComponent('src/tenders/components/CompanyBaseSections.tsx', 'CompanySitesSection');

  const documents = [
    { id: 'doc-bogota', document_type: 'agency_authorizations', display_name: 'Res. 2020-0049297 agencia Bogotá.pdf', issued_at: '2020-08-27', current: true, version: 1, size_bytes: 10, created_at: '2026-10-30T00:00:00Z', state: 'sin_vencimiento' },
    { id: 'doc-licencia', document_type: 'supervigilancia_operating_license', display_name: 'Licencia de funcionamiento.pdf', issued_at: '2019-01-01', current: true, version: 1, size_bytes: 10, created_at: '2026-10-30T00:00:00Z', state: 'sin_vencimiento' },
    { id: 'doc-rup', document_type: 'rup', display_name: 'RUP.pdf', issued_at: '2026-09-28', current: true, version: 1, size_bytes: 10, created_at: '2026-10-30T00:00:00Z', state: 'sin_vencimiento' },
  ];
  const html = renderReactComponent(CompanySitesSection, {
    sites: [
      { id: 's1', department: 'Cundinamarca', city: 'Bogotá', is_main: false, supervigilancia_authorization: 'Res. 2020-0049297', support_document_id: 'doc-bogota' },
      { id: 's2', department: 'Risaralda', city: 'Pereira', is_main: true, supervigilancia_authorization: 'Amparada en la licencia', support_document_id: null },
    ],
    documents,
    available: true,
    canEdit: true,
    onSave: async () => {},
  });
  assert.match(html, /<th>Documento<\/th>/, 'la tabla muestra el documento enlazado');
  assert.match(html, /Res\. 2020-0049297 agencia Bogotá\.pdf/, 'la sede enlazada nombra su documento');
  assert.match(html, /Sin enlazar/, 'la sede sin documento lo dice, no queda en blanco');

  // El selector del formulario ofrece sólo lo que acredita una ciudad: la resolución de agencia o la licencia.
  const source = read(new URL('../src/tenders/components/CompanyBaseSections.tsx', import.meta.url), 'utf8');
  assert.match(source, /SITE_SUPPORT_DOCUMENT_TYPES = \['agency_authorizations', 'supervigilancia_operating_license'\]/);
  assert.match(source, /key: 'support_document_id'[\s\S]*type: 'select'/);
  assert.match(source, /<option value="">Sin documento enlazado<\/option>/);
  // El RUP no acredita una sede y no puede aparecer entre las opciones.
  assert.doesNotMatch(source, /SITE_SUPPORT_DOCUMENT_TYPES[^\n]*'rup'/);
});
