# Propuestas curadas de requisitos pre-GO — Rama Judicial Manizales SA-24-2026

> Artefacto: `docs/governance/propuestas/manizales-sa-24-2026.section-proposals.json` (regenerable con
> `node scripts/agt002-manizales-pre-go-section-proposals-generate.mjs`). Estado: **proposed_for_human_review**,
> `human_approval_required: true`, `is_approved: false`. Generado: 2026-08-12T05:00:00.000Z.

Overlay **LOCAL** que atomiza las diez secciones pre-GO **sin requisito gobernado** en requisitos
estables derivados del **cuerpo** del pliego vigente. **No aprueba requisitos, no habilita, no puntúa
y no afirma cumplimiento ni suficiencia**: la aplicabilidad, la suficiencia y el GO/NO-GO son compuertas
humanas. Pereira SA-MC-02-2026 se usa **sólo como lección/provenance**, nunca como prueba.

## Cobertura

- Secciones cubiertas: **10** (2.3, 2.4, 2.4.1, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6).
- Requisitos propuestos: **20**.
- Con clase de evidencia empresarial candidata (1:1 de las 17): **9**; sin clase: **11**.

| requirement_kind | # |
|---|---|
| habilitante | 3 |
| condicional | 6 |
| regla_entidad | 4 |
| puntuable | 7 |

## Requisitos propuestos por sección

### 2.3 — CAPACIDAD ORGANIZACIONAL (habilitante)

| requirement_id | kind | offer_stage | evidence_need | clase candidata | subsanabilidad |
|---|---|---|---|---|---|
| `proposal:2.3:indices-capacidad-organizacional` | habilitante | con_la_oferta | indicador_rup | rup | subsanable_candidate |
| `proposal:2.3:regla-plural-integrante-organizacional` | condicional | con_la_oferta | regla_sin_evidencia_empresarial | — | no_determinada_requiere_humano |

- **Índices de capacidad organizacional (rentabilidad del patrimonio y del activo)**
  - Racional: El pliego mide dos índices organizacionales verificados con el RUP: Rentabilidad del Patrimonio (Utilidad operacional/Patrimonio) mayor o igual a 5% y Rentabilidad del Activo (Utilidad Operacional/Activo Total) mayor o igual a 5%; no otorga puntaje y se evalúa CUMPLE/NO CUMPLE.
  - Cita corporal (9. Pliego de Condiciones Definitivo SA-24-2026.pdf [93564..93645]): «medirá el rendimiento de las inversiones y la eficiencia en el uso de los activos»
  - Aplicabilidad: human_required (financial); Suficiencia: human_required (financial).
- **Regla plural: en Consorcio/UT mínimo uno de los integrantes cumple los índices**
  - Racional: Para Consorcios o Uniones Temporales, mínimo uno de los integrantes deberá cumplir los índices de capacidad organizacional. Es una regla de aplicabilidad plural, no una evidencia empresarial adicional.
  - Cita corporal (9. Pliego de Condiciones Definitivo SA-24-2026.pdf [94135..94217]): «Para el caso de los Consorcios o Uniones Temporales, mínimo uno de los integrantes»
  - Aplicabilidad: human_required (legal); Suficiencia: human_required (legal).

### 2.4 — EXPERIENCIA (habilitante)

| requirement_id | kind | offer_stage | evidence_need | clase candidata | subsanabilidad |
|---|---|---|---|---|---|
| `proposal:2.4:experiencia-rup-unspsc-sumatoria` | habilitante | con_la_oferta | experiencia_acreditada | accredited_experience | subsanable_candidate |
| `proposal:2.4:anexo-8-formato-experiencia` | habilitante | con_la_oferta | formato_anexo | accredited_experience | subsanable_candidate |
| `proposal:2.4:regla-sumatoria-plural-experiencia` | condicional | con_la_oferta | regla_sin_evidencia_empresarial | — | no_determinada_requiere_humano |
| `proposal:2.4:experiencia-extranjera-traduccion` | condicional | con_la_oferta | condicional_documental | — | no_determinada_requiere_humano |

