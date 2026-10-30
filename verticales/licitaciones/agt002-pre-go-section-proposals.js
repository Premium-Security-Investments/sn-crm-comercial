// Overlay LOCAL de PROPUESTAS CURADAS de requisitos para las diez secciones pre-GO de Rama
// Judicial Manizales SA-24-2026 que hoy NO tienen requisito gobernado: 2.3, 2.4, 2.4.1, 2.5,
// 3.1, 3.2, 3.3, 3.4, 3.5, 3.6.
//
// Qué es y qué NO es:
//   - Es un catálogo de PROPUESTAS (`proposed_for_human_review`), regenerable y determinista,
//     que atomiza cada sección en requisitos estables derivados del CUERPO real del pliego
//     vigente (nunca del índice/TOC, nunca inventados). Cada requisito lleva su cita corporal
//     por offsets del pliego vigente, su clase de evidencia empresarial CANDIDATA sólo cuando
//     existe correspondencia conceptual 1:1 con una de las 17 clases, y compuertas humanas de
//     aplicabilidad y suficiencia sin decidir.
//   - NO es un override aprobado ni un requirement_manifest gobernado: no habilita, no puntúa,
//     no afirma cumplimiento ni suficiencia. `human_approval_required: true`, `is_approved: false`.
//   - El extractor cerrado anterior reconoce deliberadamente sólo 4 requisitos gobernados; este
//     overlay NO lo sustituye ni lo hace pasar por exhaustivo: vive aparte, como propuesta.
//   - Pereira SA-MC-02-2026 se usa SÓLO como lección/provenance de método (sumatoria/no doble
//     conteo, método económico, territorialidad), jamás como prueba de cumplimiento de Manizales
//     ni traslado de aplicabilidad. No se fuerza CCTV ni se reutiliza Pereira como evidencia.
//
// Disciplina (igual que el resto del flujo AGT-002): reglas cerradas, deterministas, sin I/O,
// sin reloj, sin red. El builder recibe el registro contractual ya parseado y una marca ISO.

import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from './agt002-company-evidence-classes.js';
import { assertNoOpenPii } from './agt002-contractual-registry-taxonomy.js';

export const AGT002_SECTION_PROPOSALS_ARTIFACT_TYPE = 'agt002_pre_go_section_proposals';
export const AGT002_SECTION_PROPOSALS_STATUS = 'proposed_for_human_review';
export const AGT002_SECTION_PROPOSALS_VERSION = 1;
export const AGT002_SECTION_PROPOSALS_CONTRACT_VERSION = 'agt002-pre-go-section-proposals@1';

// Las diez secciones pre-GO sin requisito gobernado que este overlay atomiza (congelado).
export const AGT002_SECTION_PROPOSAL_REFS = Object.freeze(['2.3', '2.4', '2.4.1', '2.5', '3.1', '3.2', '3.3', '3.4', '3.5', '3.6']);

// Vocabularios cerrados de la propuesta. `requirement_kind` distingue la obligación probatoria
// del proponente (habilitante/puntuable) de las condiciones diferenciales (condicional) y de las
// reglas de evaluación de la entidad (regla_entidad), que NO cargan evidencia empresarial.
export const AGT002_REQUIREMENT_KINDS = Object.freeze(['habilitante', 'puntuable', 'regla_entidad', 'condicional']);
export const AGT002_OFFER_STAGES = Object.freeze(['con_la_oferta', 'subsanable_en_traslado', 'evaluacion_entidad', 'post_adjudicacion']);
export const AGT002_EVIDENCE_NEEDS = Object.freeze([
  'indicador_rup',
  'experiencia_acreditada',
  'formato_anexo',
  'certificacion_representante_legal',
  'oferta_economica_anexo',
  'soporte_criterio_diferencial',
  'condicional_documental',
  'regla_sin_evidencia_empresarial',
]);
// La subsanabilidad es SIEMPRE una compuerta humana; estos valores son candidatos con base, no
// una decisión. `no_determinada_requiere_humano` es abstención explícita, no descarte.
export const AGT002_PROPOSAL_SUBSANABILITY = Object.freeze(['subsanable_candidate', 'no_subsanable_candidate', 'no_determinada_requiere_humano']);

// Documento del que se derivan TODAS las citas: el pliego vigente (definitivo).
const VIGENTE_PLIEGO_DOCUMENT_ID = 'db9752a1-e9ee-49af-b321-883d0c23cf0a';
const VIGENTE_PLIEGO_NAME = '9. Pliego de Condiciones Definitivo SA-24-2026.pdf';

const APPLICABILITY_NOTE = 'La aplicabilidad por modalidad del proponente (persona natural/jurídica/consorcio/UT y régimen diferencial) es decisión humana; ninguna sección se afirma aplicable automáticamente.';

const PROBATIVE_LIMITS = Object.freeze([
  'Estas son PROPUESTAS CURADAS para revisión humana, no requisitos gobernados aprobados: no habilitan, no puntúan y no afirman cumplimiento ni suficiencia.',
  'La atomización se deriva del cuerpo del pliego vigente (por offsets), nunca del índice/TOC ni de contenido inventado.',
  'La clase de evidencia empresarial es sólo CANDIDATA y sólo se propone cuando hay correspondencia conceptual 1:1 con una de las 17 clases gobernadas; en caso contrario es null.',
  'Las reglas de evaluación de la entidad (subsanabilidad, tarifa mínima, media aritmética) se marcan sin clase de evidencia empresarial.',
  'La aplicabilidad (modalidad del proponente) y la suficiencia (umbrales, sumatoria, no doble conteo, método) son compuertas humanas; nunca se afirman aquí.',
  'Rama Judicial Pereira se usa sólo como lección/provenance de método; no prueba cumplimiento de Manizales ni traslada aplicabilidad. No se fuerza CCTV ni se reutiliza Pereira como evidencia.',
]);

