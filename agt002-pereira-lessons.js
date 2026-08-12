// Mapa de lecciones del caso Rama Judicial Pereira SA-MC-02-2026, curado a mano a
// partir del análisis gobernado en
//   /root/psi-comercial/portafolio-innovacion/secure-reference/rama-judicial-pereira-2026-analysis
// (opus-output/03-matriz-requisito-evidencia.md, 05-riesgos-brechas-y-no-automatizar.md,
// summary.json), como PATRÓN de taxonomía y escalera probatoria — NUNCA como prueba de
// cumplimiento de Manizales ni traslado de aplicabilidad.
//
// Cada lección es requisito -> tipo de evidencia esperada -> resultado observado en Pereira
// -> lección transferible, separada en tres cubos:
//   universales           lecciones de método válidas en cualquier proceso (SECOP, Rama Judicial)
//   variables_por_proceso lecciones cuyo VALOR concreto cambia por proceso (umbrales, territorio,
//                         vigencias) y que por tanto NO se pueden reutilizar como suficientes
//   postadjudicacion      lecciones que sólo aplican después de la adjudicación (no son evidencia pre-GO)
//
// Provenance usa sólo identificadores institucionales/documentales (nombre de documento,
// hash SECOP, sección del análisis) — jamás contenido personal. Todo texto pasa por la
// misma guarda de PII abierta del registro contractual.

export const AGT002_PEREIRA_CASE = Object.freeze({
  case: 'Rama Judicial Pereira SA-MC-02-2026',
  role: 'patron_taxonomia_y_escalera_probatoria',
  applies_to_manizales: 'patron_no_prueba',
  not_used_as: 'prueba_de_cumplimiento_ni_traslado_de_aplicabilidad',
  source_root: 'secure-reference/rama-judicial-pereira-2026-analysis',
});

export const AGT002_PEREIRA_LESSON_BUCKETS = Object.freeze([
  'universales', 'variables_por_proceso', 'postadjudicacion',
]);

// Escala de resultado observado en Pereira: se distingue estrictamente
// observado != cumplimiento probado != puntaje potencial != puntaje otorgado != adjudicación.
export const AGT002_PEREIRA_OBSERVED_RESULTS = Object.freeze([
  'observado', 'observado_por_volumen', 'no_aislado_en_muestra', 'cumplimiento_agregado_por_acto',
  'puntaje_potencial', 'contradiccion_del_expediente', 'no_probado',
]);

function lesson(entry) {
  return Object.freeze({
    requirement: entry.requirement,
    evidence_type: entry.evidence_type,
    observed_result: entry.observed_result,
    lesson: entry.lesson,
    // Enlaces opcionales (por identificador) a secciones del registro Manizales donde el
    // patrón es pertinente; nunca implican que Manizales cumpla.
    manizales_touchpoints: Object.freeze(entry.manizales_touchpoints || []),
    provenance: Object.freeze(entry.provenance),
    confidence: entry.confidence,
  });
}

