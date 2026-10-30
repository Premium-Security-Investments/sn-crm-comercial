// AGT-002 — la matriz de cumplimiento (punto 2 del encargo del 2026-10-30). Fija el cruce requisito → soporte
// corporativo → estado al cierre → responsable, y las tres cosas que la matriz NO hace: no reevalúa el requisito, no
// afirma que un documento lo acredita, y no esconde el requisito cuyo soporte se produce para este proceso.
//
// Los textos de los requisitos son los reales del análisis canónico de la Terminal de Transporte y de Supersalud,
// leídos de producción el 2026-10-30.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TENDER_COMPLIANCE_MATRIX_HEADERS,
  buildTenderComplianceMatrix,
  matchCompanyDocumentClasses,
  tenderComplianceMatrixTable,
} from '../verticales/licitaciones/tender-compliance-matrix.js';
import { buildTenderCompanyDocumentBridge } from '../verticales/licitaciones/tender-company-document-bridge.js';

const NOW = new Date('2026-10-30T12:00:00.000Z');
const CLOSE = '2026-11-04';

const REGISTRY = [
  { entry_id: 'rce_policy', vigencia_text: 'Póliza observada: 2026-02-06 a 2027-02-06', expiry: '2027-02-06', human_review_status: 'approved', existence_status: 'verified' },
  { entry_id: 'rup', vigencia_text: 'Expedido 2026-06-17', expiry: null, human_review_status: 'pending_human_review', existence_status: 'reported' },
  { entry_id: 'supervigilancia_operating_license', vigencia_text: 'Vigencia observada hasta 2029-05-10', expiry: '2029-05-10', human_review_status: 'pending_human_review', existence_status: 'reported' },
];
const DOCUMENTS = [
  { id: 'doc-cc', document_type: 'certificado', display_name: '2026-10-06_existencia-representacion_CCPereira.pdf', issued_at: '2026-10-06', expires_at: null, current: true, version: 1 },
  { id: 'doc-rce', document_type: 'rce_policy', display_name: 'Póliza RCE 2026.zip', issued_at: '2026-02-10', expires_at: '2027-02-06', current: true, version: 1 },
  { id: 'doc-rup', document_type: 'rup', display_name: '20_RUP_2026-09-28_VIGENTE_EN_FIRME.pdf', issued_at: '2026-09-28', expires_at: null, current: true, version: 1 },
];
const bridge = buildTenderCompanyDocumentBridge({ registry: REGISTRY, documents: DOCUMENTS, closeDate: CLOSE, now: NOW });

// Filas tal como las entrega `buildRequirementRows` sobre el reporte canónico.
const REQUIREMENT_ROWS = [
  {
    key: 'req-camara', area: 'Jurídico', title: 'Certificado de existencia y representación legal',
    demand: 'El pliego exige certificado de la Cámara de Comercio con expedición no mayor a 30 días.',
    actions: ['Revisa solo la fecha de expedición: pedir certificado nuevo a la Cámara de Comercio de Pereira.'],
    sources: [{ documentName: 'Pliego definitivo', locator: 'Numeral 3.1.1' }], status: 'por_confirmar', rejection: true,
  },
  {
    key: 'req-licencia', area: 'Jurídico', title: 'Licencia de funcionamiento con todas las modalidades',
    demand: 'La entidad exige licencia de funcionamiento vigente y las modalidades del servicio.',
    actions: ['Anexar la resolución de prórroga vigente hasta el 10/05/2029 y la que fija las modalidades.'],
    sources: [{ documentName: 'Pliego definitivo', locator: 'Numeral 3.1.4' }], status: 'declarado', rejection: false,
  },
  {
    key: 'req-rce', area: 'Financiero', title: 'Póliza de responsabilidad civil extracontractual',
    demand: 'Se exige responsabilidad civil extracontractual de 400 SMLMV.',
    actions: ['Revisa solo la responsabilidad civil de 400 SMLMV: confirmar valor y renovar antes del 06/02/2027.'],
    sources: [{ documentName: 'Pliego definitivo', locator: 'Numeral 4.2' }], status: 'declarado', rejection: false,
  },
  {
    key: 'req-economico', area: 'Comercial', title: 'Anexo económico diligenciado',
    demand: 'Diligenciar todos los valores unitarios del anexo económico.',
    actions: ['Diligenciar todos los valores unitarios sin ceros, con prima dentro del AIU.'],
    sources: [{ documentName: 'Anexo 5', locator: 'Formato económico' }], status: 'por_confirmar', rejection: false,
  },
  {
    key: 'req-camaras', area: 'Operaciones', title: 'Suministro de 24 cámaras IP de intemperie',
    demand: 'El pliego exige 24 cámaras IP compatibles con el sistema existente.',
    actions: ['Revisa solo los equipos: 24 cámaras IP de intemperie compatibles con el sistema existente.'],
    sources: [{ documentName: 'Anexo técnico', locator: 'Ítem 7' }], status: 'por_confirmar', rejection: false,
  },
];

const matrix = buildTenderComplianceMatrix({ requirementRows: REQUIREMENT_ROWS, bridge });
const rowOf = key => matrix.rows.find(row => row.key === key);

test('una fila por requisito, con el área que responde y la causa de rechazo marcada', () => {
  assert.equal(matrix.rows.length, REQUIREMENT_ROWS.length);
  assert.equal(matrix.close_date, CLOSE);
  assert.equal(rowOf('req-camara').rejection, true);
  assert.equal(rowOf('req-camara').owner, 'Jurídico');
  assert.equal(matrix.summary.causas_de_rechazo, 1);
});

