// AGT-002 — Taxonomía del REGISTRO CONTRACTUAL EXHAUSTIVO (Rama Judicial Manizales
// SA-24-2026).
//
// Vocabulario cerrado y congelado que estructura el registro contractual. Derivado como
// PATRÓN del expediente adjudicado Rama Judicial Pereira SA-MC-02-2026 (catálogo de
// documentos, matriz requisito→evidencia, escalera probatoria y guardas "no automatizar")
// — nunca como prueba de cumplimiento de Manizales, ni como traslado de aplicabilidad.
//
// Disciplina (idéntica al resto del flujo gobernado AGT-002): reglas cerradas y
// deterministas, sin LLM, sin "presencia implica cumplimiento". El eje `cumplimiento`
// permanece SIEMPRE `no_evaluado`: decidir cumplimiento/GO-NO-GO es una compuerta humana,
// nunca del registro.

export const AGT002_CONTRACTUAL_REGISTRY_TAXONOMY_VERSION = 'agt002-contractual-registry-taxonomy@1';

// Fases del proceso, mapeadas de forma determinista por el entero inicial del numeral del
// pliego (Capítulo I..VI). Se mapea por el numeral y no por el rótulo romano del capítulo
// porque los pliegos escaneados repiten/renumeran mal los rótulos ("CAPITULO IV" que en
// realidad es el VI). habilitante/puntuable/oferta/postadjudicación son las fases que el
// bloque exige distinguir; generalidad/evaluacion/ejecucion_tecnica completan el pliego.
export const REGISTRO_FASES = Object.freeze([
  'generalidad', // Capítulo I: objeto, presupuesto, cronograma, reglas del proceso.
  'habilitante', // Capítulo II: requisitos habilitantes (CUMPLE / NO CUMPLE).
  'puntuable', // Capítulo III: criterios de evaluación / puntaje.
  'evaluacion', // Capítulo IV: evaluación, empates, adjudicación, perfeccionamiento.
  'ejecucion_tecnica', // Capítulo V: condiciones técnicas del servicio / oferta técnica.
  'postadjudicacion', // Capítulo VI: régimen contractual, garantías, multas (tras adjudicar).
]);

// La fase se deriva del primer entero del numeral del pliego.
export const REGISTRO_FASE_POR_CAPITULO = Object.freeze({
  1: 'generalidad',
  2: 'habilitante',
  3: 'puntuable',
  4: 'evaluacion',
  5: 'ejecucion_tecnica',
  6: 'postadjudicacion',
});

// Familias/categorías del requisito (adaptadas del catálogo A–N de Pereira). `no_determinada`
// es una abstención explícita, nunca un descarte silencioso.
export const REGISTRO_CATEGORIAS = Object.freeze([
  'juridico',
  'financiero',
  'organizacional',
  'experiencia',
  'tecnico_sst_ambiental',
  'licencias_sector',
  'seguros_garantias',
  'personal',
  'factor_evaluacion',
  'industria_nacional_diferencial',
  'oferta_economica',
  'proceso',
  'no_determinada',
]);

// Las cuatro dimensiones que el bloque exige tratar por separado. Nunca se colapsan:
// una cosa es que el requisito esté presente en el pliego, otra que la cláusula esté
// vigente, otra que aplique a la modalidad del proponente, y otra —la más alta— que se
// cumpla. El registro sólo resuelve `presencia` y `vigencia`; abstiene en `aplicabilidad`
// y jamás decide `cumplimiento`.
export const REGISTRO_DIMENSIONES = Object.freeze(['presencia', 'vigencia', 'aplicabilidad', 'cumplimiento']);

export const REGISTRO_DIMENSION_ESTADOS = Object.freeze({
  presencia: Object.freeze(['observado', 'ausente', 'no_determinado']),
  vigencia: Object.freeze(['vigente', 'superseded', 'historico', 'no_determinado']),
  aplicabilidad: Object.freeze(['aplica', 'no_aplica', 'no_determinada']),
  // Un único valor posible: el registro NO evalúa cumplimiento. Es la frontera con la
  // compuerta humana / GO-NO-GO.
  cumplimiento: Object.freeze(['no_evaluado']),
});

