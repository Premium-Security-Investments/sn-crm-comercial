// AGT-002 — las diferencias entre SharePoint y el CRM (mejora 1 del encargo del 2026-10-31).
//
// Las rutas y los nombres son los REALES de la biblioteca corporativa, leídos el 2026-11-01 (122
// archivos), y los documentos del CRM son los 8 vigentes de producción. Cuatro de estas pruebas
// existen porque la primera corrida contra esos datos reales destapó cuatro defectos de las reglas
// que habrían salido en pantalla, y una de ellas habría nombrado un archivo del representante legal.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agt002ClassifyLibraryFile,
  agt002SharepointDifferenceLine,
  agt002SharepointDifferenceSummaryLine,
  agt002SharepointEvidenceDifferences,
  runAgt002SharepointEvidenceWatch,
} from '../verticales/licitaciones/agt002-sharepoint-evidence-diff.js';

const ROOT = '06_Productos_PSI/Licitaciones/02_Biblioteca_Corporativa_SN';
const CALIDAD = `${ROOT}/02_Licencias_y_Habilitaciones/CERTIFICACIONES_Y_LICENCIAS_VIGENTES_-_SEGURIDAD_NACIONAL_/CERTIFICACIONES DE CALIDAD SN`;
const VIGENTES = `${ROOT}/02_Licencias_y_Habilitaciones/CERTIFICACIONES_Y_LICENCIAS_VIGENTES_-_SEGURIDAD_NACIONAL_`;
const ANTECEDENTES = `${ROOT}/01_Legal_y_Societario/Antecedentes Actualizados`;

const REGISTRY = [
  { entry_id: 'quality_certifications', document_class: 'Certificaciones de calidad', current: true },
  { entry_id: 'agency_authorizations', document_class: 'Autorizaciones de agencia por ciudad', current: true },
  { entry_id: 'supervigilancia_operating_license', document_class: 'Licencia de funcionamiento SuperVigilancia', current: true },
  { entry_id: 'chamber_of_commerce', document_class: 'Cámara de Comercio', current: true },
  { entry_id: 'rup', document_class: 'Registro Único de Proponentes (RUP)', current: true },
  { entry_id: 'financial_and_tax_pack', document_class: 'Estados financieros', current: true },
  { entry_id: 'corporate_background_checks', document_class: 'Antecedentes y consultas de la persona jurídica', current: true },
  { entry_id: 'legal_representative_vault', document_class: 'Documentos y antecedentes de representantes legales', current: true },
];
// Los 8 documentos vigentes de producción, con la Cámara bajo el tipo legado `certificado`.
const DOCUMENTS = [
  { document_type: 'certificado', display_name: '2026-10-06_existencia-representacion_CCPereira.pdf', issued_at: '2026-10-06', current: true },
  { document_type: 'certificado', display_name: '15_CAMARA_COMERCIO_2026-09-01.pdf', issued_at: '2026-09-01', current: true },
  { document_type: 'rup', display_name: '20_RUP_2026-09-28_VIGENTE_EN_FIRME.pdf', issued_at: '2026-09-28', current: true },
  { document_type: 'supervigilancia_operating_license', display_name: 'Licencia de funcionamiento', issued_at: '2021-02-11', current: true },
];

// --- Los cuatro defectos que destapó la corrida real ------------------------------------------

test('la basura del sistema de archivos no es evidencia', () => {
  // La primera corrida anunció «.DS_Store» como la versión más nueva de la licencia de
  // funcionamiento. Un informe que dice eso deja de leerse.
  for (const junk of ['.DS_Store', '~$PLANTILLA.docx', 'Thumbs.db', 'desktop.ini']) {
    const klass = agt002ClassifyLibraryFile(`${VIGENTES}/${junk}`);
    assert.equal(klass.disposition, 'excluded_non_evidence', `${junk} no puede ser evidencia`);
  }
});

test('el patrón se prueba contra el nombre, no contra la ruta', () => {
  // La carpeta se llama «03_RUP_y_Capacidad_Financiera», así que probando la ruta el certificado del
  // RUP se clasificaba como estado financiero.
  const klass = agt002ClassifyLibraryFile(`${ROOT}/03_RUP_y_Capacidad_Financiera/Vigente/20_RUP_SEGURIDAD_NACIONAL_2026-09-28_VIGENTE_EN_FIRME.pdf`);
  assert.equal(klass.entryId, 'rup');
});

