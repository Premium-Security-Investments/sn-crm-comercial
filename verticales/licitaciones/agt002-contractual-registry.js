// AGT-002 — Constructor del REGISTRO CONTRACTUAL EXHAUSTIVO (Rama Judicial Manizales
// SA-24-2026).
//
// Módulo puro y determinista: recibe los documentos oficiales (texto ya extraído) y produce
// un registro auditable y regenerable de TODOS los requisitos del pliego vigente, no sólo
// los cuatro del extractor cerrado (tender-requirement-extraction.js). No accede a Supabase,
// red, disco ni secretos: la carga de documentos vive en el script generador (offline) y las
// rutas de servidor. Falla en cerrado: ante ambigüedad, abstiene y registra el gap; nunca
// inventa un requisito ni decide cumplimiento.
//
// Estructura reusada como PATRÓN del expediente adjudicado Pereira (catálogo, matriz
// requisito→evidencia, escalera probatoria, ledger) — jamás como prueba de Manizales.

import {
  AGT002_CONTRACTUAL_REGISTRY_TAXONOMY_VERSION,
  REGISTRO_LIMITES_PROBATORIOS,
  faseParaNumeralCapitulo,
  scrubOpenPii,
} from './agt002-contractual-registry-taxonomy.js';
import { AGT002_GOVERNED_REQUIREMENT_CITATION_PATTERNS } from './tender-requirement-extraction.js';

export const AGT002_CONTRACTUAL_REGISTRY_ARTIFACT_TYPE = 'agt002_contractual_registry';
export const AGT002_CONTRACTUAL_REGISTRY_STATUS = 'draft_for_human_review';
export const AGT002_CONTRACTUAL_REGISTRY_VERSION = 1;

const DIACRITIC_MARKS = /[̀-ͯ]/g;
const EXCERPT_MAX = 240;

