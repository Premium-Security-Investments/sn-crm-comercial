// AGT-002 — el puente entre la ficha de la empresa y el expediente de una licitación (encargo de Juan, 2026-10-30:
// "el después del GO... que podamos presentar los documentos de manera ágil").
//
// La mayoría de lo que se radica NO se redacta: son documentos corporativos que ya existen (RUP, Cámara de Comercio,
// licencia de SuperVigilancia, pólizas, antecedentes, certificación bancaria, listado de armas). Hoy hay que buscarlos
// a mano en cada licitación y, peor, decidir a ojo si llegan vigentes al cierre. Este módulo contesta eso una sola vez
// y por licitación: qué hay, dónde está, si sirve el día del cierre y de quién es lo que falta.
//
// Dos reglas de la casa que este módulo respeta a propósito:
//
//   1. **Nada se inventa.** Si el documento no está cargado, la fila sale `sin_archivo` con su dueño; si la vigencia
//      no está declarada como fecha —el registro de evidencia la guarda muchas veces en prosa (`vigencia_text`)— sale
//      `por_confirmar`, nunca "vigente". Una fecha adivinada es peor que un hueco visible.
//   2. **Trámite y hecho inscrito no se mezclan** (instrucción de Juan, 2026-10-21). Un papel vencido se reexpide en
//      minutos: es una tarea administrativa, no un riesgo. El riesgo es el hecho que ningún trámite cambia —la
//      antigüedad de una agencia, las modalidades de la licencia, lo que está inscrito en el RUP—. El puente marca
//      cada requisito con su clase para que el tablero no pese un trámite de cinco minutos igual que un hecho
//      consumado. El RUP es las dos cosas: el certificado se pide hoy, pero lo que no esté inscrito a la fecha de
//      cierre no existe para ese proceso.
//
// Y una cuenta que los pliegos piden siempre y nadie tenía a mano: la **antigüedad del documento el día del cierre**.
// Un certificado de antecedentes expedido en junio está "vigente" y a la vez sirve para nada si el pliego lo exige con
// 30 días. Con `issued_at` y la fecha de cierre eso es aritmética, así que se calcula y se dice.
//
// Módulo puro: sin red, sin base de datos, sin express.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Trámite: se reexpide. Hecho inscrito: ningún trámite lo cambia. Mixto: el papel es trámite, el contenido es hecho. */
export const TENDER_COMPANY_DOCUMENT_KINDS = Object.freeze({
  tramite: 'Trámite de vigencia',
  hecho_inscrito: 'Hecho inscrito',
  mixto: 'Trámite con hecho inscrito adentro',
});

/**
 * Las clases canónicas de documento corporativo que se radican, con su dueño, su carpeta del paquete y su clase.
 *
 * `registry_entry` apunta al `entry_id` del registro de evidencia (`psi_agt002_company_evidence_registry`), que es la
 * fuente de la lista; aquí sólo se declara lo que el registro no dice: de quién es, en qué carpeta va y si es trámite
 * o hecho. `document_types` son los valores de `psi_company_procurement_documents.document_type` que acreditan la
 * clase: desde la pantalla de Empresa el tipo ES el `entry_id`, así que los alias sólo existen para las cargas
 * anteriores a esa convención.
 */