function citation(char_start, char_end, quote) {
  return Object.freeze({
    document_id: VIGENTE_PLIEGO_DOCUMENT_ID,
    document_name: VIGENTE_PLIEGO_NAME,
    char_start,
    char_end,
    quote,
  });
}

function req(entry) {
  return Object.freeze({
    requirement_id: entry.requirement_id,
    item_ref: entry.item_ref,
    label: entry.label,
    requirement_kind: entry.requirement_kind,
    offer_stage: entry.offer_stage,
    evidence_need: entry.evidence_need,
    candidate_evidence_class_id: entry.candidate_evidence_class_id ?? null,
    rationale: entry.rationale,
    subsanability: Object.freeze({ candidate: entry.subsanability, basis: entry.subsanability_basis }),
    applicability_gate: Object.freeze({ decision: 'human_required', owner: entry.owner, note: APPLICABILITY_NOTE }),
    sufficiency_gate: Object.freeze({ decision: 'human_required', owner: entry.owner, note: entry.sufficiency_note }),
    pereira_lesson: entry.pereira_lesson ? Object.freeze(entry.pereira_lesson) : null,
    source_citation: citation(entry.char_start, entry.char_end, entry.quote),
    status: AGT002_SECTION_PROPOSALS_STATUS,
  });
}

