// AGT-002 — el puente ficha de empresa → expediente (encargo del 2026-10-30). Fija lo que la encargada no puede
// equivocarse al leer: qué está listo el día del cierre, qué se reexpide, qué es un hecho que ningún trámite cambia,
// qué falta y de quién es. Los datos de las fixtures son los reales de producción leídos el 2026-10-30, para que lo
// que aquí pasa sea lo que ella verá.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TENDER_COMPANY_DOCUMENT_CLASSES,
  buildTenderCompanyDocumentBridge,
  companyDocumentAgeAtClose,
  tenderCompanyDocumentClassForType,
} from '../verticales/licitaciones/tender-company-document-bridge.js';

const NOW = new Date('2026-10-30T12:00:00.000Z');
// Cierre de la Terminal de Transporte después de la Adenda 2.
const CLOSE = '2026-11-04';

// Registro de evidencia vigente, tal como lo devuelve psi_agt002_company_evidence_registry (sólo las columnas que
// la pantalla de Empresa expone).
const REGISTRY = [
  { entry_id: 'rup', document_class: 'Registro Único de Proponentes (RUP)', existence_status: 'reported', human_review_status: 'pending_human_review', vigencia_text: 'Expedido 2026-06-17; el uso contractual exige certificado reciente según pliego', expiry: null },
  { entry_id: 'rce_policy', document_class: 'Póliza de responsabilidad civil extracontractual', existence_status: 'verified', human_review_status: 'approved', vigencia_text: 'Póliza observada: 2026-02-06 a 2027-02-06', expiry: '2027-02-06' },
  { entry_id: 'collective_life_policy', document_class: 'Póliza de seguro de vida colectivo', existence_status: 'reported', human_review_status: 'pending_human_review', vigencia_text: 'Renovación 2026-2027', expiry: null },
  { entry_id: 'corporate_background_checks', document_class: 'Antecedentes de la persona jurídica', existence_status: 'reported', human_review_status: 'pending_human_review', vigencia_text: 'Tres consultas fechadas 2026-06-01; ventana observada de 89 días hasta 2026-08-29', expiry: '2026-08-29' },
  { entry_id: 'supervigilancia_operating_license', document_class: 'Licencia de funcionamiento SuperVigilancia', existence_status: 'reported', human_review_status: 'pending_human_review', vigencia_text: 'Resolución 20214100005697; vigencia observada hasta 2029-05-10', expiry: '2029-05-10' },
  { entry_id: 'accredited_experience', document_class: 'Experiencia acreditada', existence_status: 'reported', human_review_status: 'pending_human_review', vigencia_text: 'Sin caducidad general', expiry: null },
  { entry_id: 'financial_and_tax_pack', document_class: 'Estados financieros', existence_status: 'not_verified', human_review_status: 'pending_human_review', vigencia_text: 'Corte 2025; pack incompleto', expiry: null },
  { entry_id: 'overtime_authorization', document_class: 'Autorización de horas extras', existence_status: 'not_verified', human_review_status: 'pending_human_review', vigencia_text: 'Vigencia no confirmada', expiry: null },
];

// Los 7 documentos corporativos vigentes de producción.
const DOCUMENTS = [
  { id: 'doc-cc-2', document_type: 'certificado', display_name: '15_CAMARA_COMERCIO_SEGURIDAD_NACIONAL_2026-09-01.pdf', issued_at: '2026-09-01', expires_at: null, current: true, version: 2, storage_path: 'company-profile/documents/x/cc2.pdf' },
  { id: 'doc-cc-1', document_type: 'certificado', display_name: '2026-10-06_existencia-representacion_CCPereira.pdf', issued_at: '2026-10-06', expires_at: null, current: true, version: 1, storage_path: 'company-profile/documents/x/cc1.pdf' },
  { id: 'doc-vida', document_type: 'collective_life_policy', display_name: 'Póliza colectiva de vida vigilantes 2026-2027.pdf', issued_at: '2026-05-26', expires_at: '2027-05-26', current: true, version: 1 },
  { id: 'doc-medidas', document_type: 'medidas_correctivas_empresa', display_name: '06_Medidas_Correctivas_Empresa_2026-10-17.pdf', issued_at: '2026-10-17', expires_at: null, current: true, version: 1 },
  { id: 'doc-proc', document_type: 'procuraduria_empresa', display_name: '05_Procuraduria_Empresa_2026-10-17.pdf', issued_at: '2026-10-17', expires_at: null, current: true, version: 1 },
  { id: 'doc-rce', document_type: 'rce_policy', display_name: 'Póliza RCE expediente Pereira 2026.zip', issued_at: '2026-02-10', expires_at: '2027-02-06', current: true, version: 1 },
  { id: 'doc-rup', document_type: 'rup', display_name: '20_RUP_2026-09-28_VIGENTE_EN_FIRME.pdf', issued_at: '2026-09-28', expires_at: null, current: true, version: 1 },
];

