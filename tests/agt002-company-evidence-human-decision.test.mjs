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
  // El ancla al documento (159) no sale de la entrada del usuario: la resuelve el guardado
  // consultando cuál es el documento vigente del bloque, por eso va en la lista y no en el payload.
  assert.deepEqual(COMPANY_EVIDENCE_DECISION_COLUMNS.slice().sort(),
    [...DECISION_COLUMNS, 'decision_support_document_id'].sort());
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

// A1/A3 (plan del 2026-10-27): el segundo reloj y la acción siempre presente.
// Antes el estado salía sólo de `expiry`, así que un documento con expedición y sin vencimiento
// caía en "falta o sin verificar" — el caso del RUP, con su "Ver soporte" al lado.
const { deriveCompanyBlock, readIssuedFromText } = await import('../src/tenders/companyBase.ts')
  .catch(() => ({ deriveCompanyBlock: null, readIssuedFromText: null }));

test('la fecha de expedición se lee del texto del registro, sin exigir plazo', { skip: !readIssuedFromText }, () => {
  assert.equal(readIssuedFromText('Expedido 2026-06-17; el uso contractual exige certificado reciente'), '2026-06-17');
  assert.equal(readIssuedFromText('Expedida 2026-06-22; vigencia práctica dependiente del pliego'), '2026-06-22');
  assert.equal(readIssuedFromText('Sin caducidad general'), null);
});

test('un documento sin vencimiento envejece, no falta', { skip: !deriveCompanyBlock }, () => {
  const ahora = new Date('2026-10-27T00:00:00Z');
  const entrada = { entry_id: 'rup', document_class: 'RUP', existence_status: 'reported', human_review_status: 'pending_human_review', vigencia_text: 'Expedido 2026-06-17; el uso contractual exige certificado reciente' };
  const conDocumento = deriveCompanyBlock(entrada, [{ current: true, document_type: 'rup', issued_at: '2026-09-28', expires_at: null, url: 'x' }], ahora);
  assert.equal(conDocumento.state, 'al_dia', 'con soporte cargado deja de ser "falta o sin verificar"');
  assert.equal(conDocumento.issuedAt, '2026-09-28');
  assert.equal(conDocumento.issuedSource, 'documento', 'la fecha del documento manda sobre el texto del registro');
  assert.equal(conDocumento.daysSinceIssued, 29);

  const sinDocumento = deriveCompanyBlock(entrada, [], ahora);
  assert.equal(sinDocumento.state, 'al_dia', 'la expedición del registro también cuenta como hecho conocido');
  assert.equal(sinDocumento.issuedSource, 'registro');

  const vacia = deriveCompanyBlock({ ...entrada, vigencia_text: 'Sin datos' }, [], ahora);
  assert.equal(vacia.state, 'sin_verificar', 'sin documento y sin fecha sí es "falta"');
  assert.equal(vacia.issuedAt, null);
});

test('con vencimiento se cuentan los días que faltan', { skip: !deriveCompanyBlock }, () => {
  const ahora = new Date('2026-10-27T00:00:00Z');
  const bloque = deriveCompanyBlock(
    { entry_id: 'rce_policy', document_class: 'RCE', existence_status: 'reported', human_review_status: 'approved', vigencia_text: 'Póliza observada', expiry: '2027-02-06' },
    [], ahora,
  );
  assert.equal(bloque.daysToExpiry, 102);
  assert.equal(bloque.state, 'al_dia');
});

// A4 (plan del 2026-10-27): el estado sale de quién cargó, atado a la versión del documento.
const { recordUploadAsVerification, COMPANY_EVIDENCE_DECISION_COLUMNS: COLUMNAS } = await import('../company-base.js');
const { summarizeCompanyBlocks } = await import('../src/tenders/companyBase.ts');

test('la decisión se amarra al documento: una versión nueva no hereda la aprobación', () => {
  const ahora = new Date('2026-10-27T00:00:00Z');
  const base = { entry_id: 'rce_policy', document_class: 'RCE', existence_status: 'verified', human_review_status: 'approved', vigencia_text: 'Póliza', expiry: '2027-02-06' };
  const docViejo = { current: true, document_type: 'rce_policy', issued_at: '2026-02-06', expires_at: '2027-02-06', id: 'doc-viejo', url: 'x' };
  const docNuevo = { ...docViejo, id: 'doc-nuevo' };

  const alDia = deriveCompanyBlock({ ...base, decision_support_document_id: 'doc-viejo' }, [docViejo], ahora);
  assert.equal(alDia.review, 'Aprobado');

  const trasRenovar = deriveCompanyBlock({ ...base, decision_support_document_id: 'doc-viejo' }, [docNuevo], ahora);
  assert.equal(trasRenovar.review, 'Falta confirmar', 'la póliza nueva no hereda la aprobación de la vieja');
  assert.equal(trasRenovar.reviewPending, true);
});

test('un documento que nadie confirmó se distingue de un bloque que nadie miró', () => {
  const ahora = new Date('2026-10-27T00:00:00Z');
  const entrada = { entry_id: 'rut', document_class: 'RUT', existence_status: 'reported', human_review_status: 'pending_human_review', vigencia_text: 'Edición 2026' };
  const conDoc = deriveCompanyBlock(entrada, [{ current: true, document_type: 'rut', id: 'doc-1', url: 'x' }], ahora);
  assert.equal(conDoc.review, 'Falta confirmar', 'hay papel pero nadie lo confirmó');
  const sinDoc = deriveCompanyBlock(entrada, [], ahora);
  assert.equal(sinDoc.review, 'Pendiente', 'no hay papel: nadie lo ha mirado');
});

