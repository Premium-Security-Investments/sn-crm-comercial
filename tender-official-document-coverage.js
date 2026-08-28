// Cobertura documental oficial de un proceso público (SECOP II / ESU Contratación).
//
// Un documento oficial publicado se importa por estar publicado, no por parecerse
// a un catálogo de nombres. El filtro por palabras clave que vivía duplicado en
// los dos backends descartaba en silencio lo que no casaba —ANALISIS DEL SECTOR y
// las cotizaciones de un proceso real— y dejaba el expediente presentado como
// "completo" con una fracción del contenido publicado.
//
// El tope oficial de 40 documentos se conserva (acota descargas y round-trips por
// job), pero dejar algo fuera deja de ser silencioso: cada documento por encima
// del tope se enumera con identidad estable, nombre y motivo cerrado. Esa
// enumeración es la única fuente de los gaps del expediente
// (tender-requirement-inventory.js), de modo que una cobertura parcial hace fallar
// cerrado a decision_ready por la maquinaria que ya existe.
//
// El módulo es puro y determinista: sin red, sin reloj, sin aleatoriedad y sin
// acceso a almacenamiento. La enumeración lleva identidad y nombre, nunca la URL
// de descarga: en SECOP esa URL viaja con token firmado y no puede filtrarse por
// la traza de cobertura.

export const TENDER_OFFICIAL_DOCUMENT_SELECTION_CAP = 40;

// Motivo cerrado del hueco documental. Viaja verbatim hasta el inventario, así que
// nunca se compone con datos del proceso ni se reetiqueta aguas abajo.
export const TENDER_OFFICIAL_DOCUMENT_OMITTED_REASON = 'official_document_omitted_by_selection_cap';

// Código terminal con el que el worker durable registra cada omitido como import
// item `failed_terminal`, para que el hueco sea durable y no solo un evento.
export const TENDER_OFFICIAL_DOCUMENT_OMITTED_ERROR_CODE = 'TENDER_DOC_COVERAGE_OMITTED';

const defaultNameGetter = document => document?.nombre_archivo ?? document?.name;
const defaultIdGetter = document => document?.id_documento ?? document?.id;

function requiredText(value) {
  return typeof value === 'string' ? value.trim() : (value == null ? '' : String(value).trim());
}

/**
 * Selecciona los documentos oficiales publicados de un proceso, sin filtrarlos por
 * nombre, y enumera de forma determinista todo lo que el tope deja fuera.
 *
 * Devuelve `{ selected, omitted, coverage }`: `selected` son los documentos
 * originales (mismo objeto, mismo orden de publicación), `omitted` la enumeración
 * de lo no traído y `coverage` la forma cerrada y auditable que consumen la traza
 * del refresco, el evento de descubrimiento y los gaps del inventario.
 */
export function selectTenderOfficialDocuments(documents, options = {}) {
  const {
    nameGetter = defaultNameGetter,
    idGetter = defaultIdGetter,
    cap = TENDER_OFFICIAL_DOCUMENT_SELECTION_CAP,
  } = options;
  if (!Number.isInteger(cap) || cap < 0) {
    throw new Error('El tope de selección documental oficial debe ser un entero no negativo.');
  }

  // Fail-closed sobre identidad: nada entra ni se omite anónimamente. Se valida
  // todo el proceso, no solo lo seleccionado, porque un omitido sin identidad
  // estable sería un hueco que nadie puede volver a pedir.
  const identified = (Array.isArray(documents) ? documents : []).map((document, index) => {
    const documentId = requiredText(idGetter(document));
    if (!documentId) {
      throw new Error(`El documento oficial en la posición ${index} no tiene identidad estable de origen.`);
    }
    const name = requiredText(nameGetter(document));
    if (!name) {
      throw new Error(`El documento oficial ${documentId} no tiene nombre para enumerarse.`);
    }
    return { document, document_id: documentId, name };
  });

  const selected = identified.slice(0, cap).map(entry => entry.document);
  const omitted = identified.slice(cap).map(entry => ({
    document_id: entry.document_id,
    name: entry.name,
    reason: TENDER_OFFICIAL_DOCUMENT_OMITTED_REASON,
  }));

  return {
    selected,
    omitted,
    coverage: {
      // Un proceso sin documentos publicados no es una cobertura parcial: no hay
      // nada omitido que reclamar.
      status: omitted.length ? 'partial' : 'complete',
      total_official_documents: identified.length,
      selected_count: selected.length,
      omitted_count: omitted.length,
      omitted_documents: omitted,
    },
  };
}

/**
 * Traduce una cobertura documental oficial a los gaps que consume
 * `buildTenderRequirementInventory({ documentGaps })`. No inventa huecos: una
 * cobertura completa (o ausente) produce una lista vacía.
 */
export function tenderOfficialCoverageGaps(coverage) {
  const omitted = Array.isArray(coverage?.omitted_documents) ? coverage.omitted_documents : [];
  return omitted.map(item => ({ document_id: item.document_id, reason: item.reason }));
}
