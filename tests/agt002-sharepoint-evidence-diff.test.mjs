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
  agt002SharepointEvidenceDifferences,
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
  const camara = differences.find(item => item.entryId === 'chamber_of_commerce');
  assert.equal(camara?.code, 'sharepoint_tiene_algo_mas_nuevo', 'hay soporte cargado: la diferencia es de fecha, no de ausencia');
  assert.ok(!differences.some(item => item.entryId === 'chamber_of_commerce' && item.code === 'existe_en_sharepoint_y_no_en_el_crm'));
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
  assert.deepEqual(differences, [], 'el RUP cargado es del 2026-09-28: no hay nada más nuevo');
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