- **Experiencia habilitante: 1 a 3 contratos RUP (UNSPSC 92121500/92121700) con sumatoria mayor o igual a 1000 SMMLV**
  - Racional: Se verifican entre uno (1) y máximo tres (3) contratos inscritos en el RUP en al menos uno de los códigos UNSPSC (hasta tercer nivel) 92121500 Servicios de guardias / 92121700 Servicios de sistemas de seguridad, cuya sumatoria sea igual o mayor a 1000 SMMLV; CUMPLE/NO CUMPLE.
  - Cita corporal (9. Pliego de Condiciones Definitivo SA-24-2026.pdf [94814..94859]): «cuya sumatoria sea igual o mayor a 1000 SMLMV»
  - Aplicabilidad: human_required (tender_lead); Suficiencia: human_required (tender_lead).
- **Anexo No. 8 Formato de Experiencia diligenciado (relación de contratos)**
  - Racional: El proponente adjunta el Anexo No. 8 FORMATO DE EXPERIENCIA diligenciado relacionando los contratos con los que acredita la experiencia exigida.
  - Cita corporal (9. Pliego de Condiciones Definitivo SA-24-2026.pdf [95391..95447]): «deberán adjuntar debidamente diligenciado el Anexo No. 8»
  - Aplicabilidad: human_required (tender_lead); Suficiencia: human_required (tender_lead).
- **Regla plural de experiencia: participación del integrante y umbral del 10% para no acreditar**
  - Racional: En Consorcios o Uniones Temporales, por lo menos uno de sus integrantes debe cumplir la experiencia, teniendo en cuenta el porcentaje de participación; sólo uno de los integrantes podría no acreditar experiencia si su participación no excede el 10%. Es una regla de sumatoria/no doble conteo plural, no una evidencia adicional.
  - Cita corporal (9. Pliego de Condiciones Definitivo SA-24-2026.pdf [95853..95935]): «Tratándose de Consorcios o Uniones Temporales, por lo menos uno de sus integrantes»
  - Aplicabilidad: human_required (legal); Suficiencia: human_required (legal).
- **Experiencia en el extranjero: documento equivalente y traducción oficial**
  - Racional: La experiencia obtenida en el extranjero se comprueba con el documento equivalente del país respectivo y, si la certificación no está en castellano, con la traducción oficial (artículo 104 de la Ley 1564 de 2012). Condición documental, no una clase de evidencia empresarial del catálogo.
  - Cita corporal (9. Pliego de Condiciones Definitivo SA-24-2026.pdf [96862..96941]): «Cualquier experiencia obtenida en el extranjero, se comprobará con el documento»
  - Aplicabilidad: human_required (legal); Suficiencia: human_required (legal).

### 2.4.1 — CRITERIOS DIFERENCIALES PARA LA EXPERIENCIA (habilitante)

| requirement_id | kind | offer_stage | evidence_need | clase candidata | subsanabilidad |
|---|---|---|---|---|---|
| `proposal:2.4.1:diferencial-mujeres-experiencia` | condicional | con_la_oferta | soporte_criterio_diferencial | differential_scoring_support | subsanable_candidate |
| `proposal:2.4.1:diferencial-mipyme-experiencia` | condicional | con_la_oferta | soporte_criterio_diferencial | differential_scoring_support | subsanable_candidate |
| `proposal:2.4.1:diferencial-discapacidad-experiencia` | condicional | con_la_oferta | soporte_criterio_diferencial | differential_scoring_support | subsanable_candidate |
| `proposal:2.4.1:regla-sumatoria-contratos-adicionales` | regla_entidad | evaluacion_entidad | regla_sin_evidencia_empresarial | — | no_determinada_requiere_humano |

- **Criterio diferencial de experiencia: emprendimientos y empresas de mujeres (contratos adicionales)**
  - Racional: Quien acredite la calidad de emprendimiento y empresa de mujeres (art. 2.2.1.2.4.2.14 / 2.2.1.2.4.2.15 del Decreto 1082 de 2015) puede acreditar la experiencia con dos (2) contratos adicionales; se acredita con las certificaciones indicadas (representante legal/revisor fiscal/contador) bajo juramento con fecha máxima de treinta (30) días anteriores al cierre.
  - Cita corporal (9. Pliego de Condiciones Definitivo SA-24-2026.pdf [97266..97307]): «A. EMPRENDIMIENTOS Y EMPRESAS DE MUJERES:»
  - Aplicabilidad: human_required (legal); Suficiencia: human_required (legal).