const UNIVERSALES = [
  {
    requirement: 'No indexar/clasificar un documento por su nombre de archivo',
    evidence_type: 'numero_de_proceso_extraido_del_cuerpo',
    observed_result: 'contradiccion_del_expediente',
    lesson: 'Un archivo rotulado «…SA-MC-01-2025.pdf» tenía cuerpo 100% SA-MC-02-2026; avisos arrastraron una fecha de cierre obsoleta. Extraer el número de proceso del cuerpo y alertar discrepancias filename↔contenido.',
    manizales_touchpoints: [],
    provenance: { doc: 'opus-output/05-riesgos-brechas-y-no-automatizar.md', section: '§4', evidence_ids: ['803570240'] },
    confidence: 'alto',
  },
  {
    requirement: 'Presentado no equivale a habilitado ni a puntuado',
    evidence_type: 'informe_de_evaluacion_y_matriz_de_puntaje',
    observed_result: 'cumplimiento_agregado_por_acto',
    lesson: 'Sin informe de evaluación no hay prueba de cumplimiento por documento ni de puntos otorgados; el acto de adjudicación sólo afirma cumplimiento habilitante de forma agregada y conclusoria.',
    manizales_touchpoints: ['2.1', '2.6'],
    provenance: { doc: 'opus-output/03-matriz-requisito-evidencia.md', section: '§8', evidence_ids: ['821619524'] },
    confidence: 'alto',
  },
  {
    requirement: 'La suficiencia de umbrales cuantitativos es cotejo humano, no aritmética automática',
    evidence_type: 'indicadores_rup_vs_umbral_del_pliego',
    observed_result: 'puntaje_potencial',
    lesson: 'Los cinco indicadores financieros «aparentan cumplir» (liquidez 2,37≥1,5; endeudamiento 0,50≤0,55…) pero el cumplimiento probado sólo lo respalda el informe de evaluación; el corte del cuestionario SECOP estaba obsoleto frente al pliego.',
    manizales_touchpoints: ['2.2', '2.3', '2.4'],
    provenance: { doc: 'opus-output/03-matriz-requisito-evidencia.md', section: '§2', evidence_ids: ['811135236'] },
    confidence: 'alto',
  },
  {
    requirement: 'Reconciliar las contradicciones internas del propio pliego por decisión humana',
    evidence_type: 'clausula_que_gobierna_+_observacion',
    observed_result: 'contradiccion_del_expediente',
    lesson: 'El pliego autoritativo era internamente inconsistente (cláusula penal 20% vs 10%; RCE 400 vs 200 SMMLV; días de grabación 60 vs 30; UNSPSC divergentes; numeración 27.x/28.x). Nunca automatizar una interpretación que resuelva la contradicción sin humano.',
    manizales_touchpoints: ['2.1', '6.4'],
    provenance: { doc: 'opus-output/05-riesgos-brechas-y-no-automatizar.md', section: '§2', evidence_ids: ['811135236'] },
    confidence: 'alto',
  },
  {
    requirement: 'Operar el personal por estado de cobertura, no por atributos personales',
    evidence_type: 'estado_de_cobertura_por_perfil',
    observed_result: 'observado_por_volumen',
    lesson: 'Superficie de PII desproporcionada (1.004 docs de personal para ~46-49 roles; nombres y direcciones filtrados en texto libre pese a redactar teléfono/correo/cédula). AGT-002 debe devolver estado de cobertura por requisito, minimizar y marcar revisión de protección de datos.',
    manizales_touchpoints: ['2.1'],
    provenance: { doc: 'opus-output/05-riesgos-brechas-y-no-automatizar.md', section: '§5', evidence_ids: ['summary.json'] },
    confidence: 'alto',
  },
  {
    requirement: 'Prohibido inferir ausencia desde una imagen ilegible',
    evidence_type: 'ocr_con_confianza_por_pagina_y_campo',
    observed_result: 'no_probado',
    lesson: '454 documentos requerían OCR; RUP/experiencia/licencia de baja extracción no deben marcarse como verificados por extracción. Contradicción de experiencia (Jerónimo Martins 089/43.454,45 vs 095/24.224,27): no sumar ni elegir el mayor sin cotejo del primario.',
    manizales_touchpoints: ['2.4', '2.4.1'],
    provenance: { doc: 'opus-output/05-riesgos-brechas-y-no-automatizar.md', section: '§7', evidence_ids: ['summary.json'] },
    confidence: 'alto',
  },
];

const VARIABLES_POR_PROCESO = [
  {
    requirement: 'Territorialidad de la licencia de funcionamiento',
    evidence_type: 'acto_supervigilancia_con_sede_sucursal_en_el_departamento',
    observed_result: 'no_probado',
    lesson: 'La cobertura territorial exacta por sede a la fecha de cierre era propia de Risaralda y quedó no probada. La territorialidad cambia por proceso; no reutilizar una licencia histórica como suficiente.',
    manizales_touchpoints: ['2.1'],
    provenance: { doc: 'opus-output/03-matriz-requisito-evidencia.md', section: '§1', evidence_ids: ['45d9857f2a128853'] },
    confidence: 'medio',
  },
  {
    requirement: 'Vigencia, beneficiario y amparos de pólizas y garantía de seriedad',
    evidence_type: 'poliza_a_favor_de_la_entidad_con_vigencia_y_suma_vigentes',
    observed_result: 'contradiccion_del_expediente',
    lesson: 'La garantía de seriedad se calculó sobre el 10% del total de CDP, no del 10% del POE vigente (base mayor); reutilizar esa base sub/sobre-cubre. El listado de armas vence a 60 días. Validar siempre contra el POE vigente y las vigencias del proceso.',
    manizales_touchpoints: ['2.1'],
    provenance: { doc: 'opus-output/03-matriz-requisito-evidencia.md', section: '§7', evidence_ids: ['a297f572ecc05a21', '811135236'] },
    confidence: 'alto',
  },
  {
    requirement: 'Suma habilitante de RCE y su distinción de la garantía de ejecución',
    evidence_type: 'poliza_rce_sectorial_vigente_por_smmlv',
    observed_result: 'observado',
    lesson: 'RCE ≥400 SMMLV es requisito habilitante (con la oferta) y coexiste con una RCE contractual de 200 SMMLV (post-adjudicación): son etapas distintas y no deben confundirse ni la una probar la otra.',
    manizales_touchpoints: ['2.1', '6.4'],
    provenance: { doc: 'opus-output/05-riesgos-brechas-y-no-automatizar.md', section: '§2.B', evidence_ids: ['811135236'] },
    confidence: 'alto',
  },
  {
    requirement: 'Umbrales y método del factor económico',
    evidence_type: 'anexo_economico_diligenciado_y_tarifa_regulada',
    observed_result: 'puntaje_potencial',
    lesson: 'Sólo el servicio de medios tecnológicos puntúa (la vigilancia humana es tarifa regulada); coexistían el método por TRM (4 alternativas) y una regla de media aritmética sin reconciliar. El método aplicado y el redondeo son revisión humana por proceso.',
    manizales_touchpoints: ['3.1'],
    provenance: { doc: 'opus-output/03-matriz-requisito-evidencia.md', section: '§6.3/§7', evidence_ids: ['5fb982ca99737450'] },
    confidence: 'medio',
  },
  {
    requirement: 'Experiencia acreditada: sumatoria, admisibilidad y no doble conteo',
    evidence_type: 'certificaciones_+_extractos_rup_por_unspsc',
    observed_result: 'observado',
    lesson: 'La sumatoria oficial, la admisibilidad y el no doble conteo de las certificaciones no quedaron probados; la elección de experiencia pertinente y la certificación de no doble conteo son decisión humana por proceso.',
    manizales_touchpoints: ['2.4', '2.4.1'],
    provenance: { doc: 'opus-output/03-matriz-requisito-evidencia.md', section: '§3', evidence_ids: ['811135236'] },
    confidence: 'medio',
  },
];

