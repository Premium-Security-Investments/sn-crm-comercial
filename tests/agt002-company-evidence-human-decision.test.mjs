import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync as read } from 'node:fs';
import { cleanCompanyEvidenceDecision, COMPANY_EVIDENCE_DECISION_COLUMNS } from '../company-base.js';

const migration061 = readFileSync(new URL('../supabase/migrations/061_agt002_company_evidence_registry.sql', import.meta.url), 'utf8');
const migration158 = readFileSync(new URL('../supabase/migrations/158_agt002_company_evidence_human_decision.sql', import.meta.url), 'utf8');

const TABLE = 'public.psi_agt002_company_evidence_registry';
const ACTOR = '11111111-1111-4111-8111-111111111111';
const DECISION_COLUMNS = ['existence_status', 'human_review_status', 'decision_humana', 'decision_humana_fecha', 'estado_posterior_decision', 'decision_humana_por'];
// La 061 separó a propósito la existencia, la revisión humana y la aplicabilidad al caso.
// La manija sólo abre la revisión: lo demás sigue cerrado a la aplicación.
const COLUMNS_THAT_STAY_CLOSED = ['entry_id', 'current', 'notes', 'applicability_status', 'vigente_para_habilitacion', 'hash', 'source_reference'];

function stripTxn(sql) {
  return sql.replace(/^\s*begin\s*;/i, '').replace(/commit\s*;\s*$/i, '').trim();
}

