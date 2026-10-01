// Componente de Servicio v2 data-driven, integrado directamente (sin modo sombra)
// como el eje A (Servicio) de la fórmula canónica de producción tender-fit-v2.
// Ver docs/superpowers/specs/2026-10-01-agt002-service-matrix-v2-shadow.md para el contrato original de diseño.

export const TENDER_SERVICE_MATRIX_V2_VERSION = 'tender-service-matrix-v2';
export const TENDER_SERVICE_MATRIX_V2_ROLES = Object.freeze(['ANCLA', 'AMBIGUA', 'CONTEXTO', 'EXCLUSION']);
export const TENDER_SERVICE_MATRIX_V2_FAMILIES = Object.freeze(['FISICA', 'ELECTRONICA', 'SUMINISTRO']);

const COMBINING_DIACRITICS_REGEX = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, 'g');

function normalizeTenderServiceMatrixV2Text(value) {
  return String(value || '').normalize('NFD').replace(COMBINING_DIACRITICS_REGEX, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const RETIRED_TERMS_NORMALIZED = new Set(
  ['transporte de valores', 'custodia y transporte de valores', 'manejo de valores'].map(normalizeTenderServiceMatrixV2Text),
);

function matrixRow(term, role, family, strength, active = true) {
  return Object.freeze({ term, role, family, strength, active });
}

const ANCLA_FISICA_TERMS = [
  'vigilancia y seguridad privada', 'vigilancia y seguridad', 'servicio de vigilancia', 'servicios de vigilancia',
  'vigilancia privada', 'vigilancia armada', 'seguridad privada', 'vigilancia fisica', 'puesto de vigilancia',
  'puestos de vigilancia', 'guarda de seguridad', 'guardas de seguridad', 'personal de vigilancia', 'medio humano',
  'medios humanos', 'vigilancia y proteccion', 'proteccion de bienes y personas', 'servicio canino',
  'vigilancia canina', 'medio canino', 'supervision movil', 'vigilancia movil',
];

const AMBIGUA_FISICA_TERMS = [
  'escolta', 'escoltas', 'proteccion a personas', 'vigilancia', 'custodia', 'guardas', 'porteria', 'recepcion',
];

const ANCLA_ELECTRONICA_TERMS = [
  'seguridad electronica', 'cctv', 'videovigilancia', 'video vigilancia', 'circuito cerrado',
  'circuito cerrado de television', 'control de acceso', 'medios tecnologicos', 'medio tecnologico',
  'monitoreo de alarmas', 'sistema de alarma', 'sistemas de alarma', 'deteccion de intrusion',
  'control de acceso biometrico', 'sistema de videovigilancia', 'monitoreo electronico',
];

const AMBIGUA_ELECTRONICA_TERMS = [
  'central de monitoreo', 'camaras de seguridad', 'detector de metales', 'arco detector', 'monitoreo', 'alarma',
  'biometrico', 'biometria', 'seguridad perimetral',
];

const ANCLA_SUMINISTRO_TERMS = [
  'suministro e instalacion de camaras', 'suministro e instalacion de cctv', 'suministro de equipos de seguridad',
  'instalacion de sistema de videovigilancia', 'mantenimiento de cctv', 'mantenimiento de camaras',
  'mantenimiento de sistema de seguridad', 'actualizacion tecnologica de seguridad', 'repotenciacion de cctv',
  'ampliacion de sistema de videovigilancia', 'suministro de equipos de control de acceso',
  'instalacion de control de acceso', 'soporte tecnico cctv',
];

const CONTEXTO_TERMS = [
  'con armas', 'sin armas', 'puesto fijo', 'puesto movil', '24 horas', '24 7', 'turno', 'turnos', 'supervisor',
  'rondas', 'sedes institucionales', 'proteccion de instalaciones', 'supervigilancia',
  'superintendencia de vigilancia', 'licencia de funcionamiento', 'decreto 356',
  'salario minimo legal mensual vigente', 'smlmv', 'smmlv', 'cedi', 'bodega', 'planta fisica', 'instalaciones',
  'operador de medios tecnologicos', 'omt',
];

const EXCLUSION_DURA_TERMS = [
  'vigilancia epidemiologica', 'vigilancia sanitaria', 'vigilancia fitosanitaria', 'vigilancia veterinaria',
  'monitoreo epidemiologico', 'vigilancia tecnologica', 'vigilancia judicial', 'seguridad informatica',
  'ciberseguridad', 'seguridad de la informacion', 'seguridad y salud en el trabajo', 'sst', 'seguridad vial',
  'seguridad alimentaria', 'seguridad social', 'custodia documental', 'custodia de archivo', 'gestion documental',
  'interventoria',
];

const EXCLUSION_CONDICIONAL_TERMS = [
  'blindaje', 'blindaje vehicular', 'vehiculo blindado', 'radiocomunicaciones', 'telecomunicaciones',
  'redes de comunicacion', 'equipos de comunicacion',
];

const TENDER_SERVICE_MATRIX_V2_RAW = Object.freeze([
  ...ANCLA_FISICA_TERMS.map(term => matrixRow(term, 'ANCLA', 'FISICA', null)),
  ...AMBIGUA_FISICA_TERMS.map(term => matrixRow(term, 'AMBIGUA', 'FISICA', null)),
  ...ANCLA_ELECTRONICA_TERMS.map(term => matrixRow(term, 'ANCLA', 'ELECTRONICA', null)),
  ...AMBIGUA_ELECTRONICA_TERMS.map(term => matrixRow(term, 'AMBIGUA', 'ELECTRONICA', null)),
  ...ANCLA_SUMINISTRO_TERMS.map(term => matrixRow(term, 'ANCLA', 'SUMINISTRO', null)),
  ...CONTEXTO_TERMS.map(term => matrixRow(term, 'CONTEXTO', null, null)),
  ...EXCLUSION_DURA_TERMS.map(term => matrixRow(term, 'EXCLUSION', null, 'dura')),
  ...EXCLUSION_CONDICIONAL_TERMS.map(term => matrixRow(term, 'EXCLUSION', null, 'condicional')),
]);

export class TenderServiceMatrixV2ValidationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'TenderServiceMatrixV2ValidationError';
    this.code = code;
  }
}