// --- Catálogo curado (derivado del cuerpo real del pliego vigente) --------------------------
const SECTIONS_DATA = [
  {
    item_ref: '2.3', titulo: 'CAPACIDAD ORGANIZACIONAL', fase: 'habilitante',
    requirements: [
      req({
        requirement_id: 'proposal:2.3:indices-capacidad-organizacional', item_ref: '2.3',
        label: 'Índices de capacidad organizacional (rentabilidad del patrimonio y del activo)',
        requirement_kind: 'habilitante', offer_stage: 'con_la_oferta', evidence_need: 'indicador_rup',
        candidate_evidence_class_id: 'rup',
        rationale: 'El pliego mide dos índices organizacionales verificados con el RUP: Rentabilidad del Patrimonio (Utilidad operacional/Patrimonio) mayor o igual a 5% y Rentabilidad del Activo (Utilidad Operacional/Activo Total) mayor o igual a 5%; no otorga puntaje y se evalúa CUMPLE/NO CUMPLE.',
        subsanability: 'subsanable_candidate',
        subsanability_basis: 'Requisito habilitante que no es factor de escogencia; el pliego 2.5 admite subsanar requisitos faltantes, pero la subsanabilidad concreta es decisión humana.',
        owner: 'financial',
        sufficiency_note: 'El cotejo indicador RUP vs umbral (mayor o igual a 5% en ambos índices) es suficiencia humana; una señal presente no prueba cumplimiento (lección Pereira: umbrales son cotejo humano).',
        pereira_lesson: { bucket: 'universales', requirement: 'La suficiencia de umbrales cuantitativos es cotejo humano, no aritmética automática', use: 'leccion_no_prueba' },
        char_start: 93564, char_end: 93645, quote: 'medirá el rendimiento de las inversiones y la eficiencia en el uso de los activos',
      }),
      req({
        requirement_id: 'proposal:2.3:regla-plural-integrante-organizacional', item_ref: '2.3',
        label: 'Regla plural: en Consorcio/UT mínimo uno de los integrantes cumple los índices',
        requirement_kind: 'condicional', offer_stage: 'con_la_oferta', evidence_need: 'regla_sin_evidencia_empresarial',
        candidate_evidence_class_id: null,
        rationale: 'Para Consorcios o Uniones Temporales, mínimo uno de los integrantes deberá cumplir los índices de capacidad organizacional. Es una regla de aplicabilidad plural, no una evidencia empresarial adicional.',
        subsanability: 'no_determinada_requiere_humano',
        subsanability_basis: 'Depende de la modalidad plural del proponente; decisión humana.',
        owner: 'legal',
        sufficiency_note: 'Qué integrante acredita y con qué porcentaje de participación es verificación humana.',
        char_start: 94135, char_end: 94217, quote: 'Para el caso de los Consorcios o Uniones Temporales, mínimo uno de los integrantes',
      }),
    ],
  },
  {
    item_ref: '2.4', titulo: 'EXPERIENCIA', fase: 'habilitante',
    requirements: [
      req({
        requirement_id: 'proposal:2.4:experiencia-rup-unspsc-sumatoria', item_ref: '2.4',
        label: 'Experiencia habilitante: 1 a 3 contratos RUP (UNSPSC 92121500/92121700) con sumatoria mayor o igual a 1000 SMMLV',
        requirement_kind: 'habilitante', offer_stage: 'con_la_oferta', evidence_need: 'experiencia_acreditada',
        candidate_evidence_class_id: 'accredited_experience',
        rationale: 'Se verifican entre uno (1) y máximo tres (3) contratos inscritos en el RUP en al menos uno de los códigos UNSPSC (hasta tercer nivel) 92121500 Servicios de guardias / 92121700 Servicios de sistemas de seguridad, cuya sumatoria sea igual o mayor a 1000 SMMLV; CUMPLE/NO CUMPLE.',
        subsanability: 'subsanable_candidate',
        subsanability_basis: 'Requisito habilitante no factor de escogencia (pliego 2.5); subsanabilidad concreta es decisión humana.',
        owner: 'tender_lead',
        sufficiency_note: 'La sumatoria oficial, la admisibilidad de cada contrato por UNSPSC y el no doble conteo son suficiencia humana (lección Pereira: no sumar ni elegir el mayor sin cotejo del primario).',
        pereira_lesson: { bucket: 'variables_por_proceso', requirement: 'Experiencia acreditada: sumatoria, admisibilidad y no doble conteo', use: 'leccion_no_prueba' },
        char_start: 94814, char_end: 94859, quote: 'cuya sumatoria sea igual o mayor a 1000 SMLMV',
      }),
      req({
        requirement_id: 'proposal:2.4:anexo-8-formato-experiencia', item_ref: '2.4',
        label: 'Anexo No. 8 Formato de Experiencia diligenciado (relación de contratos)',
        requirement_kind: 'habilitante', offer_stage: 'con_la_oferta', evidence_need: 'formato_anexo',
        candidate_evidence_class_id: 'accredited_experience',
        rationale: 'El proponente adjunta el Anexo No. 8 FORMATO DE EXPERIENCIA diligenciado relacionando los contratos con los que acredita la experiencia exigida.',
        subsanability: 'subsanable_candidate',
        subsanability_basis: 'Formato de soporte de un requisito habilitante; subsanabilidad concreta es decisión humana.',
        owner: 'tender_lead',
        sufficiency_note: 'La correspondencia entre el Anexo 8, los contratos del RUP y las certificaciones primarias es verificación humana.',
        char_start: 95391, char_end: 95447, quote: 'deberán adjuntar debidamente diligenciado el Anexo No. 8',
      }),
      req({
        requirement_id: 'proposal:2.4:regla-sumatoria-plural-experiencia', item_ref: '2.4',
        label: 'Regla plural de experiencia: participación del integrante y umbral del 10% para no acreditar',
        requirement_kind: 'condicional', offer_stage: 'con_la_oferta', evidence_need: 'regla_sin_evidencia_empresarial',
        candidate_evidence_class_id: null,
        rationale: 'En Consorcios o Uniones Temporales, por lo menos uno de sus integrantes debe cumplir la experiencia, teniendo en cuenta el porcentaje de participación; sólo uno de los integrantes podría no acreditar experiencia si su participación no excede el 10%. Es una regla de sumatoria/no doble conteo plural, no una evidencia adicional.',
        subsanability: 'no_determinada_requiere_humano',
        subsanability_basis: 'Depende de la modalidad plural y del porcentaje de participación; decisión humana.',
        owner: 'legal',
        sufficiency_note: 'La imputación de experiencia por participación y el no doble conteo entre integrantes es cotejo humano.',
        char_start: 95853, char_end: 95935, quote: 'Tratándose de Consorcios o Uniones Temporales, por lo menos uno de sus integrantes',
      }),
      req({
        requirement_id: 'proposal:2.4:experiencia-extranjera-traduccion', item_ref: '2.4',
        label: 'Experiencia en el extranjero: documento equivalente y traducción oficial',
        requirement_kind: 'condicional', offer_stage: 'con_la_oferta', evidence_need: 'condicional_documental',
        candidate_evidence_class_id: null,
        rationale: 'La experiencia obtenida en el extranjero se comprueba con el documento equivalente del país respectivo y, si la certificación no está en castellano, con la traducción oficial (artículo 104 de la Ley 1564 de 2012). Condición documental, no una clase de evidencia empresarial del catálogo.',
        subsanability: 'no_determinada_requiere_humano',
        subsanability_basis: 'Aplica sólo a experiencia extranjera; subsanabilidad y equivalencia documental son decisión humana.',
        owner: 'legal',
        sufficiency_note: 'La equivalencia del documento extranjero y la validez de la traducción oficial son verificación humana.',
        char_start: 96862, char_end: 96941, quote: 'Cualquier experiencia obtenida en el extranjero, se comprobará con el documento',
      }),
    ],
  },
  {
    item_ref: '2.4.1', titulo: 'CRITERIOS DIFERENCIALES PARA LA EXPERIENCIA', fase: 'habilitante',
    requirements: [
      req({
        requirement_id: 'proposal:2.4.1:diferencial-mujeres-experiencia', item_ref: '2.4.1',
        label: 'Criterio diferencial de experiencia: emprendimientos y empresas de mujeres (contratos adicionales)',
        requirement_kind: 'condicional', offer_stage: 'con_la_oferta', evidence_need: 'soporte_criterio_diferencial',
        candidate_evidence_class_id: 'differential_scoring_support',
        rationale: 'Quien acredite la calidad de emprendimiento y empresa de mujeres (art. 2.2.1.2.4.2.14 / 2.2.1.2.4.2.15 del Decreto 1082 de 2015) puede acreditar la experiencia con dos (2) contratos adicionales; se acredita con las certificaciones indicadas (representante legal/revisor fiscal/contador) bajo juramento con fecha máxima de treinta (30) días anteriores al cierre.',
        subsanability: 'subsanable_candidate',
        subsanability_basis: 'Soporte de un criterio diferencial habilitante; subsanabilidad concreta es decisión humana.',
        owner: 'legal',
        sufficiency_note: 'La acreditación de la condición de mujeres (participación, nivel directivo, vigencia de un año, vigencia de la certificación) es verificación humana.',
        char_start: 97266, char_end: 97307, quote: 'A. EMPRENDIMIENTOS Y EMPRESAS DE MUJERES:',
      }),
      req({
        requirement_id: 'proposal:2.4.1:diferencial-mipyme-experiencia', item_ref: '2.4.1',
        label: 'Criterio diferencial de experiencia: MIPYME domiciliada en Colombia (contrato adicional)',
        requirement_kind: 'condicional', offer_stage: 'con_la_oferta', evidence_need: 'soporte_criterio_diferencial',
        candidate_evidence_class_id: 'differential_scoring_support',
        rationale: 'La empresa que cumple la condición de MIPYME domiciliada en Colombia (art. 2.2.1.2.4.2.18 del Decreto 1082 de 2015) puede acreditar la experiencia con un (1) contrato adicional a los tres inicialmente definidos.',
        subsanability: 'subsanable_candidate',
        subsanability_basis: 'Soporte de un criterio diferencial habilitante; subsanabilidad concreta es decisión humana.',
        owner: 'legal',
        sufficiency_note: 'La acreditación del tamaño empresarial MIPYME y la participación plural (10%) es verificación humana.',
        char_start: 105768, char_end: 105827, quote: 'EMPRESAS QUE CUMPLEN LA CONDICIÓN DE MIPYME DOMICILIADAS EN',
      }),
      req({
        requirement_id: 'proposal:2.4.1:diferencial-discapacidad-experiencia', item_ref: '2.4.1',
        label: 'Criterio diferencial de experiencia: emprendimientos y empresas de personas con discapacidad (contrato adicional)',
        requirement_kind: 'condicional', offer_stage: 'con_la_oferta', evidence_need: 'soporte_criterio_diferencial',
        candidate_evidence_class_id: 'differential_scoring_support',
        rationale: 'Quien cumple la condición de emprendimiento y empresa de personas con discapacidad (art. 2.2.1.2.4.2.7.3 del Decreto 1082 de 2015, modificado por el Decreto 287 de 2026) puede acreditar la experiencia con un (1) contrato adicional a los tres inicialmente definidos.',
        subsanability: 'subsanable_candidate',
        subsanability_basis: 'Soporte de un criterio diferencial habilitante; subsanabilidad concreta es decisión humana.',
        owner: 'legal',
        sufficiency_note: 'La acreditación de la condición de discapacidad y la participación plural (10%) es verificación humana.',
        char_start: 107039, char_end: 107098, quote: 'C. EMPRENDIMIENTOS Y EMPRESAS DE PERSONAS CON DISCAPACIDAD:',
      }),
      req({
        requirement_id: 'proposal:2.4.1:regla-sumatoria-contratos-adicionales', item_ref: '2.4.1',
        label: 'Regla de sumatoria: los contratos adicionales (hasta 7) cuentan para los 1.000 SMLMV',
        requirement_kind: 'regla_entidad', offer_stage: 'evaluacion_entidad', evidence_need: 'regla_sin_evidencia_empresarial',
        candidate_evidence_class_id: null,
        rationale: 'Los contratos adicionales por MIPYME y/o empresa de mujeres y/o de personas con discapacidad (tres o siete según las calidades acreditadas) se tienen en cuenta para acreditar los 1.000 SMLMV. Es la regla de conteo/sumatoria de la entidad, no una evidencia empresarial.',
        subsanability: 'no_determinada_requiere_humano',
        subsanability_basis: 'Regla de conteo de la entidad; su aplicación depende de las calidades acreditadas y es decisión humana.',
        owner: 'tender_lead',
        sufficiency_note: 'El límite de contratos por calidad y el no doble conteo al sumar hacia los 1.000 SMLMV es cotejo humano.',
        char_start: 108919, char_end: 108964, quote: 'se tendrán en cuenta para acreditar los 1.000',
      }),
    ],
  },
  {
    item_ref: '2.5', titulo: 'REGLAS DE SUBSANABILIDAD', fase: 'habilitante',
    requirements: [
      req({
        requirement_id: 'proposal:2.5:regla-subsanabilidad', item_ref: '2.5',
        label: 'Regla de subsanabilidad de la entidad (Ley 1150 art. 5, num. 2, 3 y 4)',
        requirement_kind: 'regla_entidad', offer_stage: 'evaluacion_entidad', evidence_need: 'regla_sin_evidencia_empresarial',
        candidate_evidence_class_id: null,
        rationale: 'No se rechaza una propuesta por ausencia de requisitos que no constituyan factores de escogencia; los proponentes podrán subsanar dentro del término del cronograma vía SECOP II. Es una regla de evaluación de la entidad, sin evidencia empresarial del proponente.',
        subsanability: 'no_determinada_requiere_humano',
        subsanability_basis: 'La sección DEFINE la regla de subsanabilidad; qué requisito es subsanable en cada caso es decisión humana.',
        owner: 'legal',
        sufficiency_note: 'El alcance de lo subsanable (frontera con los factores de escogencia) es interpretación jurídica humana.',
        char_start: 109005, char_end: 109093, quote: 'No se rechazará una propuesta por la ausencia de requisitos o la falta de documentos que',
      }),
    ],
  },
  {
    item_ref: '3.1', titulo: 'FACTOR CALIDAD', fase: 'puntuable',
    requirements: [
      req({
        requirement_id: 'proposal:3.1:calidad-lenguaje-senas', item_ref: '3.1',
        label: 'Factor calidad: certificación de formación en lenguaje de señas de al menos 10% de los guardas (5 puntos)',
        requirement_kind: 'puntuable', offer_stage: 'con_la_oferta', evidence_need: 'certificacion_representante_legal',
        candidate_evidence_class_id: null,
        rationale: 'El proponente adjunta certificación del representante legal comprometiéndose a presentar constancia de formación en lenguaje de señas de por lo menos el 10% de los guardas; 5 puntos si cumple, 0 si no. Certificación-compromiso, sin correspondencia 1:1 con una clase de evidencia empresarial.',
        subsanability: 'no_determinada_requiere_humano',
        subsanability_basis: 'Factor de puntaje; si es subsanable o no es decisión humana (Pereira: presentado no equivale a puntuado).',
        owner: 'tender_lead',
        sufficiency_note: 'La verificación del compromiso y del umbral del 10% es cotejo humano; no se otorga puntaje aquí.',
        char_start: 117449, char_end: 117505, quote: 'Certificación Formación en Lenguaje de Señas: (5 PUNTOS)',
      }),
      req({
        requirement_id: 'proposal:3.1:calidad-capacitaciones', item_ref: '3.1',
        label: 'Factor calidad: certificación de capacitaciones adicionales, con tabla de puntaje (5 puntos)',
        requirement_kind: 'puntuable', offer_stage: 'con_la_oferta', evidence_need: 'certificacion_representante_legal',
        candidate_evidence_class_id: null,
        rationale: 'El proponente adjunta certificación del representante legal comprometiéndose a capacitaciones adicionales; el puntaje sigue una tabla (cinco o más = 5; tres a cuatro = 2; una a dos = 1; ninguna = 0). Certificación-compromiso, sin clase de evidencia empresarial 1:1.',
        subsanability: 'no_determinada_requiere_humano',
        subsanability_basis: 'Factor de puntaje; subsanabilidad es decisión humana.',
        owner: 'tender_lead',
        sufficiency_note: 'El conteo de capacitaciones comprometidas y su encuadre en la tabla de puntaje es cotejo humano.',
        char_start: 117918, char_end: 117944, quote: 'Capacitaciones: (5 PUNTOS)',
      }),
    ],
  },
  {
    item_ref: '3.2', titulo: 'APOYO A LA INDUSTRIA NACIONAL', fase: 'puntuable',
    requirements: [
      req({
        requirement_id: 'proposal:3.2:industria-nacional-servicios-colombianos', item_ref: '3.2',
        label: 'Apoyo a la industria nacional: carta jurada de personal 100% nacional (Ley 816 de 2003)',
        requirement_kind: 'puntuable', offer_stage: 'con_la_oferta', evidence_need: 'certificacion_representante_legal',
        candidate_evidence_class_id: null,
        rationale: 'El proponente adjunta carta bajo la gravedad de juramento del representante legal certificando que el personal que presta los servicios es 100% nacional (10 puntos); por cada personal extranjero se descuentan 2 puntos hasta 10; en Consorcio/UT al menos uno de los integrantes cumple. Carta jurada, sin clase de evidencia empresarial 1:1.',
        subsanability: 'no_determinada_requiere_humano',
        subsanability_basis: 'Factor de puntaje; subsanabilidad es decisión humana.',
        owner: 'tender_lead',
        sufficiency_note: 'La verificación de servicios/personal nacional colombiano y el descuento por personal extranjero es cotejo humano.',
        char_start: 119744, char_end: 119781, quote: 'presta los servicios es 100% nacional',
      }),
    ],
  },
  {
    item_ref: '3.3', titulo: 'PROPONENTES EN CONDICIÓN DE DISCAPACIDAD', fase: 'puntuable',
    requirements: [
      req({
        requirement_id: 'proposal:3.3:puntaje-discapacidad', item_ref: '3.3',
        label: 'Puntaje por vinculación/condición de discapacidad (1 punto, art. 2.2.1.2.4.2.6)',
        requirement_kind: 'puntuable', offer_stage: 'con_la_oferta', evidence_need: 'soporte_criterio_diferencial',
        candidate_evidence_class_id: 'differential_scoring_support',
        rationale: 'La entidad otorga un (1) punto a quien acredite una de las cuatro condiciones del art. 2.2.1.2.4.2.6 del Decreto 1082 de 2015 (modificado por el Decreto 0287 de 2026), mediante certificación del representante legal y la documentación correspondiente; en proponente plural se considera la planta del integrante con mayor participación.',
        subsanability: 'no_determinada_requiere_humano',
        subsanability_basis: 'Factor de puntaje diferencial; subsanabilidad es decisión humana.',
        owner: 'legal',
        sufficiency_note: 'Cuál de las cuatro condiciones se acredita y con qué soportes es verificación humana.',
        char_start: 120281, char_end: 120357, quote: 'otorgará UN (01) punto al oferente que acredite el cumplimiento de alguna de',
      }),
    ],
  },
  {
    item_ref: '3.4', titulo: 'CRITERIO DIFERENCIAL EMPRENDIMIENTO Y EMPRESA DE MUJERES', fase: 'puntuable',
    requirements: [
      req({
        requirement_id: 'proposal:3.4:puntaje-emprendimiento-empresa-mujeres', item_ref: '3.4',
        label: 'Puntaje diferencial por emprendimiento y empresa de mujeres (0.25 puntos, Anexo No. 10)',
        requirement_kind: 'puntuable', offer_stage: 'con_la_oferta', evidence_need: 'formato_anexo',
        candidate_evidence_class_id: 'differential_scoring_support',
        rationale: 'La entidad asigna 0,25 puntos a quien acredite la calidad de emprendimiento y empresa de mujeres (art. 2.2.1.2.4.2.14 del Decreto 1082 de 2015) presentando el Anexo No. 10 ACREDITACIÓN DE EMPRENDIMIENTO Y EMPRESA DE MUJERES y la documentación requerida; en plural, participación igual o superior al 10%. No excluye el puntaje MiPymes.',
        subsanability: 'no_determinada_requiere_humano',
        subsanability_basis: 'Factor de puntaje diferencial; subsanabilidad es decisión humana.',
        owner: 'legal',
        sufficiency_note: 'La acreditación de la calidad de empresa de mujeres y la participación plural es verificación humana.',
        char_start: 122367, char_end: 122415, quote: 'debe presentar el Anexo No. 10 - ACREDITACIÓN DE',
      }),
    ],
  },
  {
    item_ref: '3.5', titulo: 'CRITERIO DIFERENCIAL MIPYMES', fase: 'puntuable',
    requirements: [
      req({
        requirement_id: 'proposal:3.5:puntaje-mipyme', item_ref: '3.5',
        label: 'Puntaje diferencial MIPYME domiciliada en Colombia (0.25 puntos, Anexo No. 11)',
        requirement_kind: 'puntuable', offer_stage: 'con_la_oferta', evidence_need: 'formato_anexo',
        candidate_evidence_class_id: 'differential_scoring_support',
        rationale: 'La entidad asigna 0,25 puntos a quien acredite la calidad de MIPYME domiciliada en Colombia (tamaño empresarial del art. 2.2.1.13.2.2 del Decreto 1074 de 2015) presentando el Anexo No. 11 ACREDITACIÓN DE MIPYME y la documentación requerida; en plural, participación igual o superior al 10%.',
        subsanability: 'no_determinada_requiere_humano',
        subsanability_basis: 'Factor de puntaje diferencial; subsanabilidad es decisión humana.',
        owner: 'legal',
        sufficiency_note: 'La acreditación del tamaño empresarial MIPYME y la participación plural es verificación humana.',
        char_start: 123180, char_end: 123248, quote: 'acredite la calidad de MIPYME domiciliada en Colombia de conformidad',
      }),
    ],
  },
  {
    item_ref: '3.6', titulo: 'FACTOR ECONÓMICO', fase: 'puntuable',
    requirements: [
      req({
        requirement_id: 'proposal:3.6:oferta-economica-anexo-9', item_ref: '3.6',
        label: 'Oferta económica en el Anexo No. 9 (Excel formulado), en pesos, con AIU e impuestos',
        requirement_kind: 'puntuable', offer_stage: 'con_la_oferta', evidence_need: 'oferta_economica_anexo',
        candidate_evidence_class_id: null,
        rationale: 'La oferta económica se presenta en el Anexo No. 9 OFERTA ECONÓMICA DEFINITIVA (archivo Excel debidamente formulado), en pesos colombianos sin centavos, discriminando costos directos, indirectos y AIU e incluyendo los impuestos de ley. Es la oferta del proponente, no una clase de evidencia empresarial del catálogo.',
        subsanability: 'no_subsanable_candidate',
        subsanability_basis: 'La oferta económica es factor de escogencia; el pliego sólo admite corrección aritmética sin modificar el valor ofrecido; la no subsanabilidad del valor es decisión humana.',
        owner: 'financial',
        sufficiency_note: 'La composición de costos, AIU e impuestos y la correcta formulación del Excel son verificación humana.',
        char_start: 123997, char_end: 124040, quote: 'Diligenciar el Anexo No. 9 OFERTA ECONÓMICA',
      }),
      req({
        requirement_id: 'proposal:3.6:tarifa-minima-regulada', item_ref: '3.6',
        label: 'Admisibilidad económica: tarifa mínima regulada (Decreto 4950 de 2007 y Circular SuperVigilancia 2026)',
        requirement_kind: 'regla_entidad', offer_stage: 'evaluacion_entidad', evidence_need: 'regla_sin_evidencia_empresarial',
        candidate_evidence_class_id: null,
        rationale: 'Se evalúa que las ofertas económicas cumplan la tarifa mínima reglamentada (Decreto 4950 de 2007 y Circular Externa de la Superintendencia de Vigilancia y Seguridad Privada de 2026); la oferta que no cumpla la normatividad no se tiene en cuenta para el puntaje. Regla de admisibilidad de la entidad, sin evidencia empresarial.',
        subsanability: 'no_determinada_requiere_humano',
        subsanability_basis: 'Regla de admisibilidad de la entidad; su aplicación es interpretación humana.',
        owner: 'financial',
        sufficiency_note: 'La verificación de la tarifa mínima vigente al cierre y los incrementos regulados es cotejo humano (lección Pereira: método y tarifa varían por proceso).',
        pereira_lesson: { bucket: 'variables_por_proceso', requirement: 'Umbrales y método del factor económico', use: 'leccion_no_prueba' },
        char_start: 124245, char_end: 124331, quote: 'Se evaluará que las ofertas económicas de los proponentes cumplan con la tarifa mínima',
      }),
      req({
        requirement_id: 'proposal:3.6:metodo-media-aritmetica', item_ref: '3.6',
        label: 'Método de puntaje económico: media aritmética y asignación proporcional decreciente',
        requirement_kind: 'regla_entidad', offer_stage: 'evaluacion_entidad', evidence_need: 'regla_sin_evidencia_empresarial',
        candidate_evidence_class_id: null,
        rationale: 'El puntaje económico (78.5 puntos) se aplica con la fórmula de la Media Aritmética MA=(Po+X1+..+Xn)/(n+1), otorgando el máximo al valor más cercano a la media y un puntaje proporcional decreciente al resto. Es el método de evaluación de la entidad, sin evidencia empresarial.',
        subsanability: 'no_determinada_requiere_humano',
        subsanability_basis: 'Método de evaluación de la entidad; no es subsanable por el proponente.',
        owner: 'financial',
        sufficiency_note: 'El método aplicado, el conjunto de ofertas hábiles y el redondeo son revisión humana por proceso (lección Pereira: el método aplicado y el redondeo son revisión humana).',
        pereira_lesson: { bucket: 'variables_por_proceso', requirement: 'Umbrales y método del factor económico', use: 'leccion_no_prueba' },
        char_start: 125948, char_end: 125995, quote: 'aplicación de la fórmula de la Media Aritmética',
      }),
    ],
  },
];

