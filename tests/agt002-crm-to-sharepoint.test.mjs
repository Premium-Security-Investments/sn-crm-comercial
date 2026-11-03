// AGT-002 — el sentido CRM -> SharePoint del puente (mejora 1, autorizado por Juan el 2026-11-02).
//
// Los datos son los REALES de Terminal leídos el 2026-11-02: la carpeta del proceso con sus
// subcarpetas curadas, y los documentos del CRM con sus duplicados y su `storage_path` con el bucket
// adentro. Dos de estas pruebas existen por trampas que ya se pagaron una vez.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGT002_CRM_TO_SHAREPOINT_FOLDER,
  agt002CrmToSharepointLine,
  agt002ContentHashFromStoragePath,
  agt002CrmToSharepointPlan,
  agt002MapTendersToProcessFolders,
  agt002ProcessFolderForRef,
  agt002StorageObjectPaths,
} from '../verticales/licitaciones/agt002-crm-to-sharepoint.js';

const PROCESOS = [
  'FISCALÍA GENERAL DE LA NACIÓN REGIONAL EJE CAFETERO - FGN-REC-IPSE-005',
  'Medicina legal',
  'MUNICIPIO DE PEREIRA- OFICIAL',
  'SUPERINTENDENCIA NACIONAL DE SALUD',
  'TERMINAL DE TRANSPORTE S.A. - TT-SPO-07-2026',
  'Valor+ — Registro de Proveedores — Seguridad Nacional',
];
const RAIZ = '06_Productos_PSI/Licitaciones/03_Procesos_Activos/TERMINAL DE TRANSPORTE S.A. - TT-SPO-07-2026';
const EN_SHAREPOINT = [
  { ruta: `${RAIZ}/01_Pliegos/Adenda No. 1 TT-SPO-07-2026.pdf` },
  { ruta: `${RAIZ}/01_Pliegos/Pliego definitivo.pdf` },
  { ruta: `${RAIZ}/02_Respuestas_observaciones/GJC-FT24 RESPUESTA OBSERVACIONES.pdf` },
];

test('la carpeta del proceso se resuelve por la referencia dentro del nombre', () => {
  assert.equal(agt002ProcessFolderForRef(PROCESOS, 'TT-SPO-07-2026'), 'TERMINAL DE TRANSPORTE S.A. - TT-SPO-07-2026');
  // Un proceso cuya carpeta no exista no se inventa: crear carpetas es de quien organiza el expediente.
  assert.equal(agt002ProcessFolderForRef(PROCESOS, 'LP-999-2026'), null);
  assert.equal(agt002ProcessFolderForRef(PROCESOS, ''), null);
});

test('un documento que ya está archivado en el proceso no se vuelve a subir', () => {
  // Está en 01_Pliegos, no en 99_Del_CRM, y aun así cuenta: se compara en cualquier subcarpeta.
  const plan = agt002CrmToSharepointPlan({
    crmDocuments: [{ name: 'Adenda No. 1 TT-SPO-07-2026.pdf', storage_path: 'tender-documents/x/y-adenda.pdf' }],
    sharepointFiles: EN_SHAREPOINT,
  });
  assert.deepEqual(plan, []);
});

test('los duplicados del CRM se suben una sola vez', () => {
  // Caso real: la «ADENDA No. 02» de Terminal está dos veces, una de `secop ii` y otra de
  // `carga manual`, con el mismo contenido. Sin deduplicar el informe mentiría.
  const plan = agt002CrmToSharepointPlan({
    crmDocuments: [
      { name: 'ADENDA No. 02 TT-SPO-07-2026.pdf', storage_path: 'tender-documents/x/a-adenda2.pdf', source: 'secop ii' },
      { name: 'ADENDA No. 02 TT-SPO-07-2026.pdf', storage_path: 'tender-documents/x/manual-adenda2.pdf', source: 'carga manual' },
    ],
    sharepointFiles: [],
  });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].source, 'secop ii', 'se queda el primero');
});

test('el nombre se compara sin importar espacios ni mayúsculas', () => {
  const plan = agt002CrmToSharepointPlan({
    crmDocuments: [{ name: 'adenda no. 1   TT-SPO-07-2026.PDF', storage_path: 'tender-documents/x/y.pdf' }],
    sharepointFiles: EN_SHAREPOINT,
  });
  assert.deepEqual(plan, [], 'SharePoint y el CRM no coinciden en espacios ni en mayúsculas');
});

test('un documento que falta sí entra al plan, con su ruta y su tipo', () => {
  const plan = agt002CrmToSharepointPlan({
    crmDocuments: [{ name: '29_10_2026.pdf', storage_path: 'tender-documents/6ca7043f/manual-abc/def-29_10_2026.pdf', mime_type: 'application/pdf', size_bytes: 82557, source: 'carga manual' }],
    sharepointFiles: EN_SHAREPOINT,
  });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].name, '29_10_2026.pdf');
  assert.equal(plan[0].mimeType, 'application/pdf');
  assert.equal(plan[0].sizeBytes, 82557);
});