// Escalera probatoria (Pereira: observado ≠ requisito ≠ cumplimiento ≠ puntaje ≠
// adjudicación). El registro sólo emite `requisito_pliego` (leído del pliego vigente) y
// `observado` (un formato/anexo aparece en el corpus, sin implicar aceptación).
export const REGISTRO_ESTADOS_PROBATORIOS = Object.freeze([
  'requisito_pliego',
  'observado',
  'no_probado',
]);

// Estado de la evidencia empresarial dentro del registro. Es SIEMPRE `not_assessed`:
// el registro cataloga lo que el pliego exige, no lo que la empresa aporta ni si Pereira
// lo tenía. Separar requisito contractual de evidencia empresarial es un invariante.
export const REGISTRO_EVIDENCIA_EMPRESARIAL_ESTADOS = Object.freeze(['not_assessed']);

// Procedencia documental (distingue pliego vigente de proyecto/observaciones/soportes).
export const REGISTRO_PROVENANCE_KINDS = Object.freeze([
  'pliego_definitivo',
  'pliego_proyecto',
  'respuesta_observaciones',
  'estudios_previos',
  'estudios_sector',
  'anexo_oferta_economica',
  'anexo_formato',
  'anexo_requisito',
  'anexo',
  'otro',
]);

export const REGISTRO_PROVENANCE_VIGENCIA = Object.freeze(['vigente', 'superseded', 'historico', 'soporte', 'no_determinado']);

export const REGISTRO_SUBSANABILIDAD = Object.freeze(['subsanable', 'no_subsanable', 'no_determinado']);

export const REGISTRO_CONFIANZA = Object.freeze(['alto', 'medio', 'bajo']);

// Vocabulario controlado del ledger de evidencia (Pereira file 07). Cada aseveración del
// registro cita su evidencia, su tipo, su confianza y su límite explícito.
export const REGISTRO_LEDGER_TIPOS = Object.freeze([
  'requisito_pliego',
  'conteo_estructural',
  'observado',
  'contradiccion',
  'limite_probatorio',
  'privacidad',
  'abstencion',
]);

// Ejes de abstención admitidos en el artefacto (alineados con el estilo del draft de
// gobernanza existente: {axis, reason, detail}).
export const REGISTRO_ABSTENTION_AXES = Object.freeze([
  'categoria',
  'umbral',
  'aplicabilidad',
  'subsanabilidad',
  'vigente_pliego',
  'seccion',
]);

// Límites probatorios que el artefacto declara de forma verbatim (frontera de no
// automatización). No son texto de documento: son disciplina del registro.
export const REGISTRO_LIMITES_PROBATORIOS = Object.freeze([
  'El registro cataloga requisitos del pliego vigente; no decide cumplimiento, habilitación, puntaje ni GO/NO-GO.',
  'Presencia de un requisito o de un formato en el corpus no implica aceptación, vigencia, aplicabilidad ni cumplimiento.',
  'Requisito contractual y evidencia empresarial se mantienen separados: la evidencia empresarial no se evalúa aquí (not_assessed).',
  'Presentado no equivale a aceptado ni a adjudicado; el registro no infiere resultados de evaluación.',
  'Rama Judicial Pereira se usa sólo como patrón de taxonomía y flujo; no prueba cumplimiento de Manizales ni traslada aplicabilidad.',
  'La interpretación jurídica, la suficiencia de licencias/pólizas/experiencia, la resolución de contradicciones del pliego y la firma/presentación son decisiones humanas.',
]);

function assertMembership(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new Error(`Valor "${value}" no pertenece al vocabulario cerrado de ${label}.`);
  }
  return value;
}

