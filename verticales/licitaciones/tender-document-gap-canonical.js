// Vocabulario cerrado del hueco documental gobernado.
//
// Un hueco es un HECHO del expediente, no una nota al margen: entra en el insumo
// canónico del snapshot (tender-analysis-foundation.js), queda escrito en el
// manifiesto inmutable que publica la RPC gobernada, y AGT-002 lo vuelve a leer
// de ahí (agt002-tender-requirement-gaps.js). Como es el mismo hecho recorriendo
// tres capas, se canoniza en un solo sitio: cuatro claves, ni una más.
//
// Las cuatro claves son exactamente las que consume
// `buildTenderRequirementInventory({ documentGaps })`. Nada de texto extraído,
// rutas de almacenamiento, URLs firmadas ni mensajes de error puede entrar aquí:
// el hueco se presenta a un humano y viaja por la API, así que arrastrar una
// descarga lo convertiría en un canal de fuga (y, del lado del consumidor, en un
// vector SSRF). Cualquier clave ajena se descarta al canonizar, no se propaga.
//
// El módulo es puro y determinista: sin red, sin reloj, sin aleatoriedad y sin
// acceso a almacenamiento.

function closedText(value) {
  const text = typeof value === 'string' ? value.trim() : (value == null ? '' : String(value).trim());
  return text || null;
}

/**
 * Canoniza un hueco a su forma cerrada de 4 claves. Falla cerrado: un hueco sin
 * identidad documental o sin motivo no es enumerable, y degradarlo a "no hay
 * hueco" es exactamente lo que este vocabulario existe para impedir.
 */
export function canonicalTenderDocumentGap(gap) {
  const documentId = closedText(gap?.document_id);
  if (!documentId) throw new Error('Un hueco documental sin identidad de documento no es enumerable.');
  const reason = closedText(gap?.reason);
  if (!reason) throw new Error(`El hueco documental de ${documentId} no declara un motivo cerrado.`);
  return {
    document_id: documentId,
    document_type: closedText(gap?.document_type),
    name: closedText(gap?.name),
    reason,
  };
}

/**
 * Orden canónico: por identidad documental, luego por motivo y, solo para
 * desempatar filas que colapsan en el mismo hueco, por nombre. Nunca depende del
 * orden en que el importador, el manifiesto o la base devolvieron las filas.
 */
export function compareTenderDocumentGaps(left, right) {
  return left.document_id.localeCompare(right.document_id)
    || left.reason.localeCompare(right.reason)
    || String(left.name).localeCompare(String(right.name));
}

/**
 * Canoniza, ordena y deduplica una enumeración de huecos.
 *
 * La deduplicación es por (document_id, reason): el mismo documento ausente por
 * el mismo motivo es un solo hueco, llegue por el manifiesto inmutable, por los
 * import items del job o por ambos. El inventario trata un par duplicado como
 * entrada corrupta y se niega a construirse, así que colapsarlo aquí es parte
 * del contrato. Se ordena ANTES de deduplicar para que qué fila física "gana"
 * sea función de los datos y nunca del orden de llegada.
 *
 * Una enumeración ausente (manifiesto histórico sin `document_gaps`) es una
 * lista vacía; una enumeración presente pero que no es lista falla cerrado.
 */
export function canonicalizeTenderDocumentGaps(gaps) {
  if (gaps == null) return [];
  if (!Array.isArray(gaps)) throw new Error('La enumeración de huecos documentales debe ser una lista.');
  const seen = new Set();
  return gaps
    .map(canonicalTenderDocumentGap)
    .sort(compareTenderDocumentGaps)
    .filter(gap => {
      const key = JSON.stringify([gap.document_id, gap.reason]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