export function validateTenderServiceMatrixV2({ version, rows }) {
  if (typeof version !== 'string' || version.trim().length === 0) {
    throw new TenderServiceMatrixV2ValidationError('version_vacia: la versión de la matriz no puede estar vacía', 'version_vacia');
  }
  if (!Array.isArray(rows)) {
    throw new TenderServiceMatrixV2ValidationError('rows_invalido: rows debe ser un arreglo', 'rows_invalido');
  }

  const normalizedActiveTerms = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      throw new TenderServiceMatrixV2ValidationError('fila_invalida: cada fila debe ser un objeto', 'fila_invalida');
    }
    if (Object.prototype.hasOwnProperty.call(row, 'points')) {
      throw new TenderServiceMatrixV2ValidationError(`fila_con_points: la fila "${row.term}" no debe tener la propiedad points`, 'fila_con_points');
    }
    if (typeof row.term !== 'string' || row.term.trim().length === 0) {
      throw new TenderServiceMatrixV2ValidationError('termino_invalido: term debe ser un string no vacío', 'termino_invalido');
    }
    if (row.term.includes('.')) {
      throw new TenderServiceMatrixV2ValidationError(`termino_con_punto: el término "${row.term}" no puede contener '.'`, 'termino_con_punto');
    }
    if (!TENDER_SERVICE_MATRIX_V2_ROLES.includes(row.role)) {
      throw new TenderServiceMatrixV2ValidationError(`rol_invalido: rol "${row.role}" no reconocido`, 'rol_invalido');
    }
    if (row.family !== null && !TENDER_SERVICE_MATRIX_V2_FAMILIES.includes(row.family)) {
      throw new TenderServiceMatrixV2ValidationError(`familia_invalida: familia "${row.family}" no reconocida`, 'familia_invalida');
    }
    if (row.role === 'AMBIGUA' && row.family === null) {
      throw new TenderServiceMatrixV2ValidationError(`ambigua_sin_familia: la fila "${row.term}" de rol AMBIGUA requiere family`, 'ambigua_sin_familia');
    }
    if (row.role === 'ANCLA' && row.family === null) {
      throw new TenderServiceMatrixV2ValidationError(`ancla_sin_familia: la fila "${row.term}" de rol ANCLA requiere family`, 'ancla_sin_familia');
    }
    if (row.role === 'EXCLUSION' && row.family !== null) {
      throw new TenderServiceMatrixV2ValidationError(`exclusion_con_familia: la fila "${row.term}" de rol EXCLUSION no debe tener family`, 'exclusion_con_familia');
    }
    if (row.role === 'EXCLUSION') {
      if (row.strength !== 'dura' && row.strength !== 'condicional') {
        throw new TenderServiceMatrixV2ValidationError(`strength_invalido: la fila "${row.term}" de rol EXCLUSION requiere strength 'dura' o 'condicional'`, 'strength_invalido');
      }
    } else if (row.strength !== null) {
      throw new TenderServiceMatrixV2ValidationError(`strength_invalido: la fila "${row.term}" de rol ${row.role} debe tener strength null`, 'strength_invalido');
    }

    const normalizedTerm = normalizeTenderServiceMatrixV2Text(row.term);
    if (RETIRED_TERMS_NORMALIZED.has(normalizedTerm)) {
      throw new TenderServiceMatrixV2ValidationError(`termino_retirado: el término "${row.term}" fue retirado y no puede aparecer en la matriz`, 'termino_retirado');
    }
    if (row.active) {
      if (normalizedActiveTerms.has(normalizedTerm)) {
        throw new TenderServiceMatrixV2ValidationError(`termino_duplicado: el término "${row.term}" está duplicado entre filas activas`, 'termino_duplicado');
      }
      normalizedActiveTerms.add(normalizedTerm);
    }
  }
  return rows;
}