export const AGT002_SECTION_PROPOSALS = Object.freeze(SECTIONS_DATA.map(section => Object.freeze({
  item_ref: section.item_ref,
  titulo: section.titulo,
  fase: section.fase,
  requirements: Object.freeze(section.requirements.slice()),
})));

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`AGT-002 propuestas pre-GO: ${label} debe ser texto no vacío.`);
  return value.trim();
}

function assertIsoTimestamp(value, label) {
  const text = requireNonEmptyString(value, label);
  if (Number.isNaN(new Date(text).getTime())) throw new Error(`AGT-002 propuestas pre-GO: ${label} debe ser una marca de tiempo ISO válida.`);
  return text;
}

// Itera cada requisito de un artefacto/catálogo con su sección, para pruebas y proyecciones.
export function* iterateProposalRequirements(artifactOrCatalog) {
  const sections = Array.isArray(artifactOrCatalog) ? artifactOrCatalog : (artifactOrCatalog?.sections || []);
  for (const section of sections) {
    for (const requirement of section.requirements || []) {
      yield { section, requirement };
    }
  }
}

// Validación estructural fail-closed de UN requisito propuesto (sin necesidad del registro).
function assertRequirementShape(section, r) {
  requireNonEmptyString(r.requirement_id, 'requirement_id');
  if (!/^proposal:[0-9.]+:[a-z0-9-]+$/.test(r.requirement_id)) {
    throw new Error(`AGT-002 propuestas pre-GO: requirement_id no determinista/semántico: ${r.requirement_id}.`);
  }
  if (!r.requirement_id.startsWith(`proposal:${section.item_ref}:`)) {
    throw new Error(`AGT-002 propuestas pre-GO: ${r.requirement_id} no codifica su ref ${section.item_ref}.`);
  }
  if (r.item_ref !== section.item_ref) throw new Error(`AGT-002 propuestas pre-GO: item_ref inconsistente en ${r.requirement_id}.`);
  if (!AGT002_REQUIREMENT_KINDS.includes(r.requirement_kind)) throw new Error(`AGT-002 propuestas pre-GO: requirement_kind inválido en ${r.requirement_id}.`);
  if (!AGT002_OFFER_STAGES.includes(r.offer_stage)) throw new Error(`AGT-002 propuestas pre-GO: offer_stage inválido en ${r.requirement_id}.`);
  if (!AGT002_EVIDENCE_NEEDS.includes(r.evidence_need)) throw new Error(`AGT-002 propuestas pre-GO: evidence_need inválido en ${r.requirement_id}.`);
  if (!AGT002_PROPOSAL_SUBSANABILITY.includes(r.subsanability?.candidate)) throw new Error(`AGT-002 propuestas pre-GO: subsanability inválida en ${r.requirement_id}.`);
  if (r.status !== AGT002_SECTION_PROPOSALS_STATUS) throw new Error(`AGT-002 propuestas pre-GO: status inesperado en ${r.requirement_id} (debe ser ${AGT002_SECTION_PROPOSALS_STATUS}).`);

  // Clase de evidencia: null, o una de las 17. Fuera de catálogo => fail-closed (no se fabrica).
  const classId = r.candidate_evidence_class_id;
  if (classId !== null && !AGT002_COMPANY_EVIDENCE_CLASS_IDS.includes(classId)) {
    throw new Error(
      `AGT-002 propuestas pre-GO: ${r.requirement_id} propone la clase "${classId}", fuera del catálogo cerrado de 17 clases; `
      + 'se rechaza en lugar de fabricarla (fail-closed).',
    );
  }
  // No mapeo arbitrario: reglas de entidad y necesidades "sólo regla" NO cargan clase empresarial.
  if (r.requirement_kind === 'regla_entidad' && classId !== null) {
    throw new Error(`AGT-002 propuestas pre-GO: ${r.requirement_id} es regla_entidad y no puede portar clase de evidencia empresarial.`);
  }
  if (r.evidence_need === 'regla_sin_evidencia_empresarial' && classId !== null) {
    throw new Error(`AGT-002 propuestas pre-GO: ${r.requirement_id} declara regla_sin_evidencia_empresarial y no puede portar clase de evidencia.`);
  }

  // Compuertas humanas presentes y sin decidir.
  if (r.applicability_gate?.decision !== 'human_required') throw new Error(`AGT-002 propuestas pre-GO: applicability_gate humana ausente en ${r.requirement_id}.`);
  if (r.sufficiency_gate?.decision !== 'human_required') throw new Error(`AGT-002 propuestas pre-GO: sufficiency_gate humana ausente en ${r.requirement_id}.`);

  // Cita corporal internamente consistente (la comprobación de span vive en el builder con registro).
  const c = r.source_citation;
  requireNonEmptyString(c?.document_id, `${r.requirement_id}.source_citation.document_id`);
  if (!Number.isInteger(c.char_start) || !Number.isInteger(c.char_end) || c.char_end <= c.char_start) {
    throw new Error(`AGT-002 propuestas pre-GO: rango de cita inválido en ${r.requirement_id}.`);
  }
  if (typeof c.quote !== 'string' || c.quote.length !== c.char_end - c.char_start) {
    throw new Error(`AGT-002 propuestas pre-GO: la cita de ${r.requirement_id} no es consistente con su rango (¿cita del cuerpo?).`);
  }
}

