// AGT-002 — la matriz de cumplimiento, generada de verdad (punto 2 del encargo del 2026-10-30).
//
// Vig-IA ya produce, por licitación, los requisitos del pliego con su evaluación, su acción y su fuente
// (`buildRequirementRows` sobre el reporte del análisis canónico). Y el puente de la ficha de empresa ya dice qué
// documento corporativo existe y si llega vigente al cierre. La matriz es el cruce: **una fila por requisito, con el
// documento que lo acredita, su estado el día del cierre y de quién es lo que falta**.
//
// Es a la vez lo que la entidad pide y el tablero de la encargada, que era justo lo que el encargo pedía que fuera.
//
// Tres cosas que este módulo no hace:
//
//   - **No decide.** El estado del requisito es el que dio el análisis; aquí no se reevalúa nada.
//   - **No afirma que un documento acredita un requisito.** El cruce se hace por palabras declaradas abajo, así que
//     lo que sale es un soporte corporativo **relacionado**, y quien arma la oferta lo confirma. Decir "acreditado"
//     por una coincidencia de palabras sería inventar.
//   - **No esconde lo que no cruza.** Un requisito sin documento corporativo relacionado no es un error: casi siempre
//     su soporte se produce para ESE proceso (certificaciones de experiencia, anexo económico, hojas de vida). La
//     fila lo dice así, en vez de quedar vacía.
//
// Módulo puro: sin red, sin base de datos, sin express.

import { TENDER_COMPANY_DOCUMENT_CLASSES } from './tender-company-document-bridge.js';

/**
 * Palabras con las que un requisito del pliego nombra un documento corporativo. Salen de los textos reales de los
 * análisis de las tres licitaciones vivas (leídos el 2026-10-30), no de la imaginación: "pedir certificado nuevo a la
 * Cámara de Comercio", "la certificación de sanciones y multas de la Supervigilancia", "la resolución de prórroga
 * vigente hasta el 10/05/2029 y la que fija las modalidades", "licencia de espectro", "uniformes y distintivos".
 *
 * Un requisito puede nombrar varios ("Revisa existencia y representación, RUT, carta de presentación…"), así que el
 * cruce devuelve todos los que aparezcan. Las frases más específicas conviven con las generales a propósito: cada una
 * apunta a su clase y no compiten.
 */
export const TENDER_COMPLIANCE_DOCUMENT_HINTS = Object.freeze({
  camara_comercio: ['camara de comercio', 'existencia y representacion', 'certificado de existencia'],
  rup: ['rup', 'registro unico de proponentes'],
  rut: ['rut', 'registro unico tributario'],
  supervigilancia_operating_license: ['licencia de funcionamiento', 'modalidades', 'prorroga', 'agencia de bogota', 'agencia de medellin', 'agencia de cali'],
  uniforms_resolution: ['uniformes', 'distintivos'],
  communications_license: ['espectro', 'comunicaciones', 'registro tic'],
  no_fines_sanctions_certificate: ['sanciones', 'multas'],
  corporate_background_checks: ['antecedentes', 'procuraduria', 'contraloria', 'medidas correctivas', 'policia nacional', 'boletin de responsables'],
  financial_and_tax_pack: ['estados financieros', 'declaracion de renta', 'indicadores financieros', 'capital de trabajo', 'cifras del certificado'],
  bank_certificate: ['certificacion bancaria', 'certificado bancario'],
  rce_policy: ['responsabilidad civil'],
  collective_life_policy: ['vida colectivo', 'seguro de vida', 'poliza de vida'],
  authorized_weapons_list: ['armas', 'municiones'],
  // 'smlmv' quedó FUERA a propósito: la prueba lo pilló cruzando la póliza de responsabilidad civil "de 400 SMLMV"
  // con la experiencia acreditada. La unidad aparece en valores de todo tipo y no nombra un documento.
  accredited_experience: ['experiencia', 'certificaciones de contratos', 'contratos terminados'],
  personnel_credentials_vault: ['hojas de vida', 'credencial', 'afiliaciones', 'tarifas minimas', 'seguridad social', 'parafiscales'],
  differential_scoring_support: ['criterios diferenciales', 'mipyme', 'discapacidad', 'mujer'],
  overtime_authorization: ['horas extras'],
  legal_representative_vault: ['representante legal'],
});

const CLASS_BY_KEY = new Map(TENDER_COMPANY_DOCUMENT_CLASSES.map(entry => [entry.key, entry]));
/** Estados del puente que impiden radicar con lo que hay hoy. */
const SUPPORT_NOT_READY = new Set(['sin_archivo', 'vencido', 'vence_antes_del_cierre']);

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Las clases de documento corporativo que nombra un texto de requisito, en el orden del catálogo. */
export function matchCompanyDocumentClasses(text) {
  const haystack = normalize(text);
  if (!haystack) return [];
  const matched = [];
  for (const entry of TENDER_COMPANY_DOCUMENT_CLASSES) {
    const hints = TENDER_COMPLIANCE_DOCUMENT_HINTS[entry.key] || [];
    if (hints.some(hint => haystack.includes(normalize(hint)))) matched.push(entry.key);
  }
  return matched;
}

/** El texto del requisito donde se buscan los documentos: su título, lo que exige el pliego y qué hacer. */
function requirementText(row) {
  return [row?.title, row?.demand, ...(Array.isArray(row?.actions) ? row.actions : [])].filter(Boolean).join(' · ');
}