const bridge = buildTenderCompanyDocumentBridge({ registry: REGISTRY, documents: DOCUMENTS, closeDate: CLOSE, now: NOW });
const rowOf = key => bridge.rows.find(row => row.key === key);

test('una fila por clase canónica, con dueño, carpeta y clase declaradas', () => {
  assert.equal(bridge.rows.length, TENDER_COMPANY_DOCUMENT_CLASSES.length);
  assert.equal(bridge.close_date, CLOSE);
  for (const row of bridge.rows) {
    assert.ok(row.owner, `${row.key} sin dueño`);
    assert.match(row.folder, /^\d\d_/);
    assert.ok(['tramite', 'hecho_inscrito', 'mixto'].includes(row.kind), `${row.key}: ${row.kind}`);
    assert.ok(row.kind_label);
  }
});

test('la póliza que pasa del cierre queda lista; la vigencia sale del documento', () => {
  const rce = rowOf('rce_policy');
  assert.equal(rce.state, 'listo_al_cierre');
  assert.equal(rce.expires_at, '2027-02-06');
  assert.equal(rce.expiry_source, 'documento');
  assert.equal(rce.document.id, 'doc-rce');
  assert.equal(rce.action, null, 'lo que está listo no pide ninguna acción');
});

test('una póliza que vence antes del cierre se reexpide, y lo dice con el dueño', () => {
  const corto = buildTenderCompanyDocumentBridge({
    registry: REGISTRY,
    documents: DOCUMENTS.map(document => (document.id === 'doc-rce' ? { ...document, expires_at: '2026-11-01' } : document)),
    closeDate: CLOSE,
    now: NOW,
  });
  const rce = corto.rows.find(row => row.key === 'rce_policy');
  assert.equal(rce.state, 'vence_antes_del_cierre');
  assert.match(rce.action, /Reexpedir antes del cierre: lo tramita Jurídico/);
});

test('un hecho inscrito que no llega al cierre no se ofrece como trámite', () => {
  const experiencia = rowOf('accredited_experience');
  assert.equal(experiencia.state, 'sin_archivo');
  assert.equal(experiencia.kind, 'hecho_inscrito');
  assert.match(experiencia.action, /verificar el hecho que registra/);
  assert.doesNotMatch(experiencia.action, /[Rr]eexpedir/);
});

test('sin archivo cargado la fila sale faltante y con su dueño, nunca vigente', () => {
  const bancaria = rowOf('bank_certificate');
  assert.equal(bancaria.document, null);
  assert.equal(bancaria.state, 'sin_archivo');
  assert.match(bancaria.action, /lo pide Contabilidad/);
  assert.equal(bancaria.expires_at, null);
});

test('sin fecha de vencimiento declarada la vigencia queda por confirmar, con la prosa del registro a la vista', () => {
  const rup = rowOf('rup');
  assert.equal(rup.state, 'vigencia_por_confirmar');
  assert.equal(rup.expiry_source, null);
  assert.match(rup.vigencia_text, /exige certificado reciente según pliego/);
  assert.match(rup.action, /confirma la vigencia contra el pliego/);
  assert.equal(rup.kind, 'mixto', 'el RUP es trámite y hecho inscrito a la vez');
});

test('la licencia de SuperVigilancia toma su vencimiento del registro cuando no hay archivo cargado', () => {
  const licencia = rowOf('supervigilancia_operating_license');
  assert.equal(licencia.document, null);
  // Sin archivo manda el faltante: la fecha del registro no convierte un hueco en documento listo.
  assert.equal(licencia.state, 'sin_archivo');
  assert.equal(licencia.expires_at, '2029-05-10');
  assert.equal(licencia.expiry_source, 'registro_de_evidencia');
});

test('una carga más nueva que la ventana del registro no se declara vencida', () => {
  // Antecedentes: el registro observó una ventana hasta el 2026-08-29 y el 2026-10-17 se cargaron dos consultas.
  const antecedentes = rowOf('corporate_background_checks');
  // Dos consultas del mismo día acreditan la clase: las dos viajan y el desempate es determinístico por id.
  assert.deepEqual(antecedentes.supporting_documents.map(document => document.id), ['doc-medidas', 'doc-proc']);
  assert.equal(antecedentes.document.id, 'doc-medidas');
  assert.equal(antecedentes.state, 'vigencia_por_confirmar');
  assert.equal(antecedentes.expiry_source, null);
  // Y si no hubiera carga nueva, la ventana del registro sí vence.
  const sinCarga = buildTenderCompanyDocumentBridge({
    registry: REGISTRY,
    documents: DOCUMENTS.map(document => (['doc-proc', 'doc-medidas'].includes(document.id) ? { ...document, issued_at: '2026-06-01' } : document)),
    closeDate: CLOSE,
    now: NOW,
  });
  assert.equal(sinCarga.rows.find(row => row.key === 'corporate_background_checks').state, 'vencido');
});