export const TENDER_COMPANY_DOCUMENT_CLASSES = Object.freeze([
  // El certificado de existencia y representación ya tiene su bloque (migración 166, autorizada por Juan el
  // 2026-10-30). El tipo legado `certificado` se conserva porque los dos soportes cargados antes de que el bloque
  // existiera —2026-09-01 y 2026-10-06— entraron por ahí y siguen acreditando: migrarlos sería mover datos de
  // producción sin ganar nada, y el más reciente gana igual.
  { key: 'chamber_of_commerce', label: 'Certificado de Cámara de Comercio', owner: 'Jurídico', folder: '02_Juridico', kind: 'tramite', registry_entry: 'chamber_of_commerce', document_types: ['chamber_of_commerce', 'certificado'] },
  { key: 'rup', label: 'Registro Único de Proponentes (RUP)', owner: 'Licitaciones', folder: '05_Experiencia', kind: 'mixto', registry_entry: 'rup', document_types: ['rup'] },
  { key: 'rut', label: 'Registro Único Tributario (RUT)', owner: 'Jurídico', folder: '02_Juridico', kind: 'tramite', registry_entry: 'rut', document_types: ['rut'] },
  { key: 'supervigilancia_operating_license', label: 'Licencia de funcionamiento SuperVigilancia', owner: 'Jurídico', folder: '02_Juridico', kind: 'hecho_inscrito', registry_entry: 'supervigilancia_operating_license', document_types: ['supervigilancia_operating_license'] },
  { key: 'uniforms_resolution', label: 'Resolución de uniformes y distintivos', owner: 'Jurídico', folder: '02_Juridico', kind: 'hecho_inscrito', registry_entry: 'uniforms_resolution', document_types: ['uniforms_resolution'] },
  { key: 'communications_license', label: 'Permisos de comunicaciones', owner: 'Jurídico', folder: '02_Juridico', kind: 'hecho_inscrito', registry_entry: 'communications_license', document_types: ['communications_license'] },
  { key: 'corporate_background_checks', label: 'Antecedentes de la persona jurídica', owner: 'Jurídico', folder: '02_Juridico', kind: 'tramite', registry_entry: 'corporate_background_checks', document_types: ['corporate_background_checks', 'procuraduria_empresa', 'medidas_correctivas_empresa'] },
  { key: 'no_fines_sanctions_certificate', label: 'Certificado de multas y sanciones', owner: 'Jurídico', folder: '02_Juridico', kind: 'tramite', registry_entry: 'no_fines_sanctions_certificate', document_types: ['no_fines_sanctions_certificate'] },
  { key: 'legal_representative_vault', label: 'Documentos y antecedentes del representante legal', owner: 'Jurídico', folder: '02_Juridico', kind: 'tramite', registry_entry: 'legal_representative_vault', document_types: ['legal_representative_vault'] },
  { key: 'financial_and_tax_pack', label: 'Estados financieros y declaración de renta', owner: 'Contabilidad', folder: '03_Financiero', kind: 'hecho_inscrito', registry_entry: 'financial_and_tax_pack', document_types: ['financial_and_tax_pack'] },
  { key: 'bank_certificate', label: 'Certificación bancaria', owner: 'Contabilidad', folder: '03_Financiero', kind: 'tramite', registry_entry: 'bank_certificate', document_types: ['bank_certificate'] },
  { key: 'rce_policy', label: 'Póliza de responsabilidad civil extracontractual', owner: 'Jurídico', folder: '07_Polizas', kind: 'tramite', registry_entry: 'rce_policy', document_types: ['rce_policy'] },
  { key: 'collective_life_policy', label: 'Póliza de vida colectiva de vigilantes', owner: 'Jurídico', folder: '07_Polizas', kind: 'tramite', registry_entry: 'collective_life_policy', document_types: ['collective_life_policy'] },
  { key: 'authorized_weapons_list', label: 'Listado de armas autorizadas', owner: 'Operaciones', folder: '02_Juridico', kind: 'tramite', registry_entry: 'authorized_weapons_list', document_types: ['authorized_weapons_list'] },
  { key: 'overtime_authorization', label: 'Autorización de horas extras', owner: 'Operaciones', folder: '02_Juridico', kind: 'hecho_inscrito', registry_entry: 'overtime_authorization', document_types: ['overtime_authorization'] },
  { key: 'personnel_credentials_vault', label: 'Credenciales y afiliaciones del personal', owner: 'Operaciones', folder: '04_Tecnico', kind: 'mixto', registry_entry: 'personnel_credentials_vault', document_types: ['personnel_credentials_vault'] },
  { key: 'differential_scoring_support', label: 'Soportes de criterios diferenciales', owner: 'Jurídico', folder: '04_Tecnico', kind: 'mixto', registry_entry: 'differential_scoring_support', document_types: ['differential_scoring_support'] },
  { key: 'accredited_experience', label: 'Experiencia acreditada', owner: 'Licitaciones', folder: '05_Experiencia', kind: 'hecho_inscrito', registry_entry: 'accredited_experience', document_types: ['accredited_experience'] },
  // Bloques abiertos el 2026-10-30 (migración 166). Los dos son `hecho_inscrito` y no trámite: renovar una ISO o un
  // BASC exige una auditoría, y la antigüedad de una agencia no la cambia ningún papel nuevo —fue lo que decidió el
  // NO-GO de Cali—. Tratarlos como trámite haría que un vencimiento se leyera como "una llamada y listo".
  { key: 'quality_certifications', label: 'Certificaciones de calidad (BASC e ISO)', owner: 'Licitaciones', folder: '04_Tecnico', kind: 'hecho_inscrito', registry_entry: 'quality_certifications', document_types: ['quality_certifications'] },
  // Una ciudad puede estar acreditada por resolución propia (Bogotá, Medellín, Cali) o por la tabla de agencias de la
  // licencia de funcionamiento (Pereira, Cartago, Manizales). Las dos valen, así que un hueco aquí no significa que
  // la ciudad no esté acreditada: la fila muestra la prosa del registro, que lo explica.
  { key: 'agency_authorizations', label: 'Autorizaciones de agencia por ciudad', owner: 'Jurídico', folder: '02_Juridico', kind: 'hecho_inscrito', registry_entry: 'agency_authorizations', document_types: ['agency_authorizations'] },
]);