/**
 * La matriz. `requirementRows` son las filas de `buildRequirementRows` (el mismo modelo con el que se siembra el
 * expediente, para que la matriz y el expediente no puedan discrepar) y `bridge` es la salida de
 * `buildTenderCompanyDocumentBridge`.
 */
export function buildTenderComplianceMatrix({ requirementRows = [], bridge = null } = {}) {
  const bridgeRows = new Map((bridge?.rows || []).map(row => [row.key, row]));

  const rows = (requirementRows || []).map(requirement => {
    const matched = matchCompanyDocumentClasses(requirementText(requirement));
    const support = matched.map(key => {
      const bridgeRow = bridgeRows.get(key);
      const entry = CLASS_BY_KEY.get(key);
      return {
        key,
        label: entry?.label || key,
        owner: entry?.owner || null,
        kind: entry?.kind || null,
        folder: entry?.folder || null,
        state: bridgeRow?.state || null,
        document_name: bridgeRow?.document?.display_name || null,
        expires_at: bridgeRow?.expires_at || null,
        age_at_close_days: bridgeRow?.age_at_close_days ?? null,
        ready: bridgeRow ? !SUPPORT_NOT_READY.has(bridgeRow.state) : null,
      };
    });
    const pending = support.filter(item => item.ready === false);
    return {
      key: requirement.key,
      area: requirement.area,
      title: requirement.title,
      demand: requirement.demand || null,
      status: requirement.status,
      rejection: requirement.rejection === true,
      actions: Array.isArray(requirement.actions) ? requirement.actions : [],
      // Dónde lo pide el pliego: documento y ubicación, tal como los trae el análisis.
      sources: (requirement.sources || []).map(source => ({ document_name: source.documentName || null, locator: source.locator || null })),
      // Soporte corporativo RELACIONADO (cruce por palabras declaradas), nunca "acreditado".
      company_support: support,
      support_kind: support.length ? 'corporativo' : 'especifico_del_proceso',
      support_pending: pending.map(item => item.key),
      // Quién lo debe: el área del requisito según el análisis, y los dueños de los soportes que falten.
      owner: requirement.area,
      support_owners: [...new Set(pending.map(item => item.owner).filter(Boolean))],
    };
  });

  const counted = predicate => rows.filter(predicate).length;
  return {
    close_date: bridge?.close_date || null,
    rows,
    summary: {
      total: rows.length,
      causas_de_rechazo: counted(row => row.rejection),
      con_soporte_corporativo: counted(row => row.support_kind === 'corporativo'),
      soporte_corporativo_pendiente: counted(row => row.support_pending.length > 0),
      especificos_del_proceso: counted(row => row.support_kind === 'especifico_del_proceso'),
      // Lo que el análisis dejó como falta o por confirmar: el trabajo de la oferta, requisito por requisito.
      requisitos_abiertos: counted(row => row.status === 'falta' || row.status === 'por_confirmar'),
    },
  };
}

/**
 * La matriz como tabla plana, que es la forma en que se radica y la que entra al paquete descargable. Encabezados en
 * el orden en que la entidad los lee: requisito, qué exige, dónde lo pide, con qué se acredita, si sirve al cierre y
 * quién responde.
 */
export const TENDER_COMPLIANCE_MATRIX_HEADERS = Object.freeze([
  'Área', 'Requisito', 'Causa de rechazo', 'Qué exige el pliego', 'Dónde lo pide', 'Estado según el análisis',
  'Soporte corporativo relacionado', 'Estado del soporte al cierre', 'Responsable', 'Qué hacer',
]);

const SUPPORT_STATE_TEXT = Object.freeze({
  listo_al_cierre: 'Vigente al cierre',
  vence_antes_del_cierre: 'Vence antes del cierre',
  vencido: 'Vencido',
  sin_archivo: 'Falta el soporte',
  vigencia_por_confirmar: 'Vigencia por confirmar',
  sin_fecha_de_cierre: 'Sin fecha de cierre',
});

const STATUS_TEXT = Object.freeze({
  falta: 'Falta',
  por_confirmar: 'Por confirmar',
  declarado: 'Cumple, falta el soporte',
  cumple: 'Cumple',
  no_aplica: 'No aplica',
});

export function tenderComplianceMatrixTable(matrix) {
  return (matrix?.rows || []).map(row => [
    row.area,
    row.title,
    row.rejection ? 'Sí' : 'No',
    row.demand || '',
    row.sources.map(source => [source.document_name, source.locator].filter(Boolean).join(' · ')).join('; '),
    STATUS_TEXT[row.status] || row.status || '',
    row.company_support.length ? row.company_support.map(item => item.label).join('; ') : 'Soporte específico de este proceso',
    row.company_support.length ? row.company_support.map(item => SUPPORT_STATE_TEXT[item.state] || 'Sin dato').join('; ') : '',
    [row.owner, ...row.support_owners.filter(owner => owner !== row.owner)].filter(Boolean).join(' / '),
    row.actions.join(' '),
  ]);
}

/**
 * La matriz como CSV que Excel abre bien en español: separador `;` (es el que espera Excel con configuración regional
 * de Colombia) y BOM, sin el cual las tildes salen rotas. Una sola implementación para la descarga del navegador y
 * para el paquete descargable, que es el siguiente tramo del encargo.
 */
export function tenderComplianceMatrixCsv(headers, table, { separator = ';', bom = true } = {}) {
  const cell = value => {
    const text = String(value ?? '').replace(/\r?\n/g, ' ').trim();
    return /["';]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [headers, ...(table || [])].map(row => (row || []).map(cell).join(separator));
  return `${bom ? '﻿' : ''}${lines.join('\r\n')}\r\n`;
}