async function database() {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated; create role service_role; create role anon;
    grant service_role to current_user;
    create function public.psi_sales_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true);
    insert into public.psi_sales_profiles (id) values ('${ACTOR}');
  `);
  await pg.exec(stripTxn(migration061));
  await pg.exec(stripTxn(migration158));
  return pg;
}

async function columnPriv(pg, column, priv = 'UPDATE') {
  const { rows } = await pg.query(`select has_column_privilege('service_role', '${TABLE}', '${column}', '${priv}') ok`);
  return rows[0].ok === true;
}

test('la decisión se limpia antes de tocar la base', () => {
  assert.throws(() => cleanCompanyEvidenceDecision({ decision: 'approved', decision_humana: 'x' }, { actorId: ACTOR }), /Indique la ficha/);
  assert.throws(() => cleanCompanyEvidenceDecision({ entry_id: 'rup', decision: 'quizas', decision_humana: 'x' }, { actorId: ACTOR }), /approved/);
  assert.throws(() => cleanCompanyEvidenceDecision({ entry_id: 'rup', decision: 'approved' }, { actorId: ACTOR }), /en qué se basa/);
  assert.throws(() => cleanCompanyEvidenceDecision({ entry_id: 'rup', decision: 'approved', decision_humana: 'x' }, { actorId: '' }), /quién decide/);
  assert.throws(() => cleanCompanyEvidenceDecision({ entry_id: 'rup', decision: 'approved', decision_humana: 'x', existence_status: 'inventado' }, { actorId: ACTOR }), /estado de existencia/);
});

test('aprobar deja el hecho verificado, con autor y fecha', () => {
  const { entryId, payload } = cleanCompanyEvidenceDecision(
    { entry_id: 'rup', decision: 'approved', decision_humana: 'RUP del 28-sep-2026 leído en el original.' },
    { actorId: ACTOR, now: new Date('2026-10-27T15:00:00Z') },
  );
  assert.equal(entryId, 'rup');
  assert.equal(payload.human_review_status, 'approved');
  assert.equal(payload.existence_status, 'verified');
  assert.equal(payload.decision_humana_fecha, '2026-10-27');
  assert.equal(payload.decision_humana_por, ACTOR);
  assert.match(payload.estado_posterior_decision, /Aprobado/);
});

test('rechazar no promueve la existencia a verificada', () => {
  const { payload } = cleanCompanyEvidenceDecision(
    { entry_id: 'overtime_authorization', decision: 'rejected', decision_humana: 'No se localizó autorización vigente.' },
    { actorId: ACTOR },
  );
  assert.equal(payload.human_review_status, 'rejected');
  assert.equal(payload.existence_status, 'not_verified');
});

test('la decisión nunca escribe aplicabilidad ni vigencia para habilitación', () => {
  const { payload } = cleanCompanyEvidenceDecision(
    { entry_id: 'rup', decision: 'approved', decision_humana: 'x', applicability_status: 'applicable', vigente_para_habilitacion: true, notes: 'intento' },
    { actorId: ACTOR },
  );
  assert.deepEqual(Object.keys(payload).sort(), DECISION_COLUMNS.slice().sort());
  assert.deepEqual(COMPANY_EVIDENCE_DECISION_COLUMNS.slice().sort(), DECISION_COLUMNS.slice().sort());
});

test('158 abre la escritura por columna y deja cerrado el resto de la fila', async () => {
  const pg = await database();
  for (const column of DECISION_COLUMNS) {
    assert.equal(await columnPriv(pg, column), true, `service_role debe poder actualizar ${column}`);
  }
  for (const column of COLUMNS_THAT_STAY_CLOSED) {
    assert.equal(await columnPriv(pg, column), false, `${column} debe seguir cerrada a service_role`);
  }
  const { rows } = await pg.query(`
    select has_table_privilege('service_role', '${TABLE}', 'INSERT') ins,
           has_table_privilege('service_role', '${TABLE}', 'DELETE') del
  `);
  assert.equal(rows[0].ins, false, 'la tabla sigue sin INSERT: la siembra es de la migración');
  assert.equal(rows[0].del, false, 'la tabla sigue sin DELETE');
  await pg.close();
});

test('una decisión registrada nombra a quien la tomó', async () => {
  const pg = await database();
  const base = (extra = '') => `
    insert into ${TABLE} (entry_id, version, document_class, classification, estado_integracion, sensibilidad,
      source_reference, zona_almacenamiento, utilidad_decisional, accion_humana, human_gate, control_de_uso,
      metadata_only, vigente_para_habilitacion, vigencia_text ${extra ? ', ' + extra.split('=')[0] : ''})
    values ('ficha', 1, 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', true, true, 'x' ${extra ? ", " + extra.split('=')[1] : ''})
  `;
  await assert.rejects(
    pg.query(base("decision_humana='texto sin autor'")),
    /decision_autor_chk/,
    'no se puede registrar una decisión sin decir quién la tomó',
  );
  await pg.exec(base());
  await pg.exec(`update ${TABLE} set human_review_status='approved', existence_status='verified',
    decision_humana='Original verificado', decision_humana_fecha='2026-10-27', decision_humana_por='${ACTOR}'
    where entry_id='ficha'`);
  const { rows } = await pg.query(`select human_review_status h, existence_status e, decision_humana_por a from ${TABLE} where entry_id='ficha'`);
  assert.equal(rows[0].h, 'approved');
  assert.equal(rows[0].e, 'verified');
  assert.equal(rows[0].a, ACTOR);
  await pg.close();
});

// La primera versión puso el cuadro de texto dentro de la columna "Revisión", que es la más
// angosta de la tabla: el formulario se salía de la tabla y obligaba a desplazarla en horizontal.
// Además usaba clases que no existían en la hoja de estilos, así que se veía en crudo.
const seccion = read(new URL('../src/tenders/components/CompanyBaseSections.tsx', import.meta.url), 'utf8');
const hoja = read(new URL('../src/styles.css', import.meta.url), 'utf8');

test('el formulario de decisión va en una fila a todo el ancho, no en la celda angosta', () => {
  assert.match(seccion, /className="company-review-row"[\s\S]{0,160}colSpan=\{5\}[\s\S]{0,120}CompanyReviewForm/,
    'el formulario debe ir en su propia fila con colSpan sobre las cinco columnas');
  const celda = seccion.slice(seccion.indexOf('className="company-review-cell"'), seccion.indexOf('company-review-row'));
  assert.doesNotMatch(celda, /<textarea/, 'la celda de Revisión no puede contener el cuadro de texto');
});

test('toda clase company-review-* usada tiene estilo en la hoja', () => {
  const usadas = [...new Set([...seccion.matchAll(/company-review-[a-z-]+/g)].map(match => match[0]))];
  assert.ok(usadas.length >= 3, 'debe haber al menos la celda, la fila y el formulario');
  for (const clase of usadas) {
    assert.ok(hoja.includes(`.${clase}`), `falta el estilo de .${clase}: sin él la pantalla se ve en crudo`);
  }
});

test('el cuadro de texto está acotado y no empuja la tabla', () => {
  const bloque = hoja.slice(hoja.indexOf('.company-review-form{'), hoja.indexOf('.company-base-pair'));
  assert.match(bloque, /\.company-review-form\{[^}]*max-width:/, 'el formulario debe tener ancho máximo');
  assert.match(bloque, /\.company-review-form textarea\{[^}]*width:100%/, 'el cuadro de texto se ajusta a su contenedor');
  assert.match(bloque, /\.company-review-form textarea\{[^}]*resize:vertical/, 'sólo se puede estirar hacia abajo, no a lo ancho');
});