test('el requisito nombra su soporte corporativo y la matriz trae su estado al cierre', () => {
  const rce = rowOf('req-rce');
  assert.deepEqual(rce.company_support.map(item => item.key), ['rce_policy']);
  assert.equal(rce.company_support[0].state, 'listo_al_cierre');
  assert.equal(rce.company_support[0].ready, true);
  assert.equal(rce.company_support[0].document_name, 'Póliza RCE 2026.zip');
  assert.deepEqual(rce.support_pending, []);
});

test('el soporte que no llega al cierre sale pendiente, con su dueño además del área del requisito', () => {
  const licencia = rowOf('req-licencia');
  assert.deepEqual(licencia.company_support.map(item => item.key), ['supervigilancia_operating_license']);
  // No hay archivo cargado de la licencia: el requisito está "declarado" según el análisis, pero el soporte falta.
  assert.equal(licencia.company_support[0].state, 'sin_archivo');
  assert.equal(licencia.company_support[0].ready, false);
  assert.deepEqual(licencia.support_pending, ['supervigilancia_operating_license']);
  assert.deepEqual(licencia.support_owners, ['Jurídico']);
  assert.equal(matrix.summary.soporte_corporativo_pendiente, 1);
});

test('el estado del requisito es el del análisis: la matriz no reevalúa nada', () => {
  // El soporte de la licencia falta y el requisito sigue "declarado", que es lo que dijo el análisis.
  assert.equal(rowOf('req-licencia').status, 'declarado');
  assert.equal(rowOf('req-camara').status, 'por_confirmar');
  assert.equal(matrix.summary.requisitos_abiertos, 3);
});

test('el requisito cuyo soporte se produce para este proceso no queda vacío: lo dice', () => {
  for (const key of ['req-economico', 'req-camaras']) {
    const row = rowOf(key);
    assert.equal(row.support_kind, 'especifico_del_proceso');
    assert.deepEqual(row.company_support, []);
  }
  assert.equal(matrix.summary.especificos_del_proceso, 2);
  assert.equal(matrix.summary.con_soporte_corporativo, 3);
});

test('el cruce reconoce cómo los pliegos nombran cada documento, con tildes o sin ellas', () => {
  assert.deepEqual(matchCompanyDocumentClasses('pedir certificado nuevo a la Cámara de Comercio de Pereira'), ['camara_comercio']);
  assert.deepEqual(matchCompanyDocumentClasses('certificacion de sanciones y multas de la Supervigilancia'), ['no_fines_sanctions_certificate']);
  assert.deepEqual(matchCompanyDocumentClasses('la resolución de prórroga y la que fija las modalidades'), ['supervigilancia_operating_license']);
  assert.deepEqual(matchCompanyDocumentClasses('autorización de uniformes y distintivos'), ['uniforms_resolution']);
  assert.deepEqual(matchCompanyDocumentClasses('licencia de espectro y el registro de comunicaciones'), ['communications_license']);
  // Un requisito puede nombrar varios documentos, y salen todos en el orden del catálogo.
  assert.deepEqual(matchCompanyDocumentClasses('Revisa existencia y representación, RUT, carta de presentación'), ['camara_comercio', 'rut']);
  assert.deepEqual(matchCompanyDocumentClasses('nada que ver con documentos'), []);
});

test('la tabla plana sale con los encabezados en el orden en que se radica', () => {
  const table = tenderComplianceMatrixTable(matrix);
  assert.equal(TENDER_COMPLIANCE_MATRIX_HEADERS.length, 10);
  assert.equal(table.length, matrix.rows.length);
  for (const row of table) assert.equal(row.length, TENDER_COMPLIANCE_MATRIX_HEADERS.length);
  const camara = table[0];
  assert.equal(camara[0], 'Jurídico');
  assert.equal(camara[2], 'Sí', 'la causa de rechazo se lee sin interpretar un booleano');
  assert.equal(camara[4], 'Pliego definitivo · Numeral 3.1.1');
  assert.equal(camara[5], 'Por confirmar');
  assert.equal(camara[6], 'Certificado de Cámara de Comercio');
  assert.equal(camara[7], 'Vigencia por confirmar');
  // El requisito cuyo soporte es del proceso lo dice en la celda, no la deja vacía.
  assert.equal(tenderComplianceMatrixTable(matrix)[3][6], 'Soporte específico de este proceso');
});

test('sin requisitos la matriz existe y está vacía, sin inventar filas', () => {
  const vacia = buildTenderComplianceMatrix({ requirementRows: [], bridge });
  assert.deepEqual(vacia.rows, []);
  assert.equal(vacia.summary.total, 0);
  assert.deepEqual(tenderComplianceMatrixTable(vacia), []);
  assert.deepEqual(buildTenderComplianceMatrix({}).rows, []);
});

test('el CSV lo abre Excel en español: separador de punto y coma, BOM y celdas citadas', async () => {
  const { tenderComplianceMatrixCsv } = await import('../verticales/licitaciones/tender-compliance-matrix.js');
  const csv = tenderComplianceMatrixCsv(TENDER_COMPLIANCE_MATRIX_HEADERS, tenderComplianceMatrixTable(matrix));
  assert.ok(csv.startsWith('﻿'), 'sin BOM las tildes salen rotas');
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines.length, matrix.rows.length + 1);
  assert.ok(lines[0].includes('Área;Requisito;Causa de rechazo'));
  // Una celda con punto y coma adentro se cita, para que no parta la fila.
  const conPuntoYComa = tenderComplianceMatrixCsv(['a'], [['uno; dos']], { bom: false });
  assert.equal(conPuntoYComa, 'a\r\n"uno; dos"\r\n');
  // Un salto de línea dentro de una celda no puede partir la fila.
  assert.equal(tenderComplianceMatrixCsv(['a'], [['uno\ndos']], { bom: false }), 'a\r\nuno dos\r\n');
});