export function assertRegistroFase(value) {
  return assertMembership(value, REGISTRO_FASES, 'REGISTRO_FASES');
}

export function assertRegistroCategoria(value) {
  return assertMembership(value, REGISTRO_CATEGORIAS, 'REGISTRO_CATEGORIAS');
}

export function faseParaNumeralCapitulo(leadingInteger) {
  const key = Number(leadingInteger);
  return REGISTRO_FASE_POR_CAPITULO[key] ?? 'generalidad';
}

// --- Guarda de PII / datos abiertos --------------------------------------------------
//
// Los 17 documentos son publicaciones de la ENTIDAD contratante (pliego, estudios, anexos
// en blanco): no contienen datos personales del proponente. Aun así, para mantener "PII
// fuera de artefactos abiertos", todo excerpt del registro pasa por este depurador, que
// redacta patrones tipo-identificador (cédula/NIT largos, correo, teléfono) antes de
// persistir. Es defensivo y determinista, no una promesa de anonimización perfecta.
const PII_EMAIL = { kind: 'email', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, mask: '«correo»' };
// Cédula/NIT FORMATEADO (grupos de 3 dígitos con . o -, p.ej. 79.123.456, 800.165.850-4).
// Es la firma real de un identificador personal en texto oficial y NO colisiona con umbrales
// ("50%", "1.5", "1000 SMMLV").
const PII_ID_FORMATTED = { kind: 'id_formateado', pattern: /\b\d{1,3}(?:[.\-]\d{3}){2,}(?:[.\-]\d)?\b/g, mask: '«id»' };
// Corridas largas de dígitos (7+): en un EXCERPT se redactan por precaución, pero NO se usan
// como criterio de la guarda del artefacto porque colisionan con identificadores
// estructurales legítimos (UUID cuyo primer segmento es numérico, ids públicos de SECOP).
const PII_ID_BARE = { kind: 'id_corrida', pattern: /\b\d{7,}\b/g, mask: '«id»' };

// Conjunto agresivo para depurar excerpts de texto libre.
const PII_SCRUB = Object.freeze([PII_EMAIL, PII_ID_FORMATTED, PII_ID_BARE]);
// Conjunto de verificación del artefacto: sólo PII inequívoca (correo + id formateado),
// tolerando identificadores estructurales (UUID/SECOP) en campos como document_id/evidence.
const PII_GUARD = Object.freeze([PII_EMAIL, PII_ID_FORMATTED]);

export function scrubOpenPii(value) {
  let text = String(value ?? '');
  for (const { pattern, mask } of PII_SCRUB) {
    text = text.replace(pattern, mask);
  }
  return text;
}

// Escaneo recursivo del artefacto en busca de PII sin redactar (análogo a la guarda
// forbidden-text-key del draft de gobernanza). Devuelve las rutas ofensivas; vacío = OK.
export function findOpenPiiPaths(node, path = '') {
  const offending = [];
  if (typeof node === 'string') {
    for (const { pattern } of PII_GUARD) {
      // Los patrones son globales; clonar para no arrastrar lastIndex entre nodos.
      const probe = new RegExp(pattern.source, pattern.flags.replace('g', ''));
      if (probe.test(node)) {
        offending.push(path || '(root)');
        break;
      }
    }
    return offending;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => offending.push(...findOpenPiiPaths(item, `${path}[${index}]`)));
    return offending;
  }
  if (node && typeof node === 'object') {
    for (const [key, child] of Object.entries(node)) {
      offending.push(...findOpenPiiPaths(child, path ? `${path}.${key}` : key));
    }
  }
  return offending;
}

export function assertNoOpenPii(artifact) {
  const paths = findOpenPiiPaths(artifact);
  if (paths.length > 0) {
    throw new Error(`El artefacto contiene posible PII sin redactar en: ${paths.slice(0, 10).join(', ')}`);
  }
  return artifact;
}