- **Criterio diferencial de experiencia: MIPYME domiciliada en Colombia (contrato adicional)**
  - Racional: La empresa que cumple la condición de MIPYME domiciliada en Colombia (art. 2.2.1.2.4.2.18 del Decreto 1082 de 2015) puede acreditar la experiencia con un (1) contrato adicional a los tres inicialmente definidos.
  - Cita corporal (9. Pliego de Condiciones Definitivo SA-24-2026.pdf [105768..105827]): «EMPRESAS QUE CUMPLEN LA CONDICIÓN DE MIPYME DOMICILIADAS EN»
  - Aplicabilidad: human_required (legal); Suficiencia: human_required (legal).
- **Criterio diferencial de experiencia: emprendimientos y empresas de personas con discapacidad (contrato adicional)**
  - Racional: Quien cumple la condición de emprendimiento y empresa de personas con discapacidad (art. 2.2.1.2.4.2.7.3 del Decreto 1082 de 2015, modificado por el Decreto 287 de 2026) puede acreditar la experiencia con un (1) contrato adicional a los tres inicialmente definidos.
  - Cita corporal (9. Pliego de Condiciones Definitivo SA-24-2026.pdf [107039..107098]): «C. EMPRENDIMIENTOS Y EMPRESAS DE PERSONAS CON DISCAPACIDAD:»
  - Aplicabilidad: human_required (legal); Suficiencia: human_required (legal).
- **Regla de sumatoria: los contratos adicionales (hasta 7) cuentan para los 1.000 SMLMV**
  - Racional: Los contratos adicionales por MIPYME y/o empresa de mujeres y/o de personas con discapacidad (tres o siete según las calidades acreditadas) se tienen en cuenta para acreditar los 1.000 SMLMV. Es la regla de conteo/sumatoria de la entidad, no una evidencia empresarial.
  - Cita corporal (9. Pliego de Condiciones Definitivo SA-24-2026.pdf [108919..108964]): «se tendrán en cuenta para acreditar los 1.000»
  - Aplicabilidad: human_required (tender_lead); Suficiencia: human_required (tender_lead).

### 2.5 — REGLAS DE SUBSANABILIDAD (habilitante)

| requirement_id | kind | offer_stage | evidence_need | clase candidata | subsanabilidad |
|---|---|---|---|---|---|
| `proposal:2.5:regla-subsanabilidad` | regla_entidad | evaluacion_entidad | regla_sin_evidencia_empresarial | — | no_determinada_requiere_humano |

- **Regla de subsanabilidad de la entidad (Ley 1150 art. 5, num. 2, 3 y 4)**
  - Racional: No se rechaza una propuesta por ausencia de requisitos que no constituyan factores de escogencia; los proponentes podrán subsanar dentro del término del cronograma vía SECOP II. Es una regla de evaluación de la entidad, sin evidencia empresarial del proponente.
  - Cita corporal (9. Pliego de Condiciones Definitivo SA-24-2026.pdf [109005..109093]): «No se rechazará una propuesta por la ausencia de requisitos o la falta de documentos que»
  - Aplicabilidad: human_required (legal); Suficiencia: human_required (legal).

### 3.1 — FACTOR CALIDAD: (puntuable)

| requirement_id | kind | offer_stage | evidence_need | clase candidata | subsanabilidad |
|---|---|---|---|---|---|
| `proposal:3.1:calidad-lenguaje-senas` | puntuable | con_la_oferta | certificacion_representante_legal | — | no_determinada_requiere_humano |
| `proposal:3.1:calidad-capacitaciones` | puntuable | con_la_oferta | certificacion_representante_legal | — | no_determinada_requiere_humano |

- **Factor calidad: certificación de formación en lenguaje de señas de al menos 10% de los guardas (5 puntos)**
  - Racional: El proponente adjunta certificación del representante legal comprometiéndose a presentar constancia de formación en lenguaje de señas de por lo menos el 10% de los guardas; 5 puntos si cumple, 0 si no. Certificación-compromiso, sin correspondencia 1:1 con una clase de evidencia empresarial.
  - Cita corporal (9. Pliego de Condiciones Definitivo SA-24-2026.pdf [117449..117505]): «Certificación Formación en Lenguaje de Señas: (5 PUNTOS)»
  - Aplicabilidad: human_required (tender_lead); Suficiencia: human_required (tender_lead).
- **Factor calidad: certificación de capacitaciones adicionales, con tabla de puntaje (5 puntos)**
  - Racional: El proponente adjunta certificación del representante legal comprometiéndose a capacitaciones adicionales; el puntaje sigue una tabla (cinco o más = 5; tres a cuatro = 2; una a dos = 1; ninguna = 0). Certificación-compromiso, sin clase de evidencia empresarial 1:1.
  - Cita corporal (9. Pliego de Condiciones Definitivo SA-24-2026.pdf [117918..117944]): «Capacitaciones: (5 PUNTOS)»
  - Aplicabilidad: human_required (tender_lead); Suficiencia: human_required (tender_lead).