const POSTADJUDICACION = [
  {
    requirement: 'Garantías de cumplimiento, acta de inicio y transición',
    evidence_type: 'polizas_de_ejecucion_y_actas_post_adjudicacion',
    observed_result: 'no_aislado_en_muestra',
    lesson: 'La aprobación de garantías de cumplimiento, el acta de inicio, la transición con la empresa saliente y las obligaciones ejecutables son posteriores a la adjudicación; no son evidencia pre-GO y no deben exigirse ni cruzarse en la decisión de oferta.',
    manizales_touchpoints: ['6.4'],
    provenance: { doc: 'opus-output/05-riesgos-brechas-y-no-automatizar.md', section: '§9.8', evidence_ids: ['821619524'] },
    confidence: 'alto',
  },
  {
    requirement: 'Compromisos condicionales de ejecución declarados en la oferta',
    evidence_type: 'cartas_de_compromiso_caso_especificas',
    observed_result: 'no_probado',
    lesson: 'Las 5 cartas de compromiso (transición, 100% de equipos el primer mes, +30 días tecnológicos, tarifa) eran caso-específicas; su viabilidad es decisión humana. No repetirlas como plantilla sin validar viabilidad para el proceso nuevo.',
    manizales_touchpoints: [],
    provenance: { doc: 'opus-output/05-riesgos-brechas-y-no-automatizar.md', section: '§1.5', evidence_ids: ['34598ac51b276017'] },
    confidence: 'alto',
  },
  {
    requirement: 'Adendas y reglas vigentes al cierre',
    evidence_type: 'adendas_y_respuestas_a_observaciones',
    observed_result: 'no_probado',
    lesson: 'Las adendas estaban citadas por el acto pero ausentes del corpus; la regla vigente al cierre puede diferir del pliego base. Confirmar cuál versión gobernó al cierre es indispensable antes de cualquier decisión.',
    manizales_touchpoints: [],
    provenance: { doc: 'opus-output/05-riesgos-brechas-y-no-automatizar.md', section: '§8', evidence_ids: ['821619524'] },
    confidence: 'alto',
  },
];

export const AGT002_PEREIRA_LESSONS = Object.freeze({
  case: AGT002_PEREIRA_CASE,
  universales: Object.freeze(UNIVERSALES.map(lesson)),
  variables_por_proceso: Object.freeze(VARIABLES_POR_PROCESO.map(lesson)),
  postadjudicacion: Object.freeze(POSTADJUDICACION.map(lesson)),
});

// Índice: touchpoint (numeral de sección Manizales) -> lecciones que lo referencian, para
// que el análisis pre-GO pueda anexar el patrón a la sección pertinente por identificador.
export function buildAgt002PereiraTouchpointIndex(lessons = AGT002_PEREIRA_LESSONS) {
  const index = new Map();
  for (const bucket of AGT002_PEREIRA_LESSON_BUCKETS) {
    for (const entry of lessons[bucket] || []) {
      for (const ref of entry.manizales_touchpoints) {
        if (!index.has(ref)) index.set(ref, []);
        index.get(ref).push({ bucket, requirement: entry.requirement, lesson: entry.lesson, provenance: entry.provenance });
      }
    }
  }
  return index;
}