/**
 * Construye el artefacto de PROPUESTAS CURADAS para las 10 secciones pre-GO sin requisito
 * gobernado, verificándolo contra el registro contractual real.
 *
 * @param {object}   params.registry     Registro contractual parseado (fuente de la cobertura y de los spans de cuerpo).
 * @param {string}   params.generatedAt  Marca ISO determinista (el módulo nunca lee el reloj).
 * @param {Array}    [params.proposals]  Catálogo curado (por defecto AGT002_SECTION_PROPOSALS).
 */
export function buildAgt002PreGoSectionProposals({ registry, generatedAt, proposals = AGT002_SECTION_PROPOSALS } = {}) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    throw new Error('AGT-002 propuestas pre-GO: registry debe ser el artefacto de registro contractual.');
  }
  if (!Array.isArray(registry.items)) throw new Error('AGT-002 propuestas pre-GO: registry.items debe ser un arreglo.');
  const generatedAtIso = assertIsoTimestamp(generatedAt, 'generatedAt');

  const itemsByRef = new Map(registry.items.map(i => [i.ref, i]));

  // Cobertura EXACTA de las 10 refs declaradas (ni más, ni menos).
  const proposalRefs = proposals.map(s => s.item_ref);
  const declared = new Set(AGT002_SECTION_PROPOSAL_REFS);
  if (proposalRefs.length !== declared.size || proposalRefs.some(ref => !declared.has(ref)) || new Set(proposalRefs).size !== proposalRefs.length) {
    throw new Error('AGT-002 propuestas pre-GO: el catálogo debe cubrir exactamente las 10 secciones declaradas, sin repetir.');
  }

  const seenIds = new Set();
  const sections = proposals.map((section) => {
    const item = itemsByRef.get(section.item_ref);
    if (!item) throw new Error(`AGT-002 propuestas pre-GO: la sección ${section.item_ref} no existe en el registro contractual.`);
    // Overlay sólo para secciones SIN requisito gobernado (no compite con el extractor cerrado).
    if ((item.governed_requirement_ids || []).length !== 0) {
      throw new Error(`AGT-002 propuestas pre-GO: la sección ${section.item_ref} ya tiene requisito gobernado; el overlay no la cubre.`);
    }
    if (!Array.isArray(section.requirements) || section.requirements.length === 0) {
      throw new Error(`AGT-002 propuestas pre-GO: la sección ${section.item_ref} debe atomizar al menos un requisito.`);
    }
    for (const r of section.requirements) {
      assertRequirementShape(section, r);
      if (seenIds.has(r.requirement_id)) throw new Error(`AGT-002 propuestas pre-GO: requirement_id duplicado: ${r.requirement_id}.`);
      seenIds.add(r.requirement_id);
      // La cita debe caer DENTRO del cuerpo de la sección en el registro (no en el índice/TOC).
      const c = r.source_citation;
      if (c.char_start < item.cite.char_start || c.char_end > item.cite.char_end) {
        throw new Error(`AGT-002 propuestas pre-GO: la cita de ${r.requirement_id} cae fuera del cuerpo de la sección ${section.item_ref} (¿TOC?).`);
      }
      if (c.document_id !== (registry.vigente_pliego?.document_id || VIGENTE_PLIEGO_DOCUMENT_ID)) {
        throw new Error(`AGT-002 propuestas pre-GO: la cita de ${r.requirement_id} no referencia el pliego vigente.`);
      }
    }
    return {
      item_ref: section.item_ref,
      titulo: item.titulo,
      fase: item.fase,
      requirement_count: section.requirements.length,
      requirements: section.requirements.map(r => ({ ...r })),
    };
  });

  const totalRequirements = sections.reduce((acc, s) => acc + s.requirements.length, 0);
  const byKind = {};
  const byEvidenceNeed = {};
  let withCandidateClass = 0;
  for (const { requirement: r } of iterateProposalRequirements(sections)) {
    byKind[r.requirement_kind] = (byKind[r.requirement_kind] || 0) + 1;
    byEvidenceNeed[r.evidence_need] = (byEvidenceNeed[r.evidence_need] || 0) + 1;
    if (r.candidate_evidence_class_id !== null) withCandidateClass += 1;
  }

  const artifact = {
    artifact_type: AGT002_SECTION_PROPOSALS_ARTIFACT_TYPE,
    contract_version: AGT002_SECTION_PROPOSALS_CONTRACT_VERSION,
    status: AGT002_SECTION_PROPOSALS_STATUS,
    human_approval_required: true,
    is_approved: false,
    version: AGT002_SECTION_PROPOSALS_VERSION,
    generated_at: generatedAtIso,
    opportunity_id: typeof registry.opportunity_id === 'string' ? registry.opportunity_id : null,
    proceso: typeof registry.proceso === 'string' ? registry.proceso : null,
    entidad: typeof registry.entidad === 'string' ? registry.entidad : null,
    source_document: {
      document_id: registry.vigente_pliego?.document_id || VIGENTE_PLIEGO_DOCUMENT_ID,
      name: registry.vigente_pliego?.name || VIGENTE_PLIEGO_NAME,
    },
    pattern_reference: {
      case: 'Rama Judicial Pereira SA-MC-02-2026',
      use: 'leccion_y_provenance_de_metodo',
      not_used_as: 'prueba_de_cumplimiento_ni_traslado_de_aplicabilidad',
    },
    covers_refs: [...AGT002_SECTION_PROPOSAL_REFS],
    coverage: {
      sections: sections.length,
      requirements: totalRequirements,
      by_requirement_kind: byKind,
      by_evidence_need: byEvidenceNeed,
      with_candidate_evidence_class: withCandidateClass,
      without_candidate_evidence_class: totalRequirements - withCandidateClass,
    },
    human_gates: {
      applicability: 'decision_humana_por_seccion',
      sufficiency: 'decision_humana_por_requisito',
      go_no_go: 'compuerta_humana_obligatoria',
    },
    sections,
    probative_limits: PROBATIVE_LIMITS,
  };

  assertNoOpenPii(artifact);
  return artifact;
}