test('un antecedente del representante legal va a su bóveda y nunca se nombra', () => {
  // Los paquetes reales se llaman «ANTECEDENTES DISCIPLINARIOS RL SEGUNAL 2_09_2026.pdf», con
  // espacios. Con el patrón anterior caían en el bloque de la empresa y el informe nombraba el
  // archivo, que es lo que el §6 del encargo prohíbe.
  const rl = agt002ClassifyLibraryFile(`${ANTECEDENTES}/ANTECEDENTES DISCIPLINARIOS RL SEGUNAL 2_09_2026.pdf`);
  assert.equal(rl.entryId, 'legal_representative_vault');
  assert.equal(rl.personal, true);

  const empresa = agt002ClassifyLibraryFile(`${ANTECEDENTES}/ANTECEDENTES FISCALES SEGUNAL.pdf`);
  assert.equal(empresa.entryId, 'corporate_background_checks');
  assert.equal(empresa.personal, false);

  const differences = agt002SharepointEvidenceDifferences({
    files: [{ ruta: `${ANTECEDENTES}/ANTECEDENTES DISCIPLINARIOS RL SEGUNAL 2_09_2026.pdf`, modificado_en: '2026-10-17T12:00:00Z' }],
    registry: REGISTRY, documents: [],
  });
  const aviso = differences.find(item => item.entryId === 'legal_representative_vault');
  assert.equal(aviso.newestName, null, 'de una clase personal no viaja el nombre del archivo');
  const linea = agt002SharepointDifferenceLine(aviso);
  assert.doesNotMatch(linea, /DISCIPLINARIOS|SEGUNAL/, 'la línea tampoco lo nombra');
  assert.match(linea, /4 archivo|1 archivo/, 'pero sí dice cuántos hay');
});

test('un tipo legado acredita su clase: la Cámara de Comercio no está vacía', () => {
  // Está cargada dos veces bajo el tipo legado `certificado`. Sin resolver el alias, el puente
  // reportaba «el CRM no tiene ningún documento», que es falso.
  const differences = agt002SharepointEvidenceDifferences({
    files: [{ ruta: `${ROOT}/01_Legal_y_Societario/Documentos_Corporativos/15_CAMARA_COMERCIO.pdf`, modificado_en: '2026-10-20T12:00:00Z' }],
    registry: REGISTRY, documents: DOCUMENTS,
  });
  // Con el alias resuelto el bloque tiene soporte, así que NO hay diferencia de presencia. Y ya no
  // hay diferencia de fecha: esa regla se retiró por producir falsos positivos (ver abajo).
  assert.ok(!differences.some(item => item.entryId === 'chamber_of_commerce'),
    'un bloque con soporte cargado bajo tipo legado no produce ninguna diferencia');
});

// --- Las reglas donde la señal es la carpeta --------------------------------------------------

test('la carpeta de calidad manda sobre el nombre, y no hay comodín que absorba lo que no calce', () => {
  // «IQNET 18788.pdf» y «PACTO GLOBAL…» no dicen CALIDAD ni ISO, pero viven en la carpeta de
  // certificaciones de calidad. Con la regla por nombre, IQNET se reportaba como licencia.
  for (const name of ['IQNET 18788.pdf', 'PACTO GLOBAL O SOSTENIBILIDAD.pdf', 'SELLO DE SOSTENIBILIDAD PLATINO SEGURIDAD NACIONAL 2024.pdf', 'BASC 2026.pdf', 'ISO 9001.pdf']) {
    assert.equal(agt002ClassifyLibraryFile(`${CALIDAD}/${name}`).entryId, 'quality_certifications', name);
  }
  // La licencia de funcionamiento sigue siendo la licencia.
  assert.equal(agt002ClassifyLibraryFile(`${VIGENTES}/LICENCIA DE FUNCIONAMIENTO SEGURIDAD NACIONAL.pdf`).entryId, 'supervigilancia_operating_license');
  // Y lo que ninguna regla ubica NO se adivina: sale sin clasificar y se reporta.
  const raro = agt002ClassifyLibraryFile(`${VIGENTES}/UN_PAPEL_QUE_NADIE_DECLARO.pdf`);
  assert.equal(raro.entryId, null);
  assert.equal(raro.classified, false);
});

test('las resoluciones de agencia se nombran por ciudad, como en el registro', () => {
  // El registro declara resolución propia para Bogotá, Medellín y Cali; los archivos se llaman por
  // la ciudad y no por la palabra «agencia».
  for (const name of ['Licencia Agencia Cali.pdf', 'Licencia Agencia Medellin.pdf', 'Resolucion Licencia Bogota 2020.pdf']) {
    assert.equal(agt002ClassifyLibraryFile(`${VIGENTES}/${name}`).entryId, 'agency_authorizations', name);
  }
});

// --- Las diferencias ---------------------------------------------------------------------------