validateTenderServiceMatrixV2({ version: TENDER_SERVICE_MATRIX_V2_VERSION, rows: TENDER_SERVICE_MATRIX_V2_RAW });

export const TENDER_SERVICE_MATRIX_V2 = TENDER_SERVICE_MATRIX_V2_RAW;

const FIELD_ORDER = Object.freeze(['title', 'description', 'detail']);

// Tokeniza el texto normalizado (palabras separadas por un único espacio, sin bordes)
// en { word, start, end } con posiciones en el propio texto normalizado, para poder
// comparar spans de ocurrencias en vez de solo presencia booleana por término.
function tokenizeNormalizedField(normalizedText) {
  const tokens = [];
  if (!normalizedText) return tokens;
  let cursor = 0;
  for (const word of normalizedText.split(' ')) {
    const start = cursor;
    const end = start + word.length;
    tokens.push({ word, start, end });
    cursor = end + 1;
  }
  return tokens;
}

// Encuentra todas las ocurrencias (no solapadas entre sí por construcción: se avanza
// token a token) de la secuencia exacta de palabras del término dentro de los tokens
// del campo, devolviendo el span [start, end) de cada ocurrencia en el texto normalizado.
function findTermOccurrences(fieldTokens, termWords) {
  const occurrences = [];
  const n = termWords.length;
  if (n === 0) return occurrences;
  for (let i = 0; i + n <= fieldTokens.length; i++) {
    let matched = true;
    for (let j = 0; j < n; j++) {
      if (fieldTokens[i + j].word !== termWords[j]) { matched = false; break; }
    }
    if (matched) {
      occurrences.push({ start: fieldTokens[i].start, end: fieldTokens[i + n - 1].end });
    }
  }
  return occurrences;
}

