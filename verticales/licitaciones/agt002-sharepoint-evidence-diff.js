// AGT-002 — las diferencias entre lo que hay en SharePoint y lo que el CRM cree (mejora 1 del
// encargo del 2026-10-31, marcada PRIORIDAD).
//
// El caso: el CRM contradijo a la realidad tres veces en tres días. El que este módulo evita es el
// segundo: el bloque `corporate_background_checks` figuraba vencido con `expiry` 2026-08-29 cuando
// en SharePoint existían paquetes completos del 2026-09-02 y del 2026-10-17. **Se iba a pedir a
// Katherine que tramitara documentos que ya teníamos.** Las tres veces el puente fue una persona.
//
// Medido el 2026-11-01: la biblioteca corporativa tiene **122 archivos**, y el inventario del CRM
// (`psi_agt002_company_evidence_source_files`, sembrado por la migración 080) tiene 93 con su última
// observación del **2026-09-02** y la modificación más nueva que conoce del **2026-07-30**. Dos meses
// de retraso, y nada lo refresca: la 080 sembró una foto y no dejó función de escritura.
//
// ## Lo que este módulo hace, y lo que deja para después
//
// Refrescar el inventario durable exige reproducir su identidad, que es el **hash del contenido** de
// cada archivo ("`source_fingerprint` is the stable identity of the observed file's content", 080),
// o sea bajar y hashear los 122. Eso es otro incremento, con su migración para la función de
// escritura. Este módulo entrega lo que previene el daño sin esperar nada de eso: **la diferencia**,
// que es lo que una persona necesita leer.
//
// ## Dos restricciones que no se negocian
//
//  1. **No marca evidencia como verificada** (§6 del encargo, y la custodia de las migraciones 061,
//     158 y 159). Reporta la diferencia; decide una persona.
//  2. **Los datos personales no viajan.** `personnel_credentials_vault` y
//     `legal_representative_vault` son 66 de los 122 archivos —hojas de vida de coordinadores y
//     supervisores, antecedentes del representante legal— y el §6 prohíbe que viajen. De esas clases
//     se cuenta, nunca se nombra un archivo. La regla vive en la tabla de abajo, no en el criterio de
//     quien llame.
//
// Módulo puro: sin red, sin base de datos, sin express.

import { TENDER_COMPANY_DOCUMENT_CLASSES } from './tender-company-document-bridge.js';

const LIBRARY_ROOT = '06_Productos_PSI/Licitaciones/02_Biblioteca_Corporativa_SN';

/**
 * Basura del sistema de archivos y temporales de Office. Contarlos como evidencia hace que el
 * informe diga tonterías —la primera corrida real anunció un «.DS_Store» como la versión más nueva
 * de la licencia de SuperVigilancia— y un informe que dice tonterías deja de leerse.
 */
const JUNK = /^(\.|~\$)|^(thumbs\.db|desktop\.ini)$/i;

/**
 * `document_type` del CRM → `entry_id` del registro, incluidos los **alias legados**. Se deriva de
 * `TENDER_COMPANY_DOCUMENT_CLASSES`, que ya es la fuente de verdad de esos alias, en vez de repetirlos:
 * sin esto, la Cámara de Comercio —cargada dos veces bajo el tipo legado `certificado`— se reportaba
 * como "el CRM no tiene ningún documento", que es falso y es la peor clase de aviso.
 */
const ENTRY_FOR_DOCUMENT_TYPE = new Map(
  TENDER_COMPANY_DOCUMENT_CLASSES.flatMap(entry => (entry.document_types || [])
    .map(type => [type, entry.registry_entry])).filter(([, entryId]) => Boolean(entryId)),
);

/**
 * Carpeta de la biblioteca → clase del registro de evidencia. Declarado, no adivinado: el orden
 * importa y gana la primera regla que calce, de lo más específico a lo más general. `personal: true`
 * marca las clases cuyos archivos NUNCA se nombran. `disposition: 'excluded_non_evidence'` es el
 * vocabulario de la migración 080 para lo que está en la biblioteca y no es evidencia (plantillas,
 * índices, reglas): no es un hueco, es que no aplica.
 */