test('el resumen no cuenta como revisado lo que falta confirmar', () => {
  const ahora = new Date('2026-10-27T00:00:00Z');
  const bloques = [
    deriveCompanyBlock({ entry_id: 'a', document_class: 'A', existence_status: 'verified', human_review_status: 'approved', vigencia_text: 'x', decision_support_document_id: 'd1' }, [{ current: true, document_type: 'a', id: 'd1' }], ahora),
    deriveCompanyBlock({ entry_id: 'b', document_class: 'B', existence_status: 'verified', human_review_status: 'approved', vigencia_text: 'x', decision_support_document_id: 'd1' }, [{ current: true, document_type: 'b', id: 'd2' }], ahora),
  ];
  assert.deepEqual(bloques.map(b => b.review), ['Aprobado', 'Falta confirmar']);
  assert.equal(summarizeCompanyBlocks(bloques).reviewed, 1);
});

test('cargar un soporte no escribe decisión sin ficha, documento o autor', async () => {
  const sinEscribir = { from: () => { throw new Error('no debió tocar la base'); } };
  assert.equal(await recordUploadAsVerification(sinEscribir, { entryId: '', documentId: 'd', actorId: 'a' }), null);
  assert.equal(await recordUploadAsVerification(sinEscribir, { entryId: 'rup', documentId: '', actorId: 'a' }), null);
  assert.equal(await recordUploadAsVerification(sinEscribir, { entryId: 'rup', documentId: 'd', actorId: '' }), null);
  assert.ok(COLUMNAS.includes('decision_support_document_id'), 'la columna del ancla entra en las que la decisión escribe');
});

test('si escribir la verificación falla, la carga no se pierde', async () => {
  const baseQueRompe = { from: () => ({ update: () => { throw new Error('sin permiso'); } }) };
  assert.equal(await recordUploadAsVerification(baseQueRompe, { entryId: 'rup', documentId: 'd1', actorId: 'a1' }), null,
    'devuelve null en vez de propagar: el documento ya quedó registrado y el bloque dirá "falta confirmar"');
});

// Desplegar y migrar son dos actos: la pantalla no se cae si la 159 aún no corrió.
test('sin la columna de la 159, la base empresarial se carga igual', async () => {
  const { loadCompanyBase, COMPANY_BASE_REGISTRY_SELECT } = await import('../company-base.js');
  const pedidos = [];
  const baseVieja = {
    from: tabla => ({
      select(select) {
        if (tabla === 'psi_agt002_company_evidence_registry') pedidos.push(select);
        const resultado = tabla !== 'psi_agt002_company_evidence_registry'
          ? { data: [], error: null }
          : select.includes('decision_support_document_id')
            ? { data: null, error: { code: '42703', message: 'column does not exist' } }
            : { data: [{ entry_id: 'rup' }], error: null };
        const encadenable = { eq: () => encadenable, order: () => encadenable, then: (ok) => Promise.resolve(resultado).then(ok) };
        return encadenable;
      },
    }),
  };
  const base = await loadCompanyBase(baseVieja);
  assert.equal(pedidos.length, 2, 'reintenta una sola vez, sin la columna nueva');
  assert.ok(pedidos[0].includes('decision_support_document_id'));
  assert.ok(!pedidos[1].includes('decision_support_document_id'));
  assert.deepEqual(base.registry, [{ entry_id: 'rup' }], 'los bloques se muestran como antes');
  assert.ok(COMPANY_BASE_REGISTRY_SELECT.includes('decision_support_document_id'));
});

test('una aprobación que no nombra su documento pide confirmación, no dice "Aprobado"', () => {
  const ahora = new Date('2026-10-30T00:00:00Z');
  // Caso real: la póliza RCE quedó `approved` el 2026-10-27, antes de aplicar la 159, así que su decisión no
  // apunta a ningún documento. La pantalla decía "Aprobado" sobre un documento que nadie puede identificar.
  const sinAncla = deriveCompanyBlock(
    { entry_id: 'rce_policy', document_class: 'RCE', existence_status: 'verified', human_review_status: 'approved', vigencia_text: 'Póliza', expiry: '2027-02-06', decision_support_document_id: null },
    [{ current: true, document_type: 'rce_policy', id: 'doc-rce', issued_at: '2026-02-10', expires_at: '2027-02-06', url: 'x' }],
    ahora,
  );
  assert.equal(sinAncla.review, 'Falta confirmar');
  assert.equal(sinAncla.reviewPending, true);
  // Y un bloque aprobado sin ningún soporte cargado se queda como estaba: no hay nada contra qué confirmar.
  const sinSoporte = deriveCompanyBlock(
    { entry_id: 'rce_policy', document_class: 'RCE', existence_status: 'verified', human_review_status: 'approved', vigencia_text: 'Póliza', expiry: '2027-02-06', decision_support_document_id: null },
    [], ahora,
  );
  assert.equal(sinSoporte.review, 'Aprobado');
});