export function evaluateTenderServiceMatrixV2({ title, description, detail } = {}) {
  const normalizedFields = {
    title: normalizeTenderServiceMatrixV2Text(title),
    description: normalizeTenderServiceMatrixV2Text(description),
    detail: normalizeTenderServiceMatrixV2Text(detail),
  };
  const fieldTokens = {
    title: tokenizeNormalizedField(normalizedFields.title),
    description: tokenizeNormalizedField(normalizedFields.description),
    detail: tokenizeNormalizedField(normalizedFields.detail),
  };

  const matches = [];
  for (const field of FIELD_ORDER) {
    const tokens = fieldTokens[field];
    for (const row of TENDER_SERVICE_MATRIX_V2) {
      if (!row.active) continue;
      const termWords = normalizeTenderServiceMatrixV2Text(row.term).split(' ').filter(word => word.length > 0);
      for (const span of findTermOccurrences(tokens, termWords)) {
        matches.push({ row, field, start: span.start, end: span.end });
      }
    }
  }

  // Spans de anclas SUMINISTRO por campo, usados para absorber anclas ELECTRONICA
  // cuyo span queda completamente contenido dentro de uno de ellos (spec §4.3.1).
  const suministroSpansByField = { title: [], description: [], detail: [] };
  for (const match of matches) {
    if (match.row.role === 'ANCLA' && match.row.family === 'SUMINISTRO') {
      suministroSpansByField[match.field].push({ start: match.start, end: match.end });
    }
  }
  function isAbsorbedBySuministro(match) {
    return suministroSpansByField[match.field].some(
      span => match.start >= span.start && match.end <= span.end,
    );
  }

  const anchoredFamilies = new Set();
  const ambiguaTermsFound = new Set();
  const contextTermsFound = new Set();
  for (const match of matches) {
    const { row } = match;
    if (row.role === 'ANCLA') {
      if (row.family === 'ELECTRONICA' && isAbsorbedBySuministro(match)) continue;
      anchoredFamilies.add(row.family);
    } else if (row.role === 'AMBIGUA') ambiguaTermsFound.add(normalizeTenderServiceMatrixV2Text(row.term));
    else if (row.role === 'CONTEXTO') contextTermsFound.add(normalizeTenderServiceMatrixV2Text(row.term));
  }
  const hasAnchor = anchoredFamilies.size > 0;

  const duraExcludes = matches.some(({ row, field }) => row.role === 'EXCLUSION' && row.strength === 'dura' && field === 'title');
  const condicionalExcludes = !hasAnchor && matches.some(({ row }) => row.role === 'EXCLUSION' && row.strength === 'condicional');

  let excluded = false;
  let exclusionRule = null;
  if (duraExcludes) {
    excluded = true;
    exclusionRule = 'dura';
  } else if (condicionalExcludes) {
    excluded = true;
    exclusionRule = 'condicional';
  }

  let family = null;
  let points = 0;
  let status = 'FUERA_DE_ALCANCE';

  if (!excluded) {
    const fisica = anchoredFamilies.has('FISICA');
    const electronica = anchoredFamilies.has('ELECTRONICA');
    const suministro = anchoredFamilies.has('SUMINISTRO');
    if (fisica && electronica) {
      family = 'HIBRIDA'; points = 50; status = 'EN_ALCANCE';
    } else if (electronica) {
      family = 'ELECTRONICA'; points = 48; status = 'EN_ALCANCE';
    } else if (fisica) {
      family = 'FISICA'; points = 45; status = 'EN_ALCANCE';
    } else if (suministro) {
      family = 'SUMINISTRO'; points = 40; status = 'EN_ALCANCE';
    } else if (ambiguaTermsFound.size >= 1 && contextTermsFound.size >= 2) {
      family = 'AMBIGUA'; points = 30; status = 'POR_VALIDAR';
    }
  } else {
    status = 'EXCLUIDA';
  }

  const ambiguaConfirmed = family === 'AMBIGUA';

  const trace = matches.map(match => {
    const { row, field } = match;
    const { term, role, family: rowFamily } = row;
    if (role === 'ANCLA') {
      if (rowFamily === 'ELECTRONICA' && isAbsorbedBySuministro(match)) {
        return { term, role, family: rowFamily, field, rule: 'ancla_absorbida_por_suministro', verdict: 'absorbida_por_suministro' };
      }
      return { term, role, family: rowFamily, field, rule: 'ancla_familia', verdict: 'incluido' };
    }
    if (role === 'AMBIGUA') {
      return ambiguaConfirmed
        ? { term, role, family: rowFamily, field, rule: 'ambigua_confirmada', verdict: 'confirma' }
        : { term, role, family: rowFamily, field, rule: 'ambigua_sin_confirmar', verdict: 'sin_confirmar' };
    }
    if (role === 'CONTEXTO') {
      return ambiguaConfirmed
        ? { term, role, family: rowFamily, field, rule: 'contexto_confirma', verdict: 'confirma' }
        : { term, role, family: rowFamily, field, rule: 'contexto_no_confirma', verdict: 'sin_confirmar' };
    }
    if (row.strength === 'dura') {
      return field === 'title'
        ? { term, role, family: rowFamily, field, rule: 'exclusion_dura_title', verdict: 'excluye' }
        : { term, role, family: rowFamily, field, rule: 'exclusion_dura_ignorada_campo_secundario', verdict: 'ignorado_campo_secundario' };
    }
    return hasAnchor
      ? { term, role, family: rowFamily, field, rule: 'exclusion_condicional_ignorada_por_ancla', verdict: 'ignorado_por_ancla' }
      : { term, role, family: rowFamily, field, rule: 'exclusion_condicional_excluye', verdict: 'excluye' };
  });

  return {
    matrix_version: TENDER_SERVICE_MATRIX_V2_VERSION,
    family,
    points,
    status,
    excluded,
    exclusion_rule: exclusionRule,
    trace,
  };
}