export const AGT002_LIBRARY_CLASS_RULES = Object.freeze([
  { folder: '10_Plantillas_y_Formatos_Base', entryId: null, disposition: 'excluded_non_evidence' },
  { folder: '06_Talento_Humano', entryId: 'personnel_credentials_vault', disposition: 'evidence', personal: true },
  // `\bRL\b` y no `_RL`: los paquetes reales se llaman «ANTECEDENTES DISCIPLINARIOS RL SEGUNAL
  // 2_09_2026.pdf», con espacios. Con el patrón anterior caían en el bloque de la empresa y el
  // informe NOMBRABA un archivo del representante legal, que es exactamente lo que el §6 prohíbe.
  { folder: '01_Legal_y_Societario/Antecedentes Actualizados', name: /(^|[\s_-])RL([\s_.-]|$)|REPRESENTANTE|REDAM|INHABILIDADES/i, entryId: 'legal_representative_vault', disposition: 'evidence', personal: true },
  { folder: '01_Legal_y_Societario/Antecedentes Actualizados', entryId: 'corporate_background_checks', disposition: 'evidence' },
  { folder: '01_Legal_y_Societario/Documentos_Corporativos', name: /RUT/i, entryId: 'rut', disposition: 'evidence' },
  { folder: '01_Legal_y_Societario/Documentos_Corporativos', entryId: 'chamber_of_commerce', disposition: 'evidence' },
  // Las certificaciones de calidad tienen carpeta propia, así que la señal es la carpeta y no el
  // nombre: ahí viven «IQNET 18788.pdf», «PACTO GLOBAL…» y «SELLO DE SOSTENIBILIDAD…», que no dicen
  // CALIDAD ni ISO en el nombre. Con la regla por nombre, IQNET se reportaba como la versión más
  // nueva de la licencia de funcionamiento.
  { folder: '02_Licencias_y_Habilitaciones/CERTIFICACIONES_Y_LICENCIAS_VIGENTES_-_SEGURIDAD_NACIONAL_/CERTIFICACIONES DE CALIDAD SN', entryId: 'quality_certifications', disposition: 'evidence' },
  { folder: '02_Licencias_y_Habilitaciones', name: /CALIDAD|BASC|\bISO\b/i, entryId: 'quality_certifications', disposition: 'evidence' },
  { folder: '02_Licencias_y_Habilitaciones', name: /COMUNICACIONES/i, entryId: 'communications_license', disposition: 'evidence' },
  { folder: '02_Licencias_y_Habilitaciones', name: /MULTAS|SANCIONES/i, entryId: 'no_fines_sanctions_certificate', disposition: 'evidence' },
  { folder: '02_Licencias_y_Habilitaciones', name: /UNIFORMES/i, entryId: 'uniforms_resolution', disposition: 'evidence' },
  { folder: '02_Licencias_y_Habilitaciones', name: /ARMAS/i, entryId: 'authorized_weapons_list', disposition: 'evidence' },
  // Las resoluciones de agencia se nombran por ciudad, no por la palabra «agencia»: la de Bogotá es
  // «Resolucion Licencia Bogota 2020.pdf». Las tres ciudades con resolución propia están declaradas
  // en el registro (Bogotá 2020-0049297, Medellín y Cali 2024), así que se nombran aquí también.
  { folder: '02_Licencias_y_Habilitaciones', name: /AGENCIA|BOGOTA|MEDELLIN|CALI/i, entryId: 'agency_authorizations', disposition: 'evidence' },
  { folder: '02_Licencias_y_Habilitaciones', name: /FUNCIONAMIENTO/i, entryId: 'supervigilancia_operating_license', disposition: 'evidence' },
  // Y NO hay comodín para esta carpeta. Un comodín aquí absorbía en la licencia de funcionamiento
  // todo lo que no calzara, que es cómo IQNET acabó anunciado como licencia. Lo que ninguna regla
  // ubique sale `sin_clasificar` y se reporta: un hueco declarado es mejor que una clase inventada.
  { folder: '03_RUP_y_Capacidad_Financiera', name: /FINANCIER|BALANCE|RENTA|ESTADOS/i, entryId: 'financial_and_tax_pack', disposition: 'evidence' },
  { folder: '03_RUP_y_Capacidad_Financiera', entryId: 'rup', disposition: 'evidence' },
  { folder: '04_Experiencia_Acreditada', entryId: 'accredited_experience', disposition: 'evidence' },
  { folder: '05_Capacidad_Operativa_y_Tecnica', name: /ARMAS/i, entryId: 'authorized_weapons_list', disposition: 'evidence' },
  { folder: '05_Capacidad_Operativa_y_Tecnica', name: /UNIFORMES/i, entryId: 'uniforms_resolution', disposition: 'evidence' },
  { folder: '07_SST_Calidad_y_Ambiente', entryId: 'quality_certifications', disposition: 'evidence' },
  { folder: '08_Polizas_y_Seguros', name: /VIDA|COLECTIV/i, entryId: 'collective_life_policy', disposition: 'evidence' },
  { folder: '08_Polizas_y_Seguros', name: /RCE|RESPONSABILIDAD/i, entryId: 'rce_policy', disposition: 'evidence' },
  { folder: '09_Medios_Tecnologicos', entryId: 'differential_scoring_support', disposition: 'evidence' },
]);