test('un documento sin nombre o sin ruta se descarta, no se sube a ciegas', () => {
  const plan = agt002CrmToSharepointPlan({
    crmDocuments: [{ name: '', storage_path: 'tender-documents/x/y.pdf' }, { name: 'x.pdf', storage_path: '' }],
    sharepointFiles: [],
  });
  assert.deepEqual(plan, []);
});

test('se prueban las dos rutas del objeto, y primero la completa', () => {
  // La trampa documentada: el nombre del objeto YA incluye el prefijo del bucket, así que al cliente
  // hay que darle la ruta completa. Yo la entendí al revés en la primera versión y las 13 descargas
  // de la primera corrida real fallaron. Nada se subió —el fallo es ruidoso— pero se perdió una
  // corrida. Ahora se prueban las dos, la documentada primero.
  assert.deepEqual(
    agt002StorageObjectPaths('tender-documents/6ca7043f/manual-abc/def-29_10_2026.pdf'),
    ['tender-documents/6ca7043f/manual-abc/def-29_10_2026.pdf', '6ca7043f/manual-abc/def-29_10_2026.pdf'],
  );
  // Sin prefijo no hay alternativa que probar.
  assert.deepEqual(agt002StorageObjectPaths('6ca7043f/x.pdf'), ['6ca7043f/x.pdf']);
  assert.deepEqual(agt002StorageObjectPaths('/tender-documents/a/b.pdf'), ['tender-documents/a/b.pdf', 'a/b.pdf']);
  assert.deepEqual(agt002StorageObjectPaths(''), []);
});

test('todo va a una carpeta aparte, nunca a la estructura curada del expediente', () => {
  assert.equal(AGT002_CRM_TO_SHAREPOINT_FOLDER, '99_Del_CRM');
  const line = agt002CrmToSharepointLine({ ref: 'TT-SPO-07-2026', folder: 'TERMINAL …', uploaded: 3, skipped: 12 });
  assert.match(line, /99_Del_CRM/);
  assert.match(line, /decisión de una persona/);
  assert.match(line, /12 ya estaban/);
  // Sin nada subido ni fallado no se escribe línea.
  assert.equal(agt002CrmToSharepointLine({ ref: 'x', folder: 'y', uploaded: 0, skipped: 29 }), null);
});

// --- Emparejar licitación con carpeta: la primera versión encontró 1 de 18 --------------------
//
// Las carpetas no se nombran de forma sistemática. Datos reales del 2026-11-03.

const TENDERS = [
  { id: 't-terminal', ref: 'TT-SPO-07-2026', entity: 'TERMINAL DE TRANSPORTE S.A' },
  { id: 't-salud', ref: 'SNS-LP-2-2026', entity: 'SUPERINTENDENCIA NACIONAL DE SALUD' },
  { id: 't-pereira', ref: 'SMGA-LP-220-2026', entity: 'MUNICIPIO DE PEREIRA- OFICIAL' },
  { id: 't-fiscalia', ref: 'FGN-REC-IPSE-0058-2026', entity: 'FISCALÍA GENERAL DE LA NACIÓN REGIONAL EJE CAFETERO' },
  { id: 't-rama-1', ref: 'LP-01-2026', entity: 'Rama Judicial  Dirección Seccional de Administración Judicial de Pereira' },
  { id: 't-rama-2', ref: 'LP-01-2026', entity: 'Rama Judicial  Dirección Seccional de Administración Judicial de Manizales' },
  { id: 't-dane', ref: 'LP-001-2026', entity: 'DEPARTAMENTO ADMINISTRATIVO NACIONAL DE ESTADISTICA (DANE)' },
];

test('empareja por referencia cuando la carpeta la trae', () => {
  const map = agt002MapTendersToProcessFolders(PROCESOS, TENDERS);
  assert.equal(map.get('t-terminal').folder, 'TERMINAL DE TRANSPORTE S.A. - TT-SPO-07-2026');
  assert.equal(map.get('t-terminal').reason, 'referencia');
});

test('empareja por entidad cuando la carpeta no trae la referencia', () => {
  // El caso que la primera versión perdía: Supersalud tiene carpeta y no la encontraba.
  const map = agt002MapTendersToProcessFolders(PROCESOS, TENDERS);
  assert.equal(map.get('t-salud').folder, 'SUPERINTENDENCIA NACIONAL DE SALUD');
  assert.equal(map.get('t-salud').reason, 'entidad');
  assert.equal(map.get('t-pereira').folder, 'MUNICIPIO DE PEREIRA- OFICIAL');
  // Y con acentos y puntuación de por medio.
  assert.equal(map.get('t-fiscalia').folder, 'FISCALÍA GENERAL DE LA NACIÓN REGIONAL EJE CAFETERO - FGN-REC-IPSE-005');
});