test('un bloque con archivos en SharePoint y sin documento en el CRM es la diferencia que más vale', () => {
  const differences = agt002SharepointEvidenceDifferences({
    files: [
      { ruta: `${CALIDAD}/BASC 2026.pdf`, modificado_en: '2026-10-29T12:00:00Z' },
      { ruta: `${CALIDAD}/ISO 9001.pdf`, modificado_en: '2026-10-29T12:00:00Z' },
    ],
    registry: REGISTRY, documents: DOCUMENTS,
  });
  const calidad = differences.find(item => item.entryId === 'quality_certifications');
  assert.equal(calidad.code, 'existe_en_sharepoint_y_no_en_el_crm');
  assert.equal(calidad.severity, 'alta');
  assert.equal(calidad.count, 2);
  assert.equal(calidad.newest, '2026-10-29');
  assert.match(agt002SharepointDifferenceLine(calidad), /antes de tramitarlo de nuevo/i);
});

test('un archivo sin regla se reporta como hueco de las reglas, no se descarta en silencio', () => {
  const differences = agt002SharepointEvidenceDifferences({
    files: [{ ruta: `${ROOT}/01_Legal_y_Societario/00_CONTROL_ANTECEDENTES_MENSUALES.md`, modificado_en: '2026-10-17T12:00:00Z' }],
    registry: REGISTRY, documents: [],
  });
  const hueco = differences.find(item => item.code === 'sin_clasificar');
  assert.ok(hueco, 'un archivo de evidencia que nadie ubica se dice');
  assert.match(agt002SharepointDifferenceLine(hueco), /hueco de las reglas del puente, no de la ficha/);
});

test('una biblioteca que calza con el CRM no produce diferencias', () => {
  const differences = agt002SharepointEvidenceDifferences({
    files: [{ ruta: `${ROOT}/03_RUP_y_Capacidad_Financiera/Vigente/20_RUP_2026-09-28.pdf`, modificado_en: '2026-09-28T12:00:00Z' }],
    registry: REGISTRY, documents: DOCUMENTS,
  });
  assert.deepEqual(differences, [], 'el RUP está cargado: el bloque no tiene hueco de presencia');
});

test('el puente NO avisa por antigüedad: una fecha de modificación no es una fecha de documento', () => {
  // El caso real que lo probó: el archivo que SharePoint tenía "más nuevo" (modificado el
  // 2026-10-17) es el MISMO documento que el CRM ya tiene cargado con `issued_at` 2026-09-28 —se
  // llama igual—. Comparar `lastModifiedDateTime` contra `issued_at` dio cuatro falsos positivos de
  // cuatro. SharePoint no expone la fecha del documento, sólo la del archivo.
  const differences = agt002SharepointEvidenceDifferences({
    files: [{ ruta: `${ROOT}/03_RUP_y_Capacidad_Financiera/Vigente/20_RUP_SEGURIDAD_NACIONAL_2026-09-28_VIGENTE_EN_FIRME.pdf`, modificado_en: '2026-10-17T12:00:00Z' }],
    registry: REGISTRY, documents: DOCUMENTS,
  });
  assert.deepEqual(differences, [], 'tocar un archivo en SharePoint no lo vuelve un documento nuevo');
  for (const code of differences.map(item => item.code)) {
    assert.notEqual(code, 'sharepoint_tiene_algo_mas_nuevo');
  }
});

test('no se afirma nada sobre vigencia ni se marca evidencia como verificada', () => {
  const differences = agt002SharepointEvidenceDifferences({
    files: [{ ruta: `${CALIDAD}/BASC 2026.pdf`, modificado_en: '2026-10-29T12:00:00Z' }],
    registry: REGISTRY, documents: [],
  });
  for (const difference of differences) {
    const linea = agt002SharepointDifferenceLine(difference);
    assert.doesNotMatch(linea, /vigente al cierre|aprobad|verificad/i, `el puente no decide evidencia: ${linea}`);
  }
});

// --- La revisión programada: una sola línea por expediente ------------------------------------

// Dos bloques con archivos en SharePoint y nada cargado en el CRM, más el RUP que SÍ está cargado y
// por tanto no produce diferencia. Ya no se usa el RUP como "más nuevo": esa regla se retiró.
const FILES = [
  { ruta: `${CALIDAD}/BASC 2026.pdf`, modificado_en: '2026-10-29T12:00:00Z' },
  { ruta: `${CALIDAD}/ISO 9001.pdf`, modificado_en: '2026-10-29T12:00:00Z' },
  { ruta: `${VIGENTES}/Licencia Agencia Cali.pdf`, modificado_en: '2026-10-29T12:00:00Z' },
  { ruta: `${ROOT}/03_RUP_y_Capacidad_Financiera/Vigente/20_RUP_2026-09-28.pdf`, modificado_en: '2026-10-17T12:00:00Z' },
];

