# Análisis pre-GO gobernado — Rama Judicial Manizales SA-24-2026

> Artefacto: `docs/governance/analisis/manizales-sa-24-2026.pre-go-analysis.json` (regenerable con
> `node scripts/agt002-manizales-pre-go-analysis-generate.mjs`). Estado: **draft_for_human_review**,
> `human_approval_required: true`. Generado: 2026-08-12T05:00:00.000Z.

Este bloque **cruza** cada sección relevante del registro contractual con la evidencia
empresarial gobernada. **No decide cumplimiento, habilitación, puntaje ni GO/NO-GO**: esas son
compuertas humanas. Pereira SA-MC-02-2026 se incorpora **sólo como patrón**, nunca como prueba.

## Entorno local y sus límites

- Bóveda de evidencia empresarial (17 clases): **no observable localmente** (vive en Supabase; no se accede).
- Corpus legal publicado: **ausente** → la verificación jurídica **no se muestra** (gated).
- Por ello, las secciones relevantes con enlace gobernado quedan honestamente **unverifiable** (no *missing*).

## Matriz de estados (cobertura estructural, no exhaustividad humana)

| Estado de cruce | Secciones |
|---|---|
| satisfied_candidate | 0 |
| missing | 0 |
| stale | 0 |
| not_applicable_candidate | 53 |
| unverifiable | 15 |
| human_review_required | 0 |
| **Total** | **68** |

- Secciones relevantes pre-GO (oferta): **15** de 68 (22.1%).
- Secciones no aplicables pre-GO (explicadas por fase): **53**.

### Por fase

| Fase | Política probatoria | Secciones |
|---|---|---|
| generalidad | context_no_offer_obligation | 26 |
| habilitante | offer_requirement | 7 |
| puntuable | offer_requirement | 6 |
| evaluacion | entity_evaluation_rule | 5 |
| ejecucion_tecnica | post_award_execution | 8 |
| postadjudicacion | post_award | 16 |

> Fases que **no** requieren evidencia pre-GO del proponente: `postadjudicacion`, `ejecucion_tecnica`
> (obligaciones de ejecución post-adjudicación), `evaluacion` (regla de la entidad) y la mayoría de
> `generalidad` (contexto), salvo secciones del Capítulo I que reexpresan un requisito habilitante.

## Secciones relevantes (cruce sección ↔ evidencia)

| Sección | Fase | Estado | Razón | Subsanabilidad |
|---|---|---|---|---|
| 1.3 | generalidad | unverifiable | clase_de_evidencia_no_observada_localmente | no_subsanable |
| 1.9 | generalidad | unverifiable | clase_de_evidencia_no_observada_localmente | no_determinado |
| 2.1 | habilitante | unverifiable | clase_de_evidencia_no_observada_localmente | no_subsanable |
| 2.2 | habilitante | unverifiable | clase_de_evidencia_no_observada_localmente | no_determinado |
| 2.3 | habilitante | unverifiable | seccion_con_propuesta_curada_proposed_para_revision_humana | no_determinado |
| 2.4 | habilitante | unverifiable | seccion_con_propuesta_curada_proposed_para_revision_humana | no_determinado |
| 2.4.1 | habilitante | unverifiable | seccion_con_propuesta_curada_proposed_para_revision_humana | no_determinado |
| 2.5 | habilitante | unverifiable | seccion_con_propuesta_curada_proposed_para_revision_humana | no_determinado |
| 2.6 | habilitante | unverifiable | clase_de_evidencia_no_observada_localmente | no_determinado |
| 3.1 | puntuable | unverifiable | seccion_con_propuesta_curada_proposed_para_revision_humana | no_determinado |
| 3.2 | puntuable | unverifiable | seccion_con_propuesta_curada_proposed_para_revision_humana | no_determinado |
| 3.3 | puntuable | unverifiable | seccion_con_propuesta_curada_proposed_para_revision_humana | no_determinado |
| 3.4 | puntuable | unverifiable | seccion_con_propuesta_curada_proposed_para_revision_humana | no_determinado |
| 3.5 | puntuable | unverifiable | seccion_con_propuesta_curada_proposed_para_revision_humana | no_determinado |
| 3.6 | puntuable | unverifiable | seccion_con_propuesta_curada_proposed_para_revision_humana | no_determinado |

## Bloqueadores

- **[subsanable] evidencia_empresarial_no_observable_localmente**: La bóveda de evidencia empresarial (17 clases) no es observable en el entorno local; las secciones relevantes con enlace gobernado quedan unverifiable. — secciones: 1.3, 1.9, 2.1, 2.2, 2.6
  - Remediación: Sincronizar/gobernar el registro de evidencia empresarial (psi_agt002_company_evidence_registry) y adjuntar por identificador; verificación humana. (responsable sugerido: tender_lead).
- **[subsanable] secciones_con_propuesta_de_requisitos_para_revision_humana**: Secciones de oferta con PROPUESTA CURADA de requisitos atomizados (overlay local, no aprobado): requieren revisión y aprobación humana antes de convertirse en requisitos gobernados; no afirman cumplimiento ni suficiencia. — secciones: 2.3, 2.4, 2.4.1, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
  - Remediación: Revisar y aprobar (o ajustar) las propuestas de requisitos por sección (artefacto agt002_pre_go_section_proposals); sólo tras GO humano se convierten en requirement_manifest gobernado. (responsable sugerido: legal).
