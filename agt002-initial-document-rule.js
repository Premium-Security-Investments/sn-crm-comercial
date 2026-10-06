// AGT-002 INITIAL — the document selection rule (approved by the owner, 2026-10-06), shared by the manual manifest
// builder and the automatic admission after a conversion. Every current official document with extracted text goes in,
// ordered by decision weight, EXCEPT types that do not define requirements or conditions (compressed quotes, BP/EBI
// investment files, the structuring-team designation, internal filings). Documents without text are excluded with
// their gap.

const EXCLUDE = [
  [/cotizaci/i, 'cotizaciones de terceros: precios de referencia, no definen requisitos'],
  [/(^|[^a-z])(detallado\s+)?bp[-_ ]?\d|ficha[_ ]?ebi/i, 'ficha del proyecto de inversión (BP/EBI): no define requisitos del proceso'],
  [/designaci[oó]n\s+(del\s+)?equipo/i, 'designación del equipo estructurador: documento interno de la entidad'],
  [/^radicado|^\d{6,}\.pdf$/i, 'radicado u oficio interno sin requisitos'],
];

const INCLUDE = [
  [/adenda/i, 0, 'Adenda: modifica el pliego; prevalece sobre la versión anterior.'],
  [/pliego/i, 1, 'Pliego de condiciones: reglas, requisitos habilitantes, criterios de evaluación y causales de rechazo.'],
  [/respuesta|observaci/i, 2, 'Respuestas a observaciones: aclaran o modifican requisitos.'],
  [/aviso|convocatoria/i, 3, 'Aviso de convocatoria: datos del proceso y cronograma.'],
  [/estudios?[\s_]+previos?/i, 4, 'Estudios previos: necesidad, alcance, presupuesto, riesgos y garantías.'],
  [/anexo[\s_]+t[eé]cnico|especificaciones|esp\.?[\s_]+t[eé]cnicas|requerimiento[\s_]+t[eé]cnico/i, 5, 'Anexo técnico: especificaciones del servicio y obligaciones.'],
  [/matriz.*riesgo|riesgo/i, 6, 'Matriz de riesgos: asignación de riesgos entre las partes.'],
  [/experiencia/i, 7, 'Formato de experiencia: cómo se acredita la experiencia del proponente.'],
  [/oferta\s+econ|presupuesto|memoria\s+de\s+c[aá]lculo|estudio\s+de\s+mercado|costos?/i, 8, 'Oferta económica y presupuesto: estructura de precios y techos.'],
  [/an[aá]lisis\s+del\s+sector/i, 9, 'Análisis del sector: mercado, precios de referencia e indicadores exigidos.'],
  [/capacidad\s+financiera|financier/i, 10, 'Estudio de capacidad financiera: indicadores exigidos.'],
  [/anexo|formato/i, 11, 'Anexos y formatos de la propuesta: lo que se debe diligenciar y presentar.'],
  [/cdp|vigencia|hacienda|registro|disponibilidad/i, 12, 'Documento presupuestal (CDP, vigencias futuras, aprobación de Hacienda): respaldo y coherencia del presupuesto.'],
  [/concepto|matriz/i, 13, 'Concepto o matriz del proceso: soporte técnico o jurídico del proceso.'],
];

export function classifyAgt002InitialDocument({ name, hasText, gapReason }) {
  if (!hasText) return { include: false, reason: `sin texto extraído${gapReason ? ` (${gapReason})` : ''}: no se puede leer` };
  for (const [pattern, reason] of EXCLUDE) if (pattern.test(name)) return { include: false, reason };
  for (const [pattern, rank, reason] of INCLUDE) if (pattern.test(name)) return { include: true, rank, reason };
  return { include: true, rank: 14, reason: 'Documento oficial vigente del proceso.' };
}


/**
 * Applies the rule to an opportunity's current document versions and their extractions (latest per version wins).
 * Returns the included rows, ordered by decision weight then size, and the excluded rows with their reason.
 */
export function selectAgt002InitialDocuments(versions, extractions) {
  const latest = {};
  for (const extraction of extractions || []) {
    const id = extraction.document_version_id;
    if (!latest[id] || extraction.created_at > latest[id].created_at) latest[id] = extraction;
  }
  const rows = (versions || []).map(version => {
    const extraction = latest[version.id];
    const hasText = extraction?.status === 'ok' && Number(extraction.char_count) > 0;
    return { version, chars: Number(extraction?.char_count || 0), ...classifyAgt002InitialDocument({ name: version.name, hasText, gapReason: extraction?.gap_reason }) };
  });
  return {
    included: rows.filter(row => row.include).sort((a, b) => a.rank - b.rank || b.chars - a.chars),
    excluded: rows.filter(row => !row.include),
  };
}

/** The manifest/admission members for the included documents. */
export function agt002InitialRequestedMembers(included) {
  return included.map(row => ({ document_version_id: row.version.id, source_classification: 'official', inclusion_reason: row.reason.slice(0, 500) }));
}