const CLASS_BY_DOCUMENT_TYPE = new Map();
for (const entry of TENDER_COMPANY_DOCUMENT_CLASSES) {
  for (const type of entry.document_types) if (!CLASS_BY_DOCUMENT_TYPE.has(type)) CLASS_BY_DOCUMENT_TYPE.set(type, entry.key);
}

/**
 * `document_type` del CRM → `entry_id` del registro de evidencia, resolviendo los **alias legados**.
 * Vive aquí porque este módulo ya es la fuente de verdad de esos alias (`document_types` por clase):
 * repetirlos en cada consumidor es cómo la Cámara de Comercio —cargada dos veces bajo el tipo
 * `certificado`— se reportaba como "el CRM no tiene ningún documento", que es falso.
 */
export function tenderCompanyRegistryEntryForDocumentType(documentType) {
  const type = String(documentType || '');
  if (!type) return null;
  const entry = TENDER_COMPANY_DOCUMENT_CLASSES.find(item => (item.document_types || []).includes(type));
  return entry?.registry_entry || null;
}

export function tenderCompanyDocumentClassForType(documentType) {
  return CLASS_BY_DOCUMENT_TYPE.get(String(documentType || '').trim().toLowerCase()) || null;
}

function calendarDate(value) {
  const text = String(value ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const time = Date.parse(`${text}T00:00:00.000Z`);
  return Number.isFinite(time) ? { text, time } : null;
}

function daysBetween(fromTime, toTime) {
  return Math.round((toTime - fromTime) / DAY_MS);
}

/** Cuántos días de expedido tendrá el documento el día del cierre. `null` si falta alguna de las dos fechas. */
export function companyDocumentAgeAtClose(issuedAt, closeDate) {
  const issued = calendarDate(issuedAt);
  const close = calendarDate(closeDate);
  if (!issued || !close) return null;
  return daysBetween(issued.time, close.time);
}

/**
 * Los documentos vigentes de una clase, del más reciente al más viejo. Una clase puede estar acreditada por VARIOS
 * soportes —los antecedentes de la persona jurídica son tres consultas distintas, cargadas el mismo día— así que la
 * lista entera viaja y el primero es sólo el que gobierna las fechas. El desempate termina en el id para que el
 * orden no dependa de cómo vinieron las filas.
 */
function pickCurrentDocuments(documents, entry) {
  const types = new Set(entry.document_types);
  return (documents || [])
    .filter(document => document?.current !== false && types.has(String(document?.document_type || '').trim().toLowerCase()))
    .sort((left, right) => {
      const leftIssued = calendarDate(left?.issued_at)?.time ?? 0;
      const rightIssued = calendarDate(right?.issued_at)?.time ?? 0;
      if (rightIssued !== leftIssued) return rightIssued - leftIssued;
      const versions = Number(right?.version || 0) - Number(left?.version || 0);
      if (versions !== 0) return versions;
      return String(left?.id || '').localeCompare(String(right?.id || ''));
    });
}

function publicDocument(document) {
  return {
    id: document.id,
    display_name: document.display_name,
    document_type: document.document_type,
    issued_at: document.issued_at || null,
    expires_at: document.expires_at || null,
    version: document.version ?? null,
    storage_path: document.storage_path || null,
  };
}

/**
 * El vencimiento que manda para una clase: el del documento cargado si lo declara, y si no el del registro de
 * evidencia (`expiry`), que es una fecha verificada por una persona. La prosa de `vigencia_text` NO se interpreta:
 * viaja aparte para que alguien la lea.
 */
function resolveExpiry(document, registryEntry) {
  const fromDocument = calendarDate(document?.expires_at);
  if (fromDocument) return { date: fromDocument, source: 'documento' };
  const fromRegistry = calendarDate(registryEntry?.expiry);
  const issued = calendarDate(document?.issued_at);
  // El `expiry` del registro describe lo que una persona observó en su momento. Si el documento cargado se expidió
  // DESPUÉS de esa fecha, la observación quedó atrás y no puede declarar vencido un papel más nuevo: en ese caso la
  // vigencia queda por confirmar, con la prosa del registro a la vista. Caso real: antecedentes con ventana
  // registrada hasta el 2026-08-29 y una carga del 2026-10-17.
  if (fromRegistry && (!issued || issued.time <= fromRegistry.time)) return { date: fromRegistry, source: 'registro_de_evidencia' };
  return { date: null, source: null };
}

/** `today` entra como parámetro, no se lee del reloj aquí: el módulo tiene que ser reproducible en una prueba. */
function rowState({ document, expiry, close, today }) {
  if (!document) return 'sin_archivo';
  if (!close) return 'sin_fecha_de_cierre';
  if (!expiry.date) return 'vigencia_por_confirmar';
  if (today && expiry.date.time < today.time) return 'vencido';
  return expiry.date.time >= close.time ? 'listo_al_cierre' : 'vence_antes_del_cierre';
}

/** Qué hacer, dicho en una línea y según la clase: un trámite se pide; un hecho inscrito se verifica. */
function rowAction(state, entry) {
  if (state === 'sin_archivo') {
    return entry.kind === 'hecho_inscrito'
      ? `Falta el soporte. Antes de buscarlo, verificar el hecho que registra: ${entry.owner} lo sabe.`
      : `Falta el soporte: lo pide ${entry.owner}.`;
  }
  if (state === 'vencido' || state === 'vence_antes_del_cierre') {
    return entry.kind === 'hecho_inscrito'
      ? `No alcanza el cierre y no lo arregla un trámite: hay que verificar el hecho con ${entry.owner}.`
      : `Reexpedir antes del cierre: lo tramita ${entry.owner}.`;
  }
  if (state === 'vigencia_por_confirmar') return `Sin fecha de vencimiento declarada: ${entry.owner} confirma la vigencia contra el pliego.`;
  if (state === 'sin_fecha_de_cierre') return 'La licitación no tiene fecha de cierre declarada, así que la vigencia no se puede contrastar.';
  return null;
}

/**
 * El puente, por licitación. `registry` y `documents` son lo que ya leen la pantalla de Empresa
 * (`psi_agt002_company_evidence_registry` vigente y `psi_company_procurement_documents`); `closeDate` es la fecha de
 * cierre de ESA licitación. No escribe nada y no decide nada: proyecta.
 */
export function buildTenderCompanyDocumentBridge({ registry = [], documents = [], closeDate = null, now = new Date() } = {}) {
  const close = calendarDate(closeDate);
  const registryByEntry = new Map((registry || []).map(entry => [String(entry?.entry_id || ''), entry]));
  const today = calendarDate(new Date(now).toISOString());

  const rows = TENDER_COMPANY_DOCUMENT_CLASSES.map(entry => {
    const registryEntry = entry.registry_entry ? registryByEntry.get(entry.registry_entry) || null : null;
    const matched = pickCurrentDocuments(documents, entry);
    const document = matched[0] || null;
    const expiry = resolveExpiry(document, registryEntry);
    const state = rowState({ document, expiry, close, today });
    const ageAtClose = companyDocumentAgeAtClose(document?.issued_at, close?.text);
    return {
      key: entry.key,
      label: entry.label,
      owner: entry.owner,
      folder: entry.folder,
      kind: entry.kind,
      kind_label: TENDER_COMPANY_DOCUMENT_KINDS[entry.kind],
      registry_entry: entry.registry_entry,
      // La prosa del registro viaja tal cual: es lo único que hay cuando no existe fecha, y la lee una persona.
      vigencia_text: registryEntry?.vigencia_text || null,
      human_review_status: registryEntry?.human_review_status || null,
      existence_status: registryEntry?.existence_status || null,
      document: document ? publicDocument(document) : null,
      // Todos los soportes vigentes de la clase, no sólo el que gobierna las fechas.
      supporting_documents: matched.map(publicDocument),
      state,
      expires_at: expiry.date?.text || null,
      expiry_source: expiry.source,
      days_to_close: close && today ? daysBetween(today.time, close.time) : null,
      // Lo que ningún tablero tenía: la edad del papel el día del cierre. El pliego pide 15, 30, 60 o 90 días.
      age_at_close_days: ageAtClose,
      age_note: ageAtClose === null ? null
        : `Al cierre tendrá ${ageAtClose} ${ageAtClose === 1 ? 'día' : 'días'} de expedido.`,
      action: rowAction(state, entry),
    };
  });

  const counted = state => rows.filter(row => row.state === state).length;
  return {
    close_date: close?.text || null,
    rows,
    summary: {
      total: rows.length,
      listo_al_cierre: counted('listo_al_cierre'),
      vence_antes_del_cierre: counted('vence_antes_del_cierre'),
      vencido: counted('vencido'),
      vigencia_por_confirmar: counted('vigencia_por_confirmar'),
      sin_archivo: counted('sin_archivo'),
      sin_fecha_de_cierre: counted('sin_fecha_de_cierre'),
      // Lo que de verdad puede tumbar la oferta: un hecho inscrito que no llega al cierre no lo arregla un trámite.
      hechos_inscritos_en_riesgo: rows.filter(row => row.kind !== 'tramite' && ['sin_archivo', 'vencido', 'vence_antes_del_cierre'].includes(row.state)).length,
      tramites_por_hacer: rows.filter(row => row.kind === 'tramite' && ['sin_archivo', 'vencido', 'vence_antes_del_cierre'].includes(row.state)).length,
    },
    // Documentos corporativos cargados que ninguna clase reclama: se listan para que nada quede escondido.
    unmatched_documents: (documents || [])
      .filter(document => document?.current !== false && !tenderCompanyDocumentClassForType(document?.document_type))
      .map(document => ({ id: document.id, display_name: document.display_name, document_type: document.document_type, issued_at: document.issued_at || null, expires_at: document.expires_at || null })),
    gaps: bridgeGaps(registryByEntry),
  };
}

/** Huecos del catálogo frente al registro de evidencia. Se reportan, no se arreglan por inferencia. */
function bridgeGaps(registryByEntry) {
  const declared = new Set(TENDER_COMPANY_DOCUMENT_CLASSES.map(entry => entry.registry_entry).filter(Boolean));
  const gaps = [];
  for (const entryId of registryByEntry.keys()) {
    if (entryId && !declared.has(entryId)) gaps.push({ kind: 'registro_sin_clase', entry_id: entryId });
  }
  for (const entry of TENDER_COMPANY_DOCUMENT_CLASSES) {
    if (entry.registry_entry && !registryByEntry.has(entry.registry_entry)) gaps.push({ kind: 'clase_sin_registro', key: entry.key, entry_id: entry.registry_entry });
    if (!entry.registry_entry) gaps.push({ kind: 'clase_fuera_del_registro', key: entry.key });
  }
  return gaps;
}