- **[subsanable] requisito_gobernado_sin_enlace_de_clase**: Requisitos gobernados sin clase de evidencia enlazada (p.ej. alcance de videovigilancia/CCTV): permanecen en abstención hasta curar el enlace y revisar el documento. — secciones: 2.1
  - Remediación: Proponer evidence_class_link gobernado y revisión documental humana; mantener CCTV en abstención mientras no haya evidencia concluyente nueva. (responsable sugerido: technical).
- **[subsanable] verificacion_juridica_no_disponible_sin_corpus**: No hay versión publicada de corpus legal; la verificación jurídica no se muestra.
  - Remediación: Publicar y verificar una versión de corpus legal (psi_agt002_legal_corpus_versions) por decisión humana. (responsable sugerido: legal).

## Preguntas indispensables (para el humano)

- **modalidad_del_proponente** (eje: aplicabilidad): ¿Cuál es la modalidad del proponente (persona natural/jurídica/consorcio/UT y régimen diferencial)? Determina la aplicabilidad de la mayoría de secciones.
- **version_del_pliego_al_cierre** (eje: vigencia): ¿Qué versión del pliego (y adendas/respuestas a observaciones) gobierna al cierre? Lección Pereira: las reglas vigentes al cierre pueden diferir del pliego base.
- **boveda_de_evidencia_sincronizada** (eje: presencia): ¿Está sincronizada y gobernada la bóveda de evidencia empresarial para esta oportunidad? Sin ella el cruce es unverifiable, no missing.
- **suficiencia_de_umbrales** (eje: suficiencia): ¿La suficiencia de umbrales (liquidez, capital de trabajo, experiencia ≥ % del POE, sumas de pólizas, territorialidad de licencias) satisface el pliego? Es cotejo humano.
- **compromisos_de_ejecucion_en_oferta** (eje: aplicabilidad): ¿Requiere el pliego cartas de compromiso u obligaciones de ejecución declaradas EN la oferta? Su viabilidad es decisión humana (no se cruza como evidencia post-adjudicación).

## Abstenciones

- Cobertura **estructural**, no exhaustividad humana: La cobertura es estructural (68 secciones); no afirma exhaustividad humana ni revisión jurídica completa.
- **aplicabilidad** (todas_las_secciones): La aplicabilidad por modalidad del proponente es decisión humana en las 68 secciones.
- **suficiencia** (todas_las_secciones_relevantes): La suficiencia de licencias/pólizas/experiencia/umbrales es decisión humana; nunca se afirma aquí.
- **videovigilancia_cctv** (2.1): El alcance de videovigilancia/CCTV permanece en abstención (sin clase de evidencia enlazada ni evidencia concluyente nueva).

## Riesgos

### juridico
- (alto) Contradicciones internas del pliego (cláusula penal, RCE habilitante vs contractual, días de grabación, UNSPSC, numeración) deben reconciliarse por humano. _[pereira:universales]_
- (alto) Sin corpus legal publicado no hay verificación jurídica; la habilitación jurídica no puede evaluarse localmente. _[corpus_ausente]_

### financiero
- (alto) Base de cálculo de la garantía de seriedad (10% del POE vigente, no del total de CDP) y suficiencia de indicadores financieros son cotejo humano. _[pereira:variables_por_proceso]_

### tecnico
- (medio) La cobertura de medios tecnológicos/CCTV y la territorialidad de licencias no están probadas; permanecen en abstención. _[pereira:variables_por_proceso]_

### operativo
- (alto) La evidencia empresarial no es observable localmente (15 secciones unverifiable); se requiere sincronización gobernada y minimización de PII de personal. _[local_gap]_

## Recomendación (SÓLO candidata — GO/NO-GO humano obligatorio)

- **recommendation_candidate: indeterminate** (confianza: low).
- recommendation_candidate NO es una recomendación jurídica ni una decisión: el GO/NO-GO es una compuerta humana obligatoria.
- A favor:
  - El registro cataloga estructuralmente las 68 secciones del pliego vigente, lo que da trazabilidad para la decisión humana.
- En contra:
  - 15 sección(es) relevante(s) unverifiable: no hay evidencia observable localmente ni mapeo suficiente.
  - No hay verificación jurídica (corpus legal ausente).

## Patrón Pereira (taxonomía y escalera probatoria — no prueba de Manizales)

- Caso: Rama Judicial Pereira SA-MC-02-2026 — uso: `patron_no_prueba`.
- Universales: 6; variables por proceso: 5; post-adjudicación: 3.

## Límites probatorios

- El análisis pre-GO cruza requisitos del pliego vigente con evidencia empresarial gobernada; no decide cumplimiento, habilitación, puntaje ni GO/NO-GO.
- satisfied_candidate significa evidencia candidata (presente/vigente/aplicable/revisada); la SUFICIENCIA jurídica y la habilitación son decisión humana.
- La aplicabilidad de cada sección (modalidad del proponente, régimen diferencial) es abstención humana; ninguna sección se afirma aplicable automáticamente.
- Presentado no equivale a aceptado ni a adjudicado; el análisis nunca infiere resultados de evaluación.
- Ausencia de SEÑAL de una clase de evidencia (unverifiable) no equivale a ausencia del documento (missing): son estados distintos y no intercambiables.
- Sin una versión publicada de corpus legal no se muestra verificación jurídica.
- La cobertura es estructural (68 secciones registradas); no constituye exhaustividad humana ni revisión jurídica.
- Rama Judicial Pereira se incorpora como patrón de taxonomía/escalera probatoria; no prueba cumplimiento de Manizales ni traslada aplicabilidad.

> Enlace gobernado tomado del borrador local v3 (`docs/governance/drafts/…`);
> requisitos habilitantes: financial-working-capital, legal-rce-policy, legal-collective-life-policy.