### 3.2 — APOYO A LA INDUSTRIA NACIONAL: (puntuable)

| requirement_id | kind | offer_stage | evidence_need | clase candidata | subsanabilidad |
|---|---|---|---|---|---|
| `proposal:3.2:industria-nacional-servicios-colombianos` | puntuable | con_la_oferta | certificacion_representante_legal | — | no_determinada_requiere_humano |

- **Apoyo a la industria nacional: carta jurada de personal 100% nacional (Ley 816 de 2003)**
  - Racional: El proponente adjunta carta bajo la gravedad de juramento del representante legal certificando que el personal que presta los servicios es 100% nacional (10 puntos); por cada personal extranjero se descuentan 2 puntos hasta 10; en Consorcio/UT al menos uno de los integrantes cumple. Carta jurada, sin clase de evidencia empresarial 1:1.
  - Cita corporal (9. Pliego de Condiciones Definitivo SA-24-2026.pdf [119744..119781]): «presta los servicios es 100% nacional»
  - Aplicabilidad: human_required (tender_lead); Suficiencia: human_required (tender_lead).

### 3.3 — PROPONENTES EN CONDICIÓN DE DISCAPACIDAD: (puntuable)

| requirement_id | kind | offer_stage | evidence_need | clase candidata | subsanabilidad |
|---|---|---|---|---|---|
| `proposal:3.3:puntaje-discapacidad` | puntuable | con_la_oferta | soporte_criterio_diferencial | differential_scoring_support | no_determinada_requiere_humano |

- **Puntaje por vinculación/condición de discapacidad (1 punto, art. 2.2.1.2.4.2.6)**
  - Racional: La entidad otorga un (1) punto a quien acredite una de las cuatro condiciones del art. 2.2.1.2.4.2.6 del Decreto 1082 de 2015 (modificado por el Decreto 0287 de 2026), mediante certificación del representante legal y la documentación correspondiente; en proponente plural se considera la planta del integrante con mayor participación.
  - Cita corporal (9. Pliego de Condiciones Definitivo SA-24-2026.pdf [120281..120357]): «otorgará UN (01) punto al oferente que acredite el cumplimiento de alguna de»
  - Aplicabilidad: human_required (legal); Suficiencia: human_required (legal).

### 3.4 — CRITERIO DIFERENCIAL EMPRENDIMIENTO Y EMPRESA DE MUJERES: (puntuable)

| requirement_id | kind | offer_stage | evidence_need | clase candidata | subsanabilidad |
|---|---|---|---|---|---|
| `proposal:3.4:puntaje-emprendimiento-empresa-mujeres` | puntuable | con_la_oferta | formato_anexo | differential_scoring_support | no_determinada_requiere_humano |

- **Puntaje diferencial por emprendimiento y empresa de mujeres (0.25 puntos, Anexo No. 10)**
  - Racional: La entidad asigna 0,25 puntos a quien acredite la calidad de emprendimiento y empresa de mujeres (art. 2.2.1.2.4.2.14 del Decreto 1082 de 2015) presentando el Anexo No. 10 ACREDITACIÓN DE EMPRENDIMIENTO Y EMPRESA DE MUJERES y la documentación requerida; en plural, participación igual o superior al 10%. No excluye el puntaje MiPymes.
  - Cita corporal (9. Pliego de Condiciones Definitivo SA-24-2026.pdf [122367..122415]): «debe presentar el Anexo No. 10 - ACREDITACIÓN DE»
  - Aplicabilidad: human_required (legal); Suficiencia: human_required (legal).

### 3.5 — CRITERIO DIFERENCIAL MIPYMES: (puntuable)

| requirement_id | kind | offer_stage | evidence_need | clase candidata | subsanabilidad |
|---|---|---|---|---|---|
| `proposal:3.5:puntaje-mipyme` | puntuable | con_la_oferta | formato_anexo | differential_scoring_support | no_determinada_requiere_humano |