test('dos licitaciones de la MISMA entidad no se mezclan en una carpeta', () => {
  // El freno que importa, y hay que probarlo con el caso que de verdad lo dispara: dos licitaciones
  // con la misma entidad y una carpeta que la contiene. Sin el freno, las dos apuntarían a esa
  // carpeta y se mezclarían documentos de procesos distintos. Un documento mal archivado en el
  // expediente de otro proceso es peor que un documento sin archivar.
  const entity = 'Rama Judicial Direccion Seccional de Pereira';
  const folders = [...PROCESOS, `${entity} - expediente`];
  const map = agt002MapTendersToProcessFolders(folders, [
    { id: 'r1', ref: 'LP-01-2026', entity },
    { id: 'r2', ref: 'SA-24-2026', entity },
  ]);
  assert.equal(map.get('r1').reason, 'carpeta_ambigua');
  assert.equal(map.get('r2').reason, 'carpeta_ambigua');
  assert.equal(map.get('r1').folder, null);
  assert.equal(map.get('r2').folder, null);

  // Y una sola licitación con esa misma entidad SÍ empareja: el freno es la ambigüedad, no la entidad.
  const sola = agt002MapTendersToProcessFolders(folders, [{ id: 'r1', ref: 'LP-01-2026', entity }]);
  assert.equal(sola.get('r1').folder, `${entity} - expediente`);
  assert.equal(sola.get('r1').reason, 'entidad');
});

test('las cuatro de la Rama Judicial con una carpeta genérica no emparejan con nada', () => {
  // Caso real: la carpeta se llamaría «Rama Judicial», más corta que la entidad completa, así que no
  // la contiene y no hay pareja. Sale `sin_carpeta`, que es el resultado seguro.
  const map = agt002MapTendersToProcessFolders([...PROCESOS, 'Rama Judicial'], TENDERS);
  assert.equal(map.get('t-rama-1').folder, null);
  assert.equal(map.get('t-rama-1').reason, 'sin_carpeta');
  assert.equal(map.get('t-rama-2').folder, null);
});

test('una licitación sin carpeta sale con su motivo y no se le inventa una', () => {
  const map = agt002MapTendersToProcessFolders(PROCESOS, TENDERS);
  assert.equal(map.get('t-dane').folder, null);
  assert.equal(map.get('t-dane').reason, 'sin_carpeta');
});

test('una carpeta ya tomada por referencia no se le ofrece a otra licitación por entidad', () => {
  const map = agt002MapTendersToProcessFolders(PROCESOS, [
    ...TENDERS,
    { id: 't-otro-terminal', ref: 'XX-999', entity: 'TERMINAL DE TRANSPORTE S.A' },
  ]);
  assert.equal(map.get('t-terminal').folder, 'TERMINAL DE TRANSPORTE S.A. - TT-SPO-07-2026');
  assert.equal(map.get('t-otro-terminal').folder, null, 'la carpeta ya tiene dueño por referencia');
});

// --- El mismo documento con el nombre corrompido de dos formas --------------------------------

test('el hash del contenido sale de la ruta del almacenamiento', () => {
  assert.equal(
    agt002ContentHashFromStoragePath('tender-documents/x/manual-abc/c4eb1e2a4f2487e87f2e22ecdf869d45c8c3ae667b0dfade387494dc49315bc7-Certificado.pdf'),
    'c4eb1e2a4f2487e87f2e22ecdf869d45c8c3ae667b0dfade387494dc49315bc7',
  );
  assert.equal(agt002ContentHashFromStoragePath('tender-documents/x/sin-hash.pdf'), null);
  assert.equal(agt002ContentHashFromStoragePath(''), null);
});

test('el mismo contenido con dos nombres corrompidos se sube UNA vez', () => {
  // Caso real de Supersalud: el CRM guarda el mismo acto administrativo dos veces, con el acento
  // dañado de dos formas distintas. Las dos de 231 KB. Deduplicar por nombre no las ve; por
  // contenido sí, porque la ruta lleva el sha256 del archivo.
  const hash = 'a'.repeat(64);
  const plan = agt002CrmToSharepointPlan({
    crmDocuments: [
      { name: 'Resolucio_n de apertura.pdf', storage_path: `tender-documents/x/secop/${hash}-Resolucion.pdf`, size_bytes: 231000 },
      { name: 'Resoluci_n de apertura.pdf', storage_path: `tender-documents/x/manual/${hash}-Resolucion.pdf`, size_bytes: 231000 },
    ],
    sharepointFiles: [],
  });
  assert.equal(plan.length, 1, 'un documento, una subida');
  assert.equal(plan[0].name, 'Resolucio_n de apertura.pdf', 'se queda el primero');
});

test('dos documentos distintos con nombres parecidos SÍ se suben los dos', () => {
  // El freno no puede volverse una red que se coma documentos de verdad distintos: en Supersalud
  // hay respuestas «al proyecto de pliego» y «al pliego definitivo», y las dos importan.
  const plan = agt002CrmToSharepointPlan({
    crmDocuments: [
      { name: 'Respuestas a observaciones al proyecto de pliego.pdf', storage_path: `tender-documents/x/${'b'.repeat(64)}-r1.pdf` },
      { name: 'Respuestas a observaciones al pliego definitivo.pdf', storage_path: `tender-documents/x/${'c'.repeat(64)}-r2.pdf` },
    ],
    sharepointFiles: [],
  });
  assert.equal(plan.length, 2);
});