// Revalidación estructural fail-closed de un artefacto persistido/serializado (sin registro).
export function validateAgt002PreGoSectionProposals(artifact) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    throw new Error('AGT-002 propuestas pre-GO: el artefacto debe ser un objeto.');
  }
  if (artifact.artifact_type !== AGT002_SECTION_PROPOSALS_ARTIFACT_TYPE) throw new Error('AGT-002 propuestas pre-GO: artifact_type inesperado.');
  if (artifact.status !== AGT002_SECTION_PROPOSALS_STATUS) throw new Error('AGT-002 propuestas pre-GO: status inesperado.');
  if (artifact.human_approval_required !== true) throw new Error('AGT-002 propuestas pre-GO: human_approval_required debe ser true.');
  if (artifact.is_approved !== false) throw new Error('AGT-002 propuestas pre-GO: is_approved debe ser false (propuesta, no override aprobado).');
  if (!Array.isArray(artifact.sections)) throw new Error('AGT-002 propuestas pre-GO: sections debe ser un arreglo.');
  const seen = new Set();
  for (const section of artifact.sections) {
    if (!Array.isArray(section.requirements) || section.requirements.length === 0) {
      throw new Error(`AGT-002 propuestas pre-GO: la sección ${section.item_ref} debe atomizar al menos un requisito.`);
    }
    for (const r of section.requirements) {
      assertRequirementShape(section, r);
      if (seen.has(r.requirement_id)) throw new Error(`AGT-002 propuestas pre-GO: requirement_id duplicado: ${r.requirement_id}.`);
      seen.add(r.requirement_id);
    }
  }
  assertNoOpenPii(artifact);
  return artifact;
}

// Proyección para el bloque pre-GO: ref -> { requirement_ids, requirement_count, status }.
// Es un OVERLAY de propuesta (no aprobado): permite que la sección deje el bloqueador genérico
// "sin requisito gobernado" y pase a un bloqueador de propuesta pendiente de revisión humana.
export function buildAgt002SectionProposalOverlayIndex(artifactOrCatalog) {
  const index = new Map();
  const sections = Array.isArray(artifactOrCatalog) ? artifactOrCatalog : (artifactOrCatalog?.sections || []);
  for (const section of sections) {
    const requirement_ids = (section.requirements || []).map(r => r.requirement_id);
    index.set(section.item_ref, Object.freeze({
      requirement_ids: Object.freeze(requirement_ids),
      requirement_count: requirement_ids.length,
      status: AGT002_SECTION_PROPOSALS_STATUS,
    }));
  }
  return index;
}