const relative = path => String(path || '').replace(`${LIBRARY_ROOT}/`, '').replace(LIBRARY_ROOT, '');
const day = value => {
  const text = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = Date.parse(text.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
};

/**
 * Clase de un archivo de la biblioteca. Gana la primera regla que calce. Un archivo en la raíz de la
 * biblioteca (índices, reglas, auditorías) no es evidencia. Un archivo en una carpeta sin regla sale
 * `entryId: null` con `disposition: 'evidence'`: eso NO se calla, se reporta como hueco de las reglas
 * —`sin_clasificar`—, porque un archivo de evidencia que nadie sabe a qué bloque pertenece es
 * precisamente lo que hace que el CRM contradiga a la realidad.
 */
export function agt002ClassifyLibraryFile(path) {
  const rel = relative(path);
  if (!rel || !rel.includes('/')) return { entryId: null, disposition: 'excluded_non_evidence', personal: false, classified: true };
  const name = rel.split('/').pop() || '';
  if (JUNK.test(name)) return { entryId: null, disposition: 'excluded_non_evidence', personal: false, classified: true };
  for (const rule of AGT002_LIBRARY_CLASS_RULES) {
    if (!rel.startsWith(`${rule.folder}/`)) continue;
    // Contra el NOMBRE, nunca contra la ruta: la carpeta «03_RUP_y_Capacidad_Financiera» contiene
    // «Financiera», y probando la ruta el certificado del RUP se clasificaba como estado financiero.
    if (rule.name && !rule.name.test(name)) continue;
    return {
      entryId: rule.entryId,
      disposition: rule.disposition,
      personal: rule.personal === true,
      classified: true,
    };
  }
  return { entryId: null, disposition: 'evidence', personal: false, classified: false, name };
}

/**
 * Las diferencias entre la biblioteca y el CRM. Tres hechos, y cada uno existe porque ya costó algo:
 *
 *  - `existe_en_sharepoint_y_no_en_el_crm` — hay archivos de esa clase en la biblioteca y el CRM no
 *    tiene ningún documento cargado del bloque. Es el caso 2 del encargo: se iba a tramitar de nuevo
 *    algo que ya teníamos.
 *  - `sharepoint_tiene_algo_mas_nuevo` — el archivo más nuevo de la clase es posterior al documento
 *    que el CRM tiene cargado. El CRM está mirando una versión vieja.
 *  - `sin_clasificar` — archivos de evidencia que ninguna regla ubica. Hueco de las reglas, dicho en
 *    voz alta en vez de descartado en silencio.
 *
 * De las clases personales se cuenta y no se nombra. Nunca se afirma nada sobre vigencia: eso es del
 * registro y de una persona.
 */
export function agt002SharepointEvidenceDifferences({ files = [], registry = [], documents = [] } = {}) {
  const byEntry = new Map();
  const unclassified = [];
  for (const file of files) {
    const path = file?.ruta ?? file?.path ?? '';
    const klass = agt002ClassifyLibraryFile(path);
    if (klass.disposition !== 'evidence') continue;
    if (!klass.entryId) { unclassified.push({ name: klass.name || '', modifiedAt: day(file?.modificado_en ?? file?.modified_at) }); continue; }
    const bucket = byEntry.get(klass.entryId) || { entryId: klass.entryId, personal: klass.personal, count: 0, newest: null, newestName: null };
    bucket.count += 1;
    const modified = day(file?.modificado_en ?? file?.modified_at);
    if (modified && (!bucket.newest || modified > bucket.newest)) {
      bucket.newest = modified;
      bucket.newestName = klass.personal ? null : (path.split('/').pop() || null);
    }
    byEntry.set(klass.entryId, bucket);
  }

  const registryById = new Map((registry || []).filter(entry => entry?.current !== false).map(entry => [String(entry?.entry_id || ''), entry]));
  const docsByType = new Map();
  for (const document of documents || []) {
    if (document?.current === false) continue;
    const rawType = String(document?.document_type || '');
    // Un tipo legado acredita su clase igual que el canónico. Sin resolverlo, un bloque con soporte
    // cargado se reporta como vacío.
    const type = ENTRY_FOR_DOCUMENT_TYPE.get(rawType) || rawType;
    const issued = day(document?.issued_at);
    const previous = docsByType.get(type);
    if (!previous || (issued && previous.issued && issued > previous.issued) || (issued && !previous.issued)) {
      docsByType.set(type, { issued, name: document?.display_name || null });
    }
  }

  const differences = [];
  for (const bucket of [...byEntry.values()].sort((a, b) => a.entryId.localeCompare(b.entryId))) {
    const entry = registryById.get(bucket.entryId);
    // Una clase que SharePoint tiene y el registro no reconoce no es una diferencia de documentos:
    // es que las reglas de arriba apuntan a un bloque que no existe vigente. Se dice aparte.
    if (!entry) {
      differences.push({ code: 'clase_sin_bloque', entryId: bucket.entryId, severity: 'media', count: bucket.count });
      continue;
    }
    const loaded = docsByType.get(bucket.entryId);
    if (!loaded) {
      differences.push({
        code: 'existe_en_sharepoint_y_no_en_el_crm',
        entryId: bucket.entryId,
        label: String(entry.document_class || bucket.entryId),
        severity: 'alta',
        count: bucket.count,
        newest: bucket.newest,
        newestName: bucket.newestName,
        personal: bucket.personal,
      });
      continue;
    }
    if (bucket.newest && loaded.issued && bucket.newest > loaded.issued) {
      differences.push({
        code: 'sharepoint_tiene_algo_mas_nuevo',
        entryId: bucket.entryId,
        label: String(entry.document_class || bucket.entryId),
        severity: 'media',
        count: bucket.count,
        newest: bucket.newest,
        newestName: bucket.newestName,
        loadedIssued: loaded.issued,
        personal: bucket.personal,
      });
    }
  }
  if (unclassified.length) {
    differences.push({
      code: 'sin_clasificar',
      severity: 'media',
      count: unclassified.length,
      names: unclassified.slice(0, 5).map(item => item.name).filter(Boolean),
    });
  }
  return differences;
}

/** Una línea legible por diferencia, para dejarla donde la encargada trabaja. */
export function agt002SharepointDifferenceLine(difference) {
  const where = 'la biblioteca corporativa de SharePoint';
  if (difference.code === 'existe_en_sharepoint_y_no_en_el_crm') {
    const cual = difference.personal
      ? `${difference.count} archivo(s)`
      : `${difference.count} archivo(s)${difference.newestName ? `, el más nuevo «${difference.newestName}»` : ''}`;
    return `Vig-IA, puente SharePoint: «${difference.label}» tiene ${cual} en ${where}${difference.newest ? `, con fecha ${difference.newest}` : ''}, y en el CRM el bloque no tiene ningún documento cargado. Antes de tramitarlo de nuevo, revisar lo que ya existe.`;
  }
  if (difference.code === 'sharepoint_tiene_algo_mas_nuevo') {
    const cual = difference.personal ? '' : (difference.newestName ? ` («${difference.newestName}»)` : '');
    return `Vig-IA, puente SharePoint: «${difference.label}» tiene en ${where} algo del ${difference.newest}${cual}, más nuevo que el documento cargado en el CRM, del ${difference.loadedIssued}. El CRM puede estar mirando una versión vieja.`;
  }
  if (difference.code === 'sin_clasificar') {
    return `Vig-IA, puente SharePoint: ${difference.count} archivo(s) de ${where} no los ubica ninguna regla, así que no se comparan con ningún bloque${difference.names.length ? `: ${difference.names.map(name => `«${name}»`).join(', ')}` : ''}. Es un hueco de las reglas del puente, no de la ficha.`;
  }
  if (difference.code === 'clase_sin_bloque') {
    return `Vig-IA, puente SharePoint: las reglas del puente apuntan «${difference.entryId}» a un bloque que no está vigente en el registro de evidencia, con ${difference.count} archivo(s) detrás. Revisar la regla o el registro.`;
  }
  return `Vig-IA, puente SharePoint: diferencia sin texto declarado (${difference.code}).`;
}