- **Puntaje diferencial MIPYME domiciliada en Colombia (0.25 puntos, Anexo No. 11)**
  - Racional: La entidad asigna 0,25 puntos a quien acredite la calidad de MIPYME domiciliada en Colombia (tamaño empresarial del art. 2.2.1.13.2.2 del Decreto 1074 de 2015) presentando el Anexo No. 11 ACREDITACIÓN DE MIPYME y la documentación requerida; en plural, participación igual o superior al 10%.
  - Cita corporal (9. Pliego de Condiciones Definitivo SA-24-2026.pdf [123180..123248]): «acredite la calidad de MIPYME domiciliada en Colombia de conformidad»
  - Aplicabilidad: human_required (legal); Suficiencia: human_required (legal).

### 3.6 — FACTOR ECONÓMICO: (puntuable)

| requirement_id | kind | offer_stage | evidence_need | clase candidata | subsanabilidad |
|---|---|---|---|---|---|
| `proposal:3.6:oferta-economica-anexo-9` | puntuable | con_la_oferta | oferta_economica_anexo | — | no_subsanable_candidate |
| `proposal:3.6:tarifa-minima-regulada` | regla_entidad | evaluacion_entidad | regla_sin_evidencia_empresarial | — | no_determinada_requiere_humano |
| `proposal:3.6:metodo-media-aritmetica` | regla_entidad | evaluacion_entidad | regla_sin_evidencia_empresarial | — | no_determinada_requiere_humano |

- **Oferta económica en el Anexo No. 9 (Excel formulado), en pesos, con AIU e impuestos**
  - Racional: La oferta económica se presenta en el Anexo No. 9 OFERTA ECONÓMICA DEFINITIVA (archivo Excel debidamente formulado), en pesos colombianos sin centavos, discriminando costos directos, indirectos y AIU e incluyendo los impuestos de ley. Es la oferta del proponente, no una clase de evidencia empresarial del catálogo.
  - Cita corporal (9. Pliego de Condiciones Definitivo SA-24-2026.pdf [123997..124040]): «Diligenciar el Anexo No. 9 OFERTA ECONÓMICA»
  - Aplicabilidad: human_required (financial); Suficiencia: human_required (financial).
- **Admisibilidad económica: tarifa mínima regulada (Decreto 4950 de 2007 y Circular SuperVigilancia 2026)**
  - Racional: Se evalúa que las ofertas económicas cumplan la tarifa mínima reglamentada (Decreto 4950 de 2007 y Circular Externa de la Superintendencia de Vigilancia y Seguridad Privada de 2026); la oferta que no cumpla la normatividad no se tiene en cuenta para el puntaje. Regla de admisibilidad de la entidad, sin evidencia empresarial.
  - Cita corporal (9. Pliego de Condiciones Definitivo SA-24-2026.pdf [124245..124331]): «Se evaluará que las ofertas económicas de los proponentes cumplan con la tarifa mínima»
  - Aplicabilidad: human_required (financial); Suficiencia: human_required (financial).
- **Método de puntaje económico: media aritmética y asignación proporcional decreciente**
  - Racional: El puntaje económico (78.5 puntos) se aplica con la fórmula de la Media Aritmética MA=(Po+X1+..+Xn)/(n+1), otorgando el máximo al valor más cercano a la media y un puntaje proporcional decreciente al resto. Es el método de evaluación de la entidad, sin evidencia empresarial.
  - Cita corporal (9. Pliego de Condiciones Definitivo SA-24-2026.pdf [125948..125995]): «aplicación de la fórmula de la Media Aritmética»
  - Aplicabilidad: human_required (financial); Suficiencia: human_required (financial).

## Límites probatorios

- Estas son PROPUESTAS CURADAS para revisión humana, no requisitos gobernados aprobados: no habilitan, no puntúan y no afirman cumplimiento ni suficiencia.
- La atomización se deriva del cuerpo del pliego vigente (por offsets), nunca del índice/TOC ni de contenido inventado.
- La clase de evidencia empresarial es sólo CANDIDATA y sólo se propone cuando hay correspondencia conceptual 1:1 con una de las 17 clases gobernadas; en caso contrario es null.
- Las reglas de evaluación de la entidad (subsanabilidad, tarifa mínima, media aritmética) se marcan sin clase de evidencia empresarial.
- La aplicabilidad (modalidad del proponente) y la suficiencia (umbrales, sumatoria, no doble conteo, método) son compuertas humanas; nunca se afirman aquí.
- Rama Judicial Pereira se usa sólo como lección/provenance de método; no prueba cumplimiento de Manizales ni traslada aplicabilidad. No se fuerza CCTV ni se reutiliza Pereira como evidencia.