function fakeDatabase({ registry = REGISTRY, documents = DOCUMENTS, tenders = [{ id: 't1', ref: 'TT-SPO-07-2026', converted_opportunity_id: 'opp-1', internal_status: 'convertida_oportunidad' }, { id: 't2', ref: 'SNS-LP-2-2026', converted_opportunity_id: 'opp-2', internal_status: 'convertida_oportunidad' }] } = {}) {
  return {
    from(table) {
      const rows = table === 'psi_agt002_company_evidence_registry' ? registry
        : table === 'psi_company_procurement_documents' ? documents
        : tenders;
      const builder = { select: () => builder, eq: () => builder, limit: () => Promise.resolve({ data: rows, error: null }) };
      builder.then = resolve => resolve({ data: rows, error: null });
      return builder;
    },
  };
}

test('una sola línea por expediente, no una por diferencia', () => {
  const differences = agt002SharepointEvidenceDifferences({ files: FILES, registry: REGISTRY, documents: DOCUMENTS });
  assert.ok(differences.length >= 2, 'hay varias diferencias');
  const line = agt002SharepointDifferenceSummaryLine(differences);
  assert.equal(typeof line, 'string');
  assert.match(line, /Certificaciones de calidad/);
  assert.match(line, /Autorizaciones de agencia/);
  assert.doesNotMatch(line, /Registro Único de Proponentes/, 'el RUP está cargado: no es una diferencia');
  assert.match(line, /revisar lo que ya existe/);
  assert.doesNotMatch(line, /más nuevo que lo cargado/, 'la regla de antigüedad se retiró');
  // 15 diferencias en 8 expedientes serían 120 líneas: por eso es una.
  assert.equal(line.split('\n').length, 1);
});

test('sin diferencias de documentos no hay línea, aunque haya huecos de reglas', () => {
  const soloHueco = agt002SharepointEvidenceDifferences({
    files: [{ ruta: `${ROOT}/01_Legal_y_Societario/00_CONTROL.md`, modificado_en: '2026-10-17T12:00:00Z' }],
    registry: REGISTRY, documents: DOCUMENTS,
  });
  assert.ok(soloHueco.some(item => item.code === 'sin_clasificar'));
  assert.equal(agt002SharepointDifferenceSummaryLine(soloHueco), null,
    'un hueco de las reglas no justifica molestar en cada expediente');
});

test('la revisión deja la misma línea en cada expediente abierto', async () => {
  const lines = [];
  const events = await runAgt002SharepointEvidenceWatch(fakeDatabase(), {
    files: FILES, appendLine: async (_db, opportunityId, line) => { lines.push({ opportunityId, line }); },
  });
  assert.deepEqual(lines.map(entry => entry.opportunityId), ['opp-1', 'opp-2']);
  assert.equal(new Set(lines.map(entry => entry.line)).size, 1, 'es un hecho de la empresa: la misma línea');
  assert.ok(events.some(event => event.event === 'agt002_sharepoint_watch_difference'));
  assert.equal(events.filter(event => event.event === 'agt002_sharepoint_watch_notice').length, 2);
});

test('un SharePoint que no se pudo leer NO es un SharePoint vacío', async () => {
  // Tratarlo así reportaría que a todos los bloques les falta todo: la peor falsa alarma posible.
  const lines = [];
  const logged = [];
  const events = await runAgt002SharepointEvidenceWatch(fakeDatabase(), {
    files: [], log: event => logged.push(event.event), appendLine: async (_db, _id, line) => { lines.push(line); },
  });
  assert.deepEqual(lines, []);
  assert.deepEqual(events, []);
  assert.ok(logged.includes('agt002_sharepoint_watch_sin_listado'));
});

test('una oportunidad inactiva se salta, y una que falla no corta las demás', async () => {
  const lines = [];
  const events = await runAgt002SharepointEvidenceWatch(fakeDatabase(), {
    files: FILES,
    inactiveReason: async (_db, opportunityId) => opportunityId === 'opp-1',
    appendLine: async (_db, opportunityId, line) => { lines.push({ opportunityId, line }); },
  });
  assert.deepEqual(lines.map(entry => entry.opportunityId), ['opp-2']);

  const otros = [];
  const conFallo = await runAgt002SharepointEvidenceWatch(fakeDatabase(), {
    files: FILES,
    appendLine: async (_db, opportunityId, line) => {
      if (opportunityId === 'opp-1') throw new Error('escritura rota');
      otros.push(opportunityId);
    },
  });
  assert.ok(conFallo.some(event => event.event === 'agt002_sharepoint_watch_failed'));
  assert.deepEqual(otros, ['opp-2']);
});