test('los tipos legados siguen acreditando su clase, y gana el documento más reciente', () => {
  assert.equal(tenderCompanyDocumentClassForType('certificado'), 'chamber_of_commerce');
  assert.equal(tenderCompanyDocumentClassForType('procuraduria_empresa'), 'corporate_background_checks');
  assert.equal(tenderCompanyDocumentClassForType('inventado'), null);
  assert.equal(rowOf('chamber_of_commerce').document.id, 'doc-cc-1', 'el del 2026-10-06, no el del 2026-09-01');
  assert.deepEqual(rowOf('chamber_of_commerce').supporting_documents.map(document => document.id), ['doc-cc-1', 'doc-cc-2']);
});

test('la cuenta que ningún tablero tenía: la edad del papel el día del cierre', () => {
  assert.equal(companyDocumentAgeAtClose('2026-10-06', '2026-11-04'), 29);
  assert.equal(companyDocumentAgeAtClose(null, '2026-11-04'), null);
  assert.equal(companyDocumentAgeAtClose('2026-10-06', null), null);
  const camara = rowOf('chamber_of_commerce');
  assert.equal(camara.age_at_close_days, 29);
  assert.match(camara.age_note, /Al cierre tendrá 29 días de expedido/);
  assert.equal(camara.days_to_close, 5, 'del 2026-10-30 al cierre');
  // El RUP del 2026-09-28 tendrá 37 días: con un pliego que pida 30 no sirve, y eso se lee sin calcular nada.
  assert.equal(rowOf('rup').age_at_close_days, 37);
});

test('el resumen separa el trámite del hecho inscrito', () => {
  assert.equal(bridge.summary.total, bridge.rows.length);
  const suma = bridge.summary.listo_al_cierre + bridge.summary.vence_antes_del_cierre + bridge.summary.vencido
    + bridge.summary.vigencia_por_confirmar + bridge.summary.sin_archivo + bridge.summary.sin_fecha_de_cierre;
  assert.equal(suma, bridge.rows.length, 'cada fila cae en exactamente un estado');
  assert.ok(bridge.summary.hechos_inscritos_en_riesgo > 0);
  assert.ok(bridge.summary.tramites_por_hacer > 0);
  const enRiesgo = bridge.rows.filter(row => row.kind !== 'tramite' && ['sin_archivo', 'vencido', 'vence_antes_del_cierre'].includes(row.state));
  assert.equal(bridge.summary.hechos_inscritos_en_riesgo, enRiesgo.length);
});

test('sin fecha de cierre no se contrasta nada y se dice', () => {
  const sinCierre = buildTenderCompanyDocumentBridge({ registry: REGISTRY, documents: DOCUMENTS, closeDate: null, now: NOW });
  assert.equal(sinCierre.close_date, null);
  const rce = sinCierre.rows.find(row => row.key === 'rce_policy');
  assert.equal(rce.state, 'sin_fecha_de_cierre');
  assert.match(rce.action, /no tiene fecha de cierre declarada/);
  assert.equal(rce.age_at_close_days, null);
});

test('nada se esconde: documentos sin clase y huecos del catálogo se reportan', () => {
  const conExtra = buildTenderCompanyDocumentBridge({
    registry: REGISTRY,
    documents: [...DOCUMENTS, { id: 'doc-x', document_type: 'otro', display_name: 'Acta interna.pdf', issued_at: '2026-10-01', expires_at: null, current: true, version: 1 }],
    closeDate: CLOSE,
    now: NOW,
  });
  assert.deepEqual(conExtra.unmatched_documents.map(document => document.id), ['doc-x']);
  // Desde la migración 166 ninguna clase vive fuera del registro: la Cámara de Comercio ya tiene su bloque.
  assert.deepEqual(bridge.gaps.filter(gap => gap.kind === 'clase_fuera_del_registro'), []);
  // Y las clases cuyo bloque no está en esta ficha de prueba se declaran, en vez de desaparecer de la lista.
  assert.ok(bridge.gaps.some(gap => gap.kind === 'clase_sin_registro' && gap.key === 'chamber_of_commerce'));
  assert.ok(bridge.gaps.some(gap => gap.kind === 'clase_sin_registro' && gap.key === 'quality_certifications'));
  // Y una clase cuyo registro no está vigente también se declara, en vez de desaparecer de la lista.
  assert.ok(bridge.gaps.some(gap => gap.kind === 'clase_sin_registro' && gap.key === 'rut'));
});

test('un documento que ya no es el vigente no acredita nada', () => {
  const soloViejo = buildTenderCompanyDocumentBridge({
    registry: REGISTRY,
    documents: [{ ...DOCUMENTS[6], current: false }],
    closeDate: CLOSE,
    now: NOW,
  });
  assert.equal(soloViejo.rows.find(row => row.key === 'rup').document, null);
});
