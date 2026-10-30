// AGT-002 — el paquete de la oferta (punto 3 del encargo del 2026-10-30). Fija: las doce carpetas siempre, cada
// documento en la carpeta que le toca, el índice que dice primero lo que FALTA, y que nada se presente como aprobado
// si nadie lo confirmó.
import test from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import {
  TENDER_OFFER_PACKAGE_FOLDERS,
  TENDER_OFFER_PACKAGE_INDEX_NAME,
  TENDER_OFFER_PACKAGE_MATRIX_NAME,
  buildTenderOfferPackageManifest,
  tenderOfferPackageFileName,
  tenderOfferPackageIndex,
} from '../verticales/licitaciones/tender-offer-package.js';
import { zipStore } from '../verticales/licitaciones/zip-store.js';
import { buildTenderCompanyDocumentBridge } from '../verticales/licitaciones/tender-company-document-bridge.js';

const NOW = new Date('2026-10-30T15:30:00.000Z');
const CLOSE = '2026-11-04';

// Datos reales de Terminal, leídos de producción el 2026-10-30.
const REGISTRY = [
  { entry_id: 'rce_policy', vigencia_text: 'Póliza 2026-02-06 a 2027-02-06', expiry: '2027-02-06', human_review_status: 'approved', existence_status: 'verified' },
  { entry_id: 'chamber_of_commerce', vigencia_text: 'No vence por sí mismo', expiry: null, human_review_status: 'pending_human_review', existence_status: 'reported' },
  { entry_id: 'quality_certifications', vigencia_text: 'BASC vence 2027-06-17', expiry: '2027-06-17', human_review_status: 'pending_human_review', existence_status: 'reported' },
  { entry_id: 'accredited_experience', vigencia_text: 'Sin caducidad general', expiry: null, human_review_status: 'pending_human_review', existence_status: 'reported' },
];
const DOCUMENTS = [
  { id: 'doc-rce', document_type: 'rce_policy', display_name: 'Póliza RCE 2026.zip', issued_at: '2026-02-10', expires_at: '2027-02-06', current: true, version: 1 },
  { id: 'doc-cc', document_type: 'certificado', display_name: '2026-10-06_existencia-representacion_CCPereira.pdf', issued_at: '2026-10-06', expires_at: null, current: true, version: 1 },
];
const bridge = buildTenderCompanyDocumentBridge({ registry: REGISTRY, documents: DOCUMENTS, closeDate: CLOSE, now: NOW });

const DOSSIER = [
  { id: 'exp-pliego', name: 'PLIEGO DE CONDICIONES DEFINITIVO TT-SPO-07-2026.pdf', document_type: 'pliego', origin: 'entidad' },
  { id: 'exp-adenda', name: 'ADENDA No. 02 TT-SPO-07-2026.pdf', document_type: 'adenda', origin: 'entidad' },
];
const MATRIX = { summary: { total: 19, requisitos_abiertos: 12, causas_de_rechazo: 1 } };

const manifest = buildTenderOfferPackageManifest({
  opportunity: { id: '6ca7043f-ec54-4938-8674-1696403123bd', company_name: 'TERMINAL DE TRANSPORTE S.A' },
  tenderRef: 'TT-SPO-07-2026',
  closeDate: CLOSE,
  bridge,
  dossierDocuments: DOSSIER,
  matrix: MATRIX,
  now: NOW,
});

test('las doce carpetas van siempre, en su orden', () => {
  assert.deepEqual(manifest.folders, [...TENDER_OFFER_PACKAGE_FOLDERS]);
  assert.equal(manifest.folders.length, 12);
  assert.equal(manifest.folders[0], '00_Control');
  assert.equal(manifest.folders[11], '11_Presentado');
});

test('cada documento cae en la carpeta que le toca', () => {
  const porRuta = Object.fromEntries(manifest.files.map(file => [file.path, file]));
  assert.ok(porRuta['01_Documentos_Oficiales/PLIEGO DE CONDICIONES DEFINITIVO TT-SPO-07-2026.pdf']);
  assert.ok(porRuta['01_Documentos_Oficiales/ADENDA No. 02 TT-SPO-07-2026.pdf']);
  // La carpeta del documento corporativo sale del catálogo del puente, no se inventa aquí.
  assert.ok(porRuta['07_Polizas/Póliza RCE 2026.zip']);
  assert.ok(porRuta['02_Juridico/2026-10-06_existencia-representacion_CCPereira.pdf']);
  assert.equal(manifest.summary.del_expediente, 2);
  assert.equal(manifest.summary.de_empresa, 2);
});

test('el índice y la matriz son del paquete, en Control', () => {
  assert.deepEqual(manifest.generated, [TENDER_OFFER_PACKAGE_INDEX_NAME, TENDER_OFFER_PACKAGE_MATRIX_NAME]);
  assert.ok(TENDER_OFFER_PACKAGE_INDEX_NAME.startsWith('00_Control/'));
  assert.ok(TENDER_OFFER_PACKAGE_MATRIX_NAME.endsWith('.csv'));
});