function normalizeContent(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

function searchNormalize(value) {
  return String(value ?? '').toLowerCase().normalize('NFD').replace(DIACRITIC_MARKS, '');
}

function collapse(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function documentIdentity(document) {
  const id = document?.id ?? document?.document_id;
  if (!id || typeof id !== 'string') {
    throw new Error('Cada documento requiere un identificador estable para el registro contractual.');
  }
  return id;
}

function documentContent(document) {
  return normalizeContent(document?.content ?? document?.extracted_text ?? '');
}

// Excerpt acotado y depurado de PII, listo para artefacto abierto.
function safeExcerpt(content, start, end) {
  const raw = collapse(content.slice(start, Math.min(end, start + EXCERPT_MAX * 3)));
  return scrubOpenPii(raw).slice(0, EXCERPT_MAX);
}

// --- 1. Procedencia / vigencia documental --------------------------------------------
//
// Distingue pliego vigente (definitivo) de proyecto, respuesta a observaciones, estudios y
// anexos. Determinista por document_type + nombre normalizado. No traslada vigencia por
// similitud: si no puede resolver un único pliego definitivo, lo dice y abstiene.

function classifyOne(document) {
  const type = searchNormalize(document.document_type);
  const name = searchNormalize(document.name);
  if (type === 'pliego' || name.includes('pliego')) {
    if (name.includes('definitiv')) return { provenance_kind: 'pliego_definitivo', vigencia: 'vigente' };
    // La respuesta a observaciones nombra "al proyecto del pliego"; se resuelve ANTES de
    // "proyecto" para no confundirla con el proyecto de pliego.
    if (name.includes('respuesta') || name.includes('observacion')) {
      return { provenance_kind: 'respuesta_observaciones', vigencia: 'historico' };
    }
    if (name.includes('proyecto')) return { provenance_kind: 'pliego_proyecto', vigencia: 'superseded' };
    return { provenance_kind: 'pliego_proyecto', vigencia: 'no_determinado' };
  }
  if (type === 'estudios_previos' || name.includes('estudios')) {
    if (name.includes('sector')) return { provenance_kind: 'estudios_sector', vigencia: 'soporte' };
    return { provenance_kind: 'estudios_previos', vigencia: 'soporte' };
  }
  if (name.includes('oferta economica')) {
    // El Anexo 9 "Ajustado" es la oferta económica definitiva (§3.6 del pliego); la versión
    // previa queda superseded.
    return name.includes('ajustad')
      ? { provenance_kind: 'anexo_oferta_economica', vigencia: 'vigente' }
      : { provenance_kind: 'anexo_oferta_economica', vigencia: 'superseded' };
  }
  if (name.includes('anexo') || type === 'anexo_tecnico') {
    // Formatos que el proponente diligencia vs anexos normativos (requisitos a cumplir).
    if (/(carta|presentacion|conformacion|formato|acreditaci)/.test(name)) {
      return { provenance_kind: 'anexo_formato', vigencia: 'soporte' };
    }
    if (/(sgsst|requisitos|programa|ambiental|gestion)/.test(name)) {
      return { provenance_kind: 'anexo_requisito', vigencia: 'soporte' };
    }
    return { provenance_kind: 'anexo', vigencia: 'soporte' };
  }
  return { provenance_kind: 'otro', vigencia: 'no_determinado' };
}

export function classifyRegistroDocumentProvenance(documents) {
  const classified = (documents || [])
    .map(document => {
      const document_id = documentIdentity(document);
      const base = { document_id, name: String(document?.name ?? ''), document_type: String(document?.document_type ?? '') };
      const verdict = classifyOne(base);
      return { ...base, ...verdict, is_vigente_pliego: false };
    })
    .sort((a, b) => a.document_id.localeCompare(b.document_id));

  const definitivos = classified.filter(d => d.provenance_kind === 'pliego_definitivo');
  const data_gaps = [];
  let vigente_pliego;
  if (definitivos.length === 1) {
    definitivos[0].is_vigente_pliego = true;
    vigente_pliego = { resolved: true, document_id: definitivos[0].document_id, name: definitivos[0].name };
  } else {
    vigente_pliego = {
      resolved: false,
      reason: definitivos.length === 0 ? 'no_definitivo_pliego_found' : 'multiple_definitivo_pliegos_found',
    };
    data_gaps.push({
      gap_id: 'vigente-pliego-unresolved',
      description: definitivos.length === 0
        ? 'No se identificó un pliego de condiciones definitivo (vigente) entre los documentos disponibles.'
        : `Se identificaron ${definitivos.length} pliegos "definitivo"; no se puede resolver un único pliego vigente sin revisión humana.`,
      affected_document_ids: definitivos.map(d => d.document_id),
    });
  }
  return { documents: classified, vigente_pliego, data_gaps };
}

// --- 2. Seccionador estructural del pliego vigente -----------------------------------
//
// Extrae las secciones numeradas (N.M / N.M.K) del CUERPO del pliego, excluyendo la tabla de
// contenido. El pliego escaneado lista TODOS los numerales seguidos en el índice y luego los
// re-declara en el cuerpo con prosa real. Dos guardas cooperan:
//
//   (1) `stripTableOfContents`: el índice es una corrida de >= TOC_MIN_RUN encabezados con
//       prosa intermedia mínima (sólo rótulos de capítulo o pie de página entre numerales).
//       El cuerpo, en cambio, tiene párrafos entre encabezados y nunca forma corridas así de
//       densas. Se excluye toda ocurrencia dentro de una corrida-índice — así ninguna sección
//       del índice llega al registro (antes, una 5.4 del índice cuyo "cuerpo aparente" llegaba
//       al rótulo del capítulo superaba el umbral y desplazaba a la 5.4 corporal).
//   (2) extensión-de-contenido: una sección se conserva/prefiere por su extensión hasta el
//       siguiente encabezado que NO es descendiente suyo (misma o menor profundidad). Así una
//       sección padre seguida INMEDIATAMENTE por su sub-numeral (p.ej. 5.4 → 5.4.1) no se
//       descarta por tener cuerpo directo diminuto: su contenido real incluye a sus hijos.
//
// La fase se deriva del entero inicial del numeral (robusto frente a rótulos romanos mal
// escaneados). char_end/body se mantienen hasta el siguiente encabezado (secciones no solapadas).

const NUMERAL_HEADING = /^[ \t]*(\d{1,2})\.(\d{1,2})(?:\.(\d{1,2}))?\.?[ \t]+(\p{Lu}[^\n]{2,110}?):?[ \t]*$/gmu;
const ITEM_HEADING = /^[ \t]*(\d{1,2})\.[ \t]+(\p{Lu}[^\n]{2,110}?):?[ \t]*$/gmu;
const MIN_BODY_CHARS = 40;
// Una corrida de encabezados con prosa intermedia por debajo de TOC_PROSE_MAX y de longitud
// >= TOC_MIN_RUN es una tabla de contenido. Márgenes holgados frente al documento real: entre
// numerales del índice la prosa (rótulo de capítulo + su subtítulo, o pie de página) queda muy
// por debajo del umbral, mientras que entre encabezados del cuerpo hay párrafos completos.
const TOC_PROSE_MAX = 100;
const TOC_MIN_RUN = 8;

function cleanTitle(raw) {
  return collapse(raw).replace(/\s*\(.*$/, '').slice(0, 110);
}

function isDescendantNumeral(child, parent) {
  return child.startsWith(`${parent}.`);
}

// Marca los encabezados que pertenecen a una corrida-índice (tabla de contenido). Enlaza
// encabezados consecutivos cuando la prosa entre ambos es mínima; una cadena de longitud
// >= TOC_MIN_RUN es índice. El cuerpo forma cadenas de longitud 1–2 (padre→hijo), nunca índice.
function tocHeadingFlags(raw, text) {
  const gapLen = raw.map((section, i) => {
    const nextStart = i + 1 < raw.length ? raw[i + 1].start : text.length;
    return collapse(text.slice(section.headingEnd, nextStart)).length;
  });
  const inToc = new Array(raw.length).fill(false);
  let i = 0;
  while (i < raw.length) {
    let j = i;
    while (j < raw.length - 1 && gapLen[j] <= TOC_PROSE_MAX) j += 1;
    if (j - i + 1 >= TOC_MIN_RUN) {
      for (let k = i; k <= j; k += 1) inToc[k] = true;
    }
    i = j + 1;
  }
  return inToc;
}

export function sectionizeVigentePliego(content) {
  const text = normalizeContent(content);
  const raw = [];
  for (const match of text.matchAll(NUMERAL_HEADING)) {
    raw.push({
      capitulo_int: Number(match[1]),
      numeral: match[3] ? `${match[1]}.${match[2]}.${match[3]}` : `${match[1]}.${match[2]}`,
      titulo: cleanTitle(match[4]),
      start: match.index,
      headingEnd: match.index + match[0].length,
    });
  }
  raw.sort((a, b) => a.start - b.start);

  // (1) Excluye los encabezados de la tabla de contenido.
  const inToc = tocHeadingFlags(raw, text);
  const body = raw.filter((_, i) => !inToc[i]);

  // char_end = inicio del siguiente encabezado (secciones no solapadas).
  for (let i = 0; i < body.length; i += 1) {
    body[i].end = i + 1 < body.length ? body[i + 1].start : text.length;
  }
  // (2) contentLen = extensión hasta el siguiente encabezado NO descendiente (incluye hijos):
  // una sección padre con sub-numeral inmediato conserva contenido real y no se descarta.
  for (let i = 0; i < body.length; i += 1) {
    let j = i + 1;
    while (j < body.length && isDescendantNumeral(body[j].numeral, body[i].numeral)) j += 1;
    const extentEnd = j < body.length ? body[j].start : text.length;
    body[i].contentLen = collapse(text.slice(body[i].headingEnd, extentEnd)).length;
  }

  // Dedup por numeral: conserva la ocurrencia con más contenido (cuerpo real sobre residual).
  const byNumeral = new Map();
  for (const section of body) {
    const prev = byNumeral.get(section.numeral);
    if (!prev || section.contentLen > prev.contentLen) byNumeral.set(section.numeral, section);
  }
  return [...byNumeral.values()]
    .filter(section => section.contentLen >= MIN_BODY_CHARS)
    .sort((a, b) => a.start - b.start)
    .map(section => ({
      numeral: section.numeral,
      capitulo_int: section.capitulo_int,
      titulo: section.titulo,
      fase: faseParaNumeralCapitulo(section.capitulo_int),
      char_start: section.start,
      char_end: section.end,
      body: text.slice(section.headingEnd, section.end),
    }));
}

// Sub-ítems enumerados dentro de una sección (p.ej. los 27 documentos de 2.1 CAPACIDAD
// JURÍDICA). Sólo se aceptan como enumeración si empiezan en 1 y hay al menos dos ítems.
function enumerateSubItems(body, sectionStart, fullContent) {
  const items = [];
  for (const match of body.matchAll(ITEM_HEADING)) {
    items.push({ ordinal: Number(match[1]), titulo: cleanTitle(match[2]), offset: match.index });
  }
  if (items.length < 2 || items[0].ordinal !== 1) return [];
  // Conserva el prefijo secuencial (1,2,3,…) para evitar arrastrar numerales sueltos.
  const sequential = [];
  let expected = 1;
  for (const item of items) {
    if (item.ordinal === expected) {
      sequential.push(item);
      expected += 1;
    }
  }
  return sequential.map(item => ({
    ordinal: item.ordinal,
    titulo: item.titulo,
    cite: {
      char_start: sectionStart + item.offset,
      excerpt: safeExcerpt(fullContent, sectionStart + item.offset, sectionStart + item.offset + 200),
    },
  }));
}

// --- 3. Extractores cerrados de umbral (misma disciplina que el extractor v2) ---------

const VALUE_TOKEN = /(?:\d{1,3}(?:[.,]\d+)?\s?%|\d[\d.,]*\s*sm[ml]{1,2}v|\d+\s*(?:anos?|meses?|dias?)|\d+(?:[.,]\d+)?)/gi;
const OPERATOR = /(mayor o igual|menor o igual|no inferior a|no menor a|igual o mayor|igual o superior|minimo|maximo|superior a|al menos)/;

const FINANCIAL_INDICATORS = [
  { etiqueta: 'capital_de_trabajo', kw: /capital de trabajo/ },
  { etiqueta: 'liquidez', kw: /liquidez/ },
  { etiqueta: 'endeudamiento', kw: /endeudamiento/ },
  { etiqueta: 'cobertura_de_intereses', kw: /cobertura de intereses/ },
  { etiqueta: 'rentabilidad_patrimonio', kw: /rentabilidad del patrimonio/ },
  { etiqueta: 'rentabilidad_activo', kw: /rentabilidad del activo/ },
];

function valueTokensNear(searchBody, idx, radius = 160) {
  const region = searchBody.slice(Math.max(0, idx - 20), idx + radius);
  const tokens = [...region.matchAll(VALUE_TOKEN)].map(m => collapse(m[0]));
  const operador = OPERATOR.test(region) ? (region.match(OPERATOR) || [])[0] : null;
  return { tokens, operador };
}

// Devuelve señales de umbral halladas en la sección. Etiquetadas cuando hay un indicador
// financiero reconocido; genéricas en otro caso. Nunca afirma el mapeo completo: adjunta
// las señales y marca la confianza; el mapeo fino es revisión humana.
function extractThresholdSignals(body) {
  const searchBody = searchNormalize(body);
  const senales = [];
  for (const { etiqueta, kw } of FINANCIAL_INDICATORS) {
    const m = kw.exec(searchBody);
    if (!m) continue;
    const { tokens, operador } = valueTokensNear(searchBody, m.index);
    if (tokens.length > 0) senales.push({ etiqueta, operador, valores: tokens.slice(0, 3) });
  }
  // Valor en SMMLV/SMLMV (experiencia, cuantía de amparos, etc.). Etiqueta genérica: el
  // registro no afirma a qué exigencia corresponde cada cifra, sólo que existe la señal.
  const smmlv = /(\d[\d.,]*)\s*sm[ml]{1,2}v/i.exec(body);
  if (smmlv) senales.push({ etiqueta: 'smmlv', operador: null, valores: [collapse(smmlv[0])] });
  return senales;
}

// --- 4. Inferencia de categoría (con abstención explícita) ----------------------------

const CATEGORY_KEYWORDS = [
  { categoria: 'financiero', kw: /(capacidad financiera|capital de trabajo|liquidez|endeudamiento|cobertura de intereses)/ },
  { categoria: 'organizacional', kw: /(capacidad organizacional|rentabilidad del patrimonio|rentabilidad del activo)/ },
  { categoria: 'experiencia', kw: /experiencia/ },
  { categoria: 'seguros_garantias', kw: /(garant|poliza|amparo|seguro de vida)/ },
  { categoria: 'licencias_sector', kw: /(licencia|superintendencia|supervigilancia)/ },
  { categoria: 'tecnico_sst_ambiental', kw: /(sg-sst|sgsst|seguridad y salud|salud ocupacional|ambiental)/ },
  { categoria: 'oferta_economica', kw: /(oferta economica|factor economico|tarifa minima)/ },
  { categoria: 'industria_nacional_diferencial', kw: /(industria nacional|mipyme|empresa de mujeres|emprendimiento|discapacidad)/ },
  { categoria: 'factor_evaluacion', kw: /(factor calidad|puntaje|puntos|criterio diferencial)/ },
  { categoria: 'personal', kw: /(personal|jefe o coordinador|coordinador de seguridad|carta de compromiso de personal)/ },
  { categoria: 'juridico', kw: /(capacidad juridica|carta de presentacion|representacion legal|constitucion|consorcio|union temporal|registro unico|rut|autorizacion)/ },
  { categoria: 'proceso', kw: /(cronograma|presupuesto|objeto|regimen juridico|apertura|adenda|subsanabilidad|rechazo|adjudicacion|liquidacion|supervision|multas|clausula penal)/ },
];

function inferCategoria(titulo, body) {
  // La cabecera es la señal autoritativa de categoría; el cuerpo sólo se usa cuando el
  // título no resuelve (evita que una mención incidental —p.ej. "póliza" citada dentro de
  // CAPACIDAD JURÍDICA— desplace la categoría real de la sección).
  const tituloNorm = searchNormalize(titulo);
  for (const { categoria, kw } of CATEGORY_KEYWORDS) {
    if (kw.test(tituloNorm)) return categoria;
  }
  const bodyNorm = searchNormalize(body.slice(0, 400));
  for (const { categoria, kw } of CATEGORY_KEYWORDS) {
    if (kw.test(bodyNorm)) return categoria;
  }
  return 'no_determinada';
}

const SUBSANABLE_CONTEXT = /no subsanable|no es subsanable|causal de rechazo|sera rechazad/;

function inferSubsanabilidad(body) {
  const hay = searchNormalize(body);
  if (SUBSANABLE_CONTEXT.test(hay)) return 'no_subsanable';
  return 'no_determinado';
}

// Cruce con los patrones cerrados del extractor gobernado v2: marca qué secciones tocan uno
// de los cuatro requisitos gobernados, mostrando que el registro los supera (superset).
function governedRequirementMatches(body) {
  const hay = searchNormalize(body);
  const matches = [];
  for (const [requirementId, patterns] of Object.entries(AGT002_GOVERNED_REQUIREMENT_CITATION_PATTERNS)) {
    if (patterns.some(pattern => pattern.test(hay))) matches.push(requirementId);
  }
  return matches;
}

// --- 5. Ensamblado del registro -------------------------------------------------------

// Identificador estable y determinista de una sección del registro: derivado del proceso y
// del numeral (la identidad estructural de la sección). Estable frente a re-extracciones
// cosméticas (no depende de offsets) y único porque el seccionador deduplica por numeral.
function itemId(proceso, numeral) {
  return `${proceso}#${numeral}`;
}

function buildItem(section, vigenciaPliego, fullContent, proceso) {
  const senales = extractThresholdSignals(section.body);
  const categoria = inferCategoria(section.titulo, section.body);
  const item_id = itemId(proceso, section.numeral);
  const sub_items = enumerateSubItems(section.body, section.char_start, fullContent)
    // sub_item_id estable = item_id del padre + ordinal secuencial (único dentro de la sección).
    .map(sub => ({ sub_item_id: `${item_id}#i${sub.ordinal}`, ...sub }));
  const governed = governedRequirementMatches(section.body);
  const item = {
    item_id,
    ref: section.numeral,
    numeral: section.numeral,
    titulo: section.titulo,
    fase: section.fase,
    categoria,
    estado_probatorio: 'requisito_pliego',
    dimensiones: {
      presencia: 'observado',
      vigencia: vigenciaPliego,
      aplicabilidad: 'no_determinada',
      cumplimiento: 'no_evaluado',
    },
    evidencia_empresarial: 'not_assessed',
    subsanabilidad: inferSubsanabilidad(section.body),
    umbral: {
      detectado: senales.length > 0,
      senales,
      confianza: senales.length > 0 ? 'medio' : 'bajo',
    },
    sub_items,
    governed_requirement_ids: governed,
    cite: {
      char_start: section.char_start,
      char_end: section.char_end,
      excerpt: safeExcerpt(fullContent, section.char_start, section.char_start + EXCERPT_MAX * 2),
    },
  };
  return item;
}

function summarizeCoverage(items) {
  const tally = (key) => items.reduce((acc, item) => {
    const value = key === 'fase' ? item.fase : item.categoria;
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
  const secciones_registradas = items.length;
  const subitems_detectados = items.reduce((acc, item) => acc + item.sub_items.length, 0);
  return {
    // Métricas separadas y honestas: una SECCIÓN registrada y un SUB-ÍTEM detectado son
    // unidades de distinto nivel. NO se suman: sumar secciones+subítems como si fueran
    // "requisitos atomizados" sobrecuenta (un subítem es un componente de su sección, no un
    // requisito jurídico independiente). El conteo de requisitos independientes es humano.
    secciones_registradas,
    subitems_detectados,
    secciones_con_subitems: items.filter(item => item.sub_items.length > 0).length,
    metrica_definiciones: {
      seccion_registrada: 'Encabezado numerado (N.M[.K]) del cuerpo del pliego vigente; unidad primaria del registro.',
      subitem_detectado: 'Ítem enumerado dentro de una sección; es un componente de la sección y NO, por sí solo, un requisito independiente.',
      atomizacion: 'La unidad atomizada del registro es la SECCIÓN. Los subítems se detectan pero no se cuentan como requisitos; secciones y subítems no se suman.',
    },
    // Alias retrocompatibles (conteo estructural), sin afirmar suma engañosa.
    total_items: secciones_registradas,
    con_umbral: items.filter(item => item.umbral.detectado).length,
    con_sub_items: items.filter(item => item.sub_items.length > 0).length,
    sub_items_totales: subitems_detectados,
    categoria_no_determinada: items.filter(item => item.categoria === 'no_determinada').length,
    tocan_requisito_gobernado: items.filter(item => item.governed_requirement_ids.length > 0).length,
    por_fase: tally('fase'),
    por_categoria: tally('categoria'),
  };
}

function buildAbstentions(items) {
  const abstentions = [];
  for (const item of items) {
    if (item.categoria === 'no_determinada') {
      abstentions.push({
        item_ref: item.ref,
        axis: 'categoria',
        reason: 'categoria_no_resuelta_por_reglas_cerradas',
        detail: `No se pudo mapear "${item.titulo}" a una categoría del vocabulario cerrado; requiere clasificación humana.`,
      });
    }
    if (!item.umbral.detectado && (item.fase === 'habilitante' || item.categoria === 'seguros_garantias')) {
      abstentions.push({
        item_ref: item.ref,
        axis: 'umbral',
        reason: 'umbral_no_extraido_por_reglas_cerradas',
        detail: `No se extrajo un umbral cuantitativo para "${item.titulo}"; el umbral/condición debe verificarse en el pliego.`,
      });
    }
    abstentions.push({
      item_ref: item.ref,
      axis: 'aplicabilidad',
      reason: 'aplicabilidad_depende_de_modalidad_del_proponente',
      detail: 'La aplicabilidad (persona natural/jurídica/consorcio/UT, régimen diferencial) es decisión humana.',
    });
  }
  return abstentions;
}

function buildLedger(items, provenance, vigentePliego) {
  const ledger = [];
  let n = 0;
  const push = (claim, evidence, type, confidence, limitation) => {
    n += 1;
    ledger.push({ id: `R${String(n).padStart(2, '0')}`, claim, evidence, type, confidence, limitation });
  };
  push(
    `El registro cataloga ${items.length} secciones del pliego vigente como requisitos del pliego.`,
    [vigentePliego.resolved ? vigentePliego.name : 'pliego vigente no resuelto'],
    'conteo_estructural',
    vigentePliego.resolved ? 'alto' : 'bajo',
    'El conteo es estructural (secciones numeradas), no una lista jurídica exhaustiva validada por humano.',
  );
  const habilitantes = items.filter(item => item.fase === 'habilitante');
  push(
    `Se registran ${habilitantes.length} secciones habilitantes (Capítulo II).`,
    habilitantes.map(item => item.numeral),
    'requisito_pliego',
    'alto',
    'Habilitante = CUMPLE/NO CUMPLE; el registro no decide el cumplimiento.',
  );
  const conUmbral = items.filter(item => item.umbral.detectado);
  push(
    `${conUmbral.length} secciones tienen al menos una señal de umbral extraída por reglas cerradas.`,
    conUmbral.map(item => item.numeral),
    'observado',
    'medio',
    'Las señales de umbral son indicios cuantitativos; el mapeo indicador→umbral y su suficiencia son revisión humana.',
  );
  // Distinción presencia-vs-postadjudicación (concern HR-003): la póliza RCE figura como
  // requisito habilitante (Cap. II) y como amparo de garantía postadjudicación (Cap. VI).
  // Se detecta por la señal cerrada `legal-rce-policy` en cada fase (robusto en datos reales).
  const rceHabilitante = items.some(item => item.fase === 'habilitante' && item.governed_requirement_ids.includes('legal-rce-policy'));
  const rcePost = items.some(item => item.fase === 'postadjudicacion' && item.governed_requirement_ids.includes('legal-rce-policy'));
  if (rceHabilitante && rcePost) {
    push(
      'La póliza de RCE figura como requisito habilitante y como amparo de garantía postadjudicación; son exigencias distintas (presencia habilitante ≠ garantía de ejecución).',
      ['Capítulo II', 'Capítulo VI 6.5'],
      'contradiccion',
      'medio',
      'No se resuelve la relación entre ambas exigencias: distinguir habilitante de garantía de ejecución es interpretación humana.',
    );
  }
  for (const limite of REGISTRO_LIMITES_PROBATORIOS) {
    push(limite, ['taxonomía del registro'], 'limite_probatorio', 'alto', 'Guarda de no automatización.');
  }
  push(
    'Los excerpts del registro pasan por un depurador de PII antes de persistir.',
    ['scrubOpenPii / assertNoOpenPii'],
    'privacidad',
    'alto',
    'Depuración defensiva y determinista, no anonimización garantizada.',
  );
  return ledger;
}

export function buildContractualRegistry({
  documents,
  opportunityId = null,
  proceso = 'SA-24-2026',
  entidad = 'Rama Judicial — Dirección Seccional de Administración Judicial de Manizales',
  generatedAt = null,
} = {}) {
  const provenance = classifyRegistroDocumentProvenance(documents);
  const data_gaps = [...provenance.data_gaps];

  let items = [];
  if (provenance.vigente_pliego.resolved) {
    const vigenteDoc = (documents || []).find(d => documentIdentity(d) === provenance.vigente_pliego.document_id);
    const content = documentContent(vigenteDoc);
    const sections = sectionizeVigentePliego(content);
    if (sections.length === 0) {
      data_gaps.push({
        gap_id: 'vigente-pliego-not-sectionized',
        description: 'El pliego vigente no produjo secciones numeradas parseables; el registro abstiene de enumerar requisitos.',
        affected_document_ids: [provenance.vigente_pliego.document_id],
      });
    }
    items = sections.map(section => buildItem(section, 'vigente', content, proceso));
  }

  // Documentos ilegibles/sin texto (no verificables).
  const unverifiable = (documents || [])
    .filter(d => collapse(documentContent(d)).length === 0)
    .map(d => ({ document_id: documentIdentity(d), name: String(d?.name ?? '') }));
  if (unverifiable.length > 0) {
    data_gaps.push({
      gap_id: 'documents-without-text',
      description: `${unverifiable.length} documento(s) sin texto extraíble; no verificables por el registro.`,
      affected_document_ids: unverifiable.map(d => d.document_id),
    });
  }

  const abstentions = buildAbstentions(items);
  const coverage = summarizeCoverage(items);
  const ledger = buildLedger(items, provenance, provenance.vigente_pliego);

  return {
    artifact_type: AGT002_CONTRACTUAL_REGISTRY_ARTIFACT_TYPE,
    status: AGT002_CONTRACTUAL_REGISTRY_STATUS,
    human_approval_required: true,
    version: AGT002_CONTRACTUAL_REGISTRY_VERSION,
    taxonomy_version: AGT002_CONTRACTUAL_REGISTRY_TAXONOMY_VERSION,
    opportunity_id: opportunityId,
    proceso,
    entidad,
    generated_at: generatedAt,
    pattern_reference: {
      case: 'Rama Judicial Pereira SA-MC-02-2026',
      use: 'patron_taxonomia_y_flujo',
      not_used_as: 'prueba_de_cumplimiento_ni_traslado_de_aplicabilidad_a_manizales',
    },
    provenance: provenance.documents,
    vigente_pliego: provenance.vigente_pliego,
    items,
    coverage,
    abstentions,
    data_gaps,
    ledger,
    probative_limits: [...REGISTRO_LIMITES_PROBATORIOS],
  };
}