test('lo confirmado y lo pendiente se distinguen, y `null` no es `false`', () => {
  const rce = manifest.files.find(file => file.block === 'rce_policy');
  const camara = manifest.files.find(file => file.block === 'chamber_of_commerce');
  assert.equal(rce.confirmed, true, 'la póliza RCE tiene su bloque aprobado');
  assert.equal(camara.confirmed, false, 'la Cámara de Comercio sigue pendiente de confirmación');
  // Los del expediente no tienen bloque que confirmar: ni true ni false.
  assert.equal(manifest.files.find(file => file.kind === 'expediente').confirmed, null);
  assert.equal(manifest.summary.sin_confirmar, 1);
});

test('el índice dice primero lo que falta, con su dueño', () => {
  const index = tenderOfferPackageIndex(manifest);
  assert.match(index, /material de preparación, no una oferta radicada/);
  assert.ok(index.indexOf('## Lo que falta') < index.indexOf('## Contenido'), 'lo que falta va antes del contenido');
  assert.match(index, /Certificaciones de calidad \(BASC e ISO\).*responsable: Licitaciones.*hecho inscrito/);
  assert.match(index, /Experiencia acreditada.*responsable: Licitaciones/);
  assert.equal(manifest.summary.bloques_sin_archivo, manifest.missing_blocks.length);
  assert.ok(manifest.missing_blocks.length >= 2);
  // Los requisitos del pliego entran en el encabezado para que el índice no mienta por omisión.
  assert.match(index, /Requisitos del pliego: 19, de los cuales 12 siguen abiertos y 1 causan rechazo/);
  // Y cada documento de empresa lleva su estado al cierre y si el bloque está confirmado.
  assert.match(index, /Póliza RCE 2026\.zip — Póliza de responsabilidad civil extracontractual · vence 2027-02-06 · 267 días de expedido al cierre · bloque confirmado/);
  assert.match(index, /existencia-representacion_CCPereira\.pdf — Certificado de Cámara de Comercio · sin vencimiento declarado · 29 días de expedido al cierre · bloque pendiente de confirmación/);
});

test('las carpetas vacías se declaran vacías en el índice', () => {
  const index = tenderOfferPackageIndex(manifest);
  assert.match(index, /### 06_Economico\n\n_Vacía\._/);
  assert.match(index, /### 11_Presentado\n\n_Vacía\._/);
});

test('un nombre de archivo imposible se vuelve posible sin perder tildes', () => {
  assert.equal(tenderOfferPackageFileName('Póliza/RCE:2026?.pdf'), 'Póliza-RCE-2026-.pdf');
  assert.equal(tenderOfferPackageFileName('   '), 'documento');
  assert.equal(tenderOfferPackageFileName('x'.repeat(200)).length, 150);
});

test('dos documentos con el mismo nombre en la misma carpeta no se pisan', () => {
  const repetido = buildTenderOfferPackageManifest({
    dossierDocuments: [
      { id: 'a', name: 'Anexo.pdf' },
      { id: 'b', name: 'Anexo.pdf' },
      { id: 'c', name: 'Anexo.pdf' },
    ],
    now: NOW,
  });
  assert.deepEqual(repetido.files.map(file => file.path), [
    '01_Documentos_Oficiales/Anexo.pdf',
    '01_Documentos_Oficiales/Anexo (2).pdf',
    '01_Documentos_Oficiales/Anexo (3).pdf',
  ]);
});

test('el paquete completo se abre con una librería real, con sus doce carpetas', () => {
  const index = tenderOfferPackageIndex(manifest);
  const zip = zipStore({
    folders: manifest.folders,
    entries: [
      { name: TENDER_OFFER_PACKAGE_INDEX_NAME, content: index },
      { name: TENDER_OFFER_PACKAGE_MATRIX_NAME, content: '﻿Área;Requisito\r\nJurídico;RUP\r\n' },
      ...manifest.files.map(file => ({ name: file.path, content: `bytes de ${file.document_id}` })),
    ],
    now: NOW,
  });
  const read = new AdmZip(Buffer.from(zip));
  const names = read.getEntries().map(entry => entry.entryName);
  for (const folder of TENDER_OFFER_PACKAGE_FOLDERS) assert.ok(names.includes(`${folder}/`), `falta la carpeta ${folder}`);
  assert.match(read.readAsText(TENDER_OFFER_PACKAGE_INDEX_NAME), /Paquete de la oferta — TERMINAL DE TRANSPORTE S\.A/);
  assert.ok(read.readAsText(TENDER_OFFER_PACKAGE_MATRIX_NAME).startsWith('﻿'), 'la matriz conserva su BOM');
  assert.equal(read.readAsText('07_Polizas/Póliza RCE 2026.zip'), 'bytes de doc-rce');
  assert.equal(names.length, 12 + 2 + manifest.files.length);
});

test('sin nada cargado el paquete existe, con sus carpetas y su índice honesto', () => {
  const vacio = buildTenderOfferPackageManifest({ bridge: null, dossierDocuments: [], matrix: null, now: NOW });
  assert.equal(vacio.summary.total_files, 0);
  assert.equal(vacio.summary.requisitos, null);
  const index = tenderOfferPackageIndex(vacio);
  assert.match(index, /Ningún bloque de la ficha de empresa está sin soporte/);
  assert.doesNotMatch(index, /Requisitos del pliego/);
  assert.equal(vacio.folders.length, 12);
});
