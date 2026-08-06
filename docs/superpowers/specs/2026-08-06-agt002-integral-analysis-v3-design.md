# Diseño — contrato integral AGT‑002 v3

**Fecha:** 2026-08-06
**Estado:** propuesta cerrada para revisión técnica; no implementada
**Producto:** SIIO — Licitaciones / Oportunidades
**Agente visible:** Vig‑IA · Copiloto de Licitaciones
**Identificador:** `AGT-002`
**Auditoría base:** `docs/superpowers/specs/2026-08-06-agt002-integral-analysis-v3-audit.md`

## 1. Decisión

El contrato v3 sustituye las listas genéricas como fuente analítica por una secuencia cerrada de unidades de análisis. Cada requisito gobernado aparece exactamente una vez y combina, en una sola unidad, su efecto comercial, lectura jurídica, evidencia, faltantes y tratamiento operativo propuesto.

Vig‑IA analiza y recomienda. No decide GO/NO-GO, no aprueba, no asigna personas, no firma, no envía y no presenta.

## 2. Objetivos

1. Analizar en orden institucional: descarte → habilitantes → técnico → financiero/ejecución → estratégico.
2. Evitar que presencia documental se confunda con revisión, vigencia, aplicabilidad o cumplimiento.
3. Exigir evidencia o abstención para toda conclusión material.
4. Convertir cada hallazgo en una unidad accionable con rol sugerido, hito, escalamiento, cierre y validación humana.
5. Mantener intactos runs v2 y consumidores actuales mediante una proyección determinística.
6. Transportar sólo referencias y metadatos permitidos; nunca contenido documental bruto ni datos sensibles.

## 3. Fuera de alcance

- UI o rollout visual;
- procesamiento de expedientes reales;
- backfill de runs v2;
- migración o despliegue remoto;
- asignación nominal de responsables;
- automatización de comunicaciones, firma, envío o presentación;
- decisión jurídica definitiva;
- modificación del gate humano GO/NO-GO.

## 4. Arquitectura de contrato

### 4.1 Entrada gobernada

El análisis v3 consume el contexto y artefactos ya versionados:

- snapshot documental;
- versión de contexto AGT‑002;
- manifiesto completo de requisitos;
- cobertura y allowlist de evidencia documental;
- manifiesto de las 17 clases de evidencia empresarial;
- evidencia humana autorizada;
- versión y allowlist del corpus jurídico;
- validaciones objetivas determinísticas.

La entrada del modelo puede incluir fragmentos recuperados bajo presupuesto, pero el resultado persistido sólo conserva referencias y síntesis analíticas acotadas.

### 4.2 Payload nativo del modelo y envelope gobernado

El modelo devuelve únicamente un payload cerrado:

```json
{
  "integral_analysis": {
    "contract_version": "agt002-integral-analysis-v3",
    "coverage": {},
    "analysis_units": []
  }
}
```

El modelo **no** entrega identidad del run, snapshot, versiones, coverage externo, usage ni listas v2. El engine valida el payload contra las allowlists del input y sólo después ensambla el envelope gobernado `schema_version: "3.0.0"`:

```json
{
  "schema_version": "3.0.0",
  "agent_id": "AGT-002",
  "run_id": "uuid",
  "policy_version": "texto-versionado",
  "snapshot_id": "uuid",
  "context_version_id": "uuid",
  "status": "completed",
  "method": "agent_ai",
  "integral_analysis": {},
  "evidence_coverage": {},
  "legal_corpus_version_id": "uuid-or-null",
  "human_review_required": true,
  "usage": {}
}
```

`run_id`, identidad, versiones, coverage, corpus y usage proceden del engine/contexto gobernado y no pueden ser suministrados ni sobrescritos por la respuesta del modelo.

El modelo tampoco entrega `recommendation`, `strengths`, `weaknesses`, `blockers`, `questions`, `unverified` ni `next_action`. Backend los deriva de `integral_analysis` para compatibilidad.

### 4.3 Persistencia

El run v3 persiste:

- `integral_analysis` validado;
- proyección v2 determinística;
- referencias de snapshot, contexto y corpus ya existentes;
- coverage y usage vigentes;
- versión de esquema/política/modelo;
- `critical_open_count` derivado.

No se reescribe ningún run v2.

## 5. Cobertura integral

`integral_analysis.coverage` es un objeto cerrado:

```json
{
  "manifest_version": "agt002-deep-analysis-v1",
  "expected_requirement_ids": ["..."],
  "analyzed_requirement_ids": ["..."],
  "material_omissions": false,
  "omission_reasons": [],
  "company_evidence_manifest_version": "agt002-company-evidence-classes-v1",
  "company_evidence_class_ids": ["...17 ids..."],
  "legal_corpus_version_id": "uuid-or-null"
}
```

### Invariantes

1. `expected_requirement_ids` coincide exactamente con el manifiesto validado, en orden canónico.
2. Cada ID esperado aparece exactamente una vez como unidad `tender_requirement`.
3. `analyzed_requirement_ids` no contiene extras, duplicados ni cambios de orden.
4. Las 17 clases empresariales aparecen exactamente una vez en el manifiesto externo ya validado; v3 sólo referencia su versión e IDs.
5. Si existen omisiones materiales de retrieval, todas las unidades afectadas usan `assessment_mode: abstained`.
6. `material_omissions: false` no significa cumplimiento; sólo cobertura de insumos conforme al presupuesto/manifest.
7. `legal_corpus_version_id: null` obliga a que todo fundamento jurídico quede ausente o no verificado y requiera revisión humana.

## 6. Unidad canónica de análisis

Cada elemento de `analysis_units` es un objeto cerrado:

```json
{
  "unit_id": "estable-y-unico",
  "unit_kind": "tender_requirement | strategic_consideration",
  "requirement_id": "id-del-manifiesto-o-null",
  "category": "discard | habilitating | technical | financial_execution | strategic",
  "sequence": 1,
  "title": "síntesis acotada",
  "assessment_mode": "assessed | abstained",
  "conclusion": {
    "status": "supported_with_evidence | partially_supported | gap_evidenced | insufficient_evidence | human_validation_required",
    "summary": "síntesis acotada",
    "confidence": "high | medium | low | unavailable"
  },
  "blocking": {
    "effect": "blocker | conditional | non_blocking | undetermined",
    "curability": "curable | not_curable | undetermined | not_applicable",
    "reason": "síntesis acotada"
  },
  "evidence_state": {
    "presence": "present | absent | unknown",
    "review": "reviewed | partially_reviewed | not_reviewed",
    "validity": "valid | expired | unknown | not_applicable",
    "applicability": "applicable | not_applicable | unknown",
    "compliance": "supported_pending_human_review | partially_supported_pending_human_review | gap_evidenced_pending_human_review | unknown"
  },
  "evidence_refs": [],
  "missing_evidence": [],
  "commercial_impact": {},
  "legal_assessment": {},
  "actions": [],
  "milestone": {},
  "escalation": {},
  "closure": {},
  "human_validation": {}
}
```

## 7. Tipos y reglas por campo

### 7.1 Identidad y orden

- `unit_id`: string estable, único, longitud acotada, sin PII.
- `unit_kind`: `tender_requirement` o `strategic_consideration`.
- `requirement_id`:
  - obligatorio y allowlisted para `tender_requirement`;
  - `null` para `strategic_consideration`.
- `category`:
  - requisitos formales usan una de las primeras cuatro categorías;
  - consideraciones estratégicas usan exclusivamente `strategic`.
- `sequence`: entero positivo, estrictamente ascendente.

Orden numérico obligatorio:

1. `discard`;
2. `habilitating`;
3. `technical`;
4. `financial_execution`;
5. `strategic`.

Dentro de las cuatro primeras categorías se conserva el orden del manifiesto; las consideraciones estratégicas se ordenan establemente por `unit_id`.

### 7.2 Conclusión

Estados cerrados:

- `supported_with_evidence`: la evidencia disponible sustenta una lectura favorable **pendiente de validación humana**; no declara cumplimiento institucional definitivo;
- `partially_supported`: existe sustento parcial, también pendiente de validación humana;
- `gap_evidenced`: existe una diferencia comprobable con evidencia suficiente, sin convertirla en decisión automática;
- `insufficient_evidence`: falta evidencia para concluir;
- `human_validation_required`: existe sustento, pero una persona debe resolver aplicabilidad, equivalencia o juicio.

Reglas:

- estados favorables, parciales o de gap material requieren al menos una referencia relevante;
- ninguna salida de IA puede usar `complied`, `sufficient`, `approved` ni equivalentes definitivos;
- `insufficient_evidence` exige `assessment_mode: abstained` y al menos un faltante;
- `assessment_mode: abstained` sólo permite `insufficient_evidence` o `human_validation_required`;
- `confidence: unavailable` exige abstención;
- `summary` no puede afirmar cumplimiento cuando algún eje requerido está `unknown` y siempre queda pendiente de validación humana.

### 7.3 Efecto bloqueante y subsanabilidad

`blocking.effect`:

- `blocker`: requisito que puede impedir participar o ejecutar según evidencia;
- `conditional`: riesgo condicionado a subsanación/validación;
- `non_blocking`: sin efecto bloqueante demostrado;
- `undetermined`: no hay evidencia suficiente.

`blocking.curability`:

- `curable`;
- `not_curable`;
- `undetermined`;
- `not_applicable`.

Reglas:

- no se puede marcar `not_curable` sin evidencia del pliego o fundamento jurídico allowlisted;
- `effect: blocker` con `assessment_mode: abstained` es inválido; debe ser `undetermined`;
- `non_blocking` no equivale a cumplido;
- toda unidad `blocker` o `conditional` exige acción, condición de cierre y validación humana pendiente.

### 7.4 Cinco ejes independientes

Los ejes no se derivan unos de otros:

1. `presence`: existe o no evidencia candidata;
2. `review`: fue revisada o no;
3. `validity`: está vigente, vencida o no verificada;
4. `applicability`: aplica, no aplica o es incierto;
5. `compliance`: sustento favorable, parcial, gap evidenciado o incertidumbre; en la salida de IA todos los estados materiales permanecen pendientes de revisión humana.

Combinaciones prohibidas:

- `reviewed` con `presence: absent`;
- `valid` o `expired` con `presence: absent`;
- cualquier estado de compliance distinto de `unknown` con `review: not_reviewed`;
- `supported_pending_human_review` con `validity: expired` cuando la vigencia sea material;
- `supported_pending_human_review` con `applicability: unknown`;
- cualquier estado material de compliance sin referencias;
- `compliant`, `sufficient`, `approved` o equivalentes definitivos en cualquier eje producido por IA.

`validity: not_applicable` y `applicability: not_applicable` son valores independientes y sólo pueden usarse en su eje correspondiente; uno no implica automáticamente el otro.

### 7.5 Referencias de evidencia

Cada referencia es cerrada:

```json
{
  "ref": "identificador-allowlisted",
  "source_type": "tender_document | company_evidence | legal_corpus | human_evidence | objective_validation",
  "purpose": "requirement_basis | company_capacity | legal_basis | commercial_context | milestone_basis | gap_basis"
}
```

Reglas:

- `ref` debe existir en la allowlist correspondiente del input;
- no se persiste excerpt, chunk text, nombre de persona, cuenta bancaria, arma, credencial ni contenido de anexo;
- no hay referencias duplicadas por `(ref, purpose)`;
- un fundamento jurídico usa `source_type: legal_corpus`;
- una fecha/hito verificado necesita `purpose: milestone_basis`;
- una diferencia comprobable necesita `purpose: gap_basis` o evidencia equivalente explícita.

### 7.6 Evidencia faltante

```json
{
  "missing_id": "estable",
  "evidence_class_id": "catalog-id-or-null",
  "needed_source_type": "tender_document | company_evidence | legal_corpus | human_evidence | objective_validation",
  "reason": "síntesis acotada",
  "critical": true
}
```

- `evidence_class_id` sólo acepta uno de los 17 IDs cuando el faltante es corporativo;
- no se inventan documentos concretos no presentes en catálogo;
- al menos un faltante crítico deriva una pregunta v2 crítica;
- faltantes nunca se convierten en evidencia negativa por sí solos.

### 7.7 Impacto comercial

```json
{
  "level": "critical | high | medium | low | unknown",
  "summary": "impacto sobre participación, capacidad, costo, plazo o estrategia",
  "dimension": "eligibility | competitiveness | delivery_capacity | financial_exposure | strategic_fit | unknown"
}
```

- expresa impacto, no decisión;
- `strategic_fit` no puede convertir una consideración estratégica en requisito habilitante;
- `unknown` exige lenguaje de abstención.

### 7.8 Evaluación jurídica

```json
{
  "status": "supported | partially_supported | unsupported | not_verified | not_applicable",
  "basis_refs": ["legal-ref"],
  "summary": "impacto y acción, no listado de normas",
  "human_legal_review_required": true
}
```

- `basis_refs` se validan contra el corpus publicado del run;
- `supported` exige referencias con vigencia y aplicabilidad verificables en input;
- `not_verified` obliga `human_legal_review_required: true`;
- el resumen describe impacto y acción; no emite asesoría jurídica definitiva;
- una norma presente no implica vigencia, aplicabilidad ni cumplimiento.

### 7.9 Acciones y roles

```json
{
  "action_id": "estable",
  "action_type": "obtain_evidence | verify_validity | validate_applicability | remediate_gap | estimate_delivery | estimate_financial_exposure | human_decision",
  "summary": "acción concreta y acotada",
  "basis_unit_id": "unit-id-del-mismo-requisito",
  "suggested_role": "tender_lead | legal | commercial | technical | financial | operations | management | authorized_human",
  "priority": "critical | high | medium | low",
  "external_side_effect": false
}
```

- `basis_unit_id` debe coincidir con el `unit_id` contenedor y hace trazable la acción a esa unidad y sus citas;
- nunca contiene nombre, correo ni ID de persona;
- nunca autoriza ejecución automática;
- `external_side_effect` debe ser siempre `false` en el envelope de IA;
- `human_decision` sólo sugiere revisión/decisión por una persona autorizada.

### 7.10 Hito

```json
{
  "status": "verified | unverified | not_identified",
  "type": "submission_deadline | clarification_deadline | cure_deadline | visit | hearing | execution_start | execution_duration | internal_review | other | none",
  "at": "ISO-8601-or-null",
  "source_ref": "allowlisted-ref-or-null",
  "summary": "texto acotado"
}
```

- `verified` exige `at` y `source_ref`;
- `unverified` permite fecha candidata, pero prohíbe tratarla como deadline cierto;
- `not_identified` exige `at: null` y `source_ref: null`;
- el modelo no inventa hitos internos ni SLA.

### 7.11 Escalamiento

```json
{
  "required": true,
  "level": "role_review | cross_functional | committee | management | none",
  "reason": "síntesis acotada"
}
```

- `required: false` exige `level: none`;
- bloqueadores no subsanables, incertidumbre jurídica material o exposición crítica exigen escalamiento;
- escalamiento es recomendación de revisión, no creación automática de tarea o comité.

### 7.12 Cierre

```json
{
  "status": "open | evidence_satisfied | human_confirmation_required",
  "condition": "condición observable y verificable",
  "evidence_required": ["source-type-or-catalog-id"]
}
```

- `evidence_satisfied` exige evidencia allowlisted suficiente;
- un run de IA no puede declarar cierre humano definitivo;
- unidades con acción pendiente no pueden estar `evidence_satisfied` salvo que la acción sea sólo validación humana posterior.

### 7.13 Validación humana

```json
{
  "required": true,
  "status": "pending",
  "reason": "qué debe confirmar una persona"
}
```

En el envelope generado por IA los únicos valores permitidos son `required: true` y `status: pending`. La validación posterior se registra por fuera del run, append-only, con actor y timestamp gobernados.

## 8. Consideraciones estratégicas

Son opcionales y sólo se crean con evidencia de contexto comercial autorizado.

- `unit_kind: strategic_consideration`;
- `requirement_id: null`;
- `category: strategic`;
- no pueden ser `blocking.effect: blocker` por sí mismas;
- no pueden afirmar cumplimiento del pliego;
- pueden expresar competitividad, exposición, capacidad de ejecución o encaje estratégico;
- siempre requieren validación humana.

## 9. Proyección v2 determinística

Backend genera una proyección compatible; el modelo no la emite.

### 9.1 `blockers`

Unidades con:

- `blocking.effect: blocker`; o
- `conclusion.status: gap_evidenced` y impacto crítico/alto.

### 9.2 `questions`

Unidades con:

- evidencia faltante;
- aplicabilidad/vigencia desconocida material;
- acción `human_decision`;
- conclusión `human_validation_required`.

`critical: true` cuando existe faltante crítico, blocker sustentado, exposición crítica o escalamiento `committee|management`.

### 9.3 `unverified`

Unidades abstained, con evidencia no revisada, vigencia/aplicabilidad desconocida o fundamento jurídico no verificado.

### 9.4 `strengths`

Sólo unidades `supported_with_evidence`, sin eje material desconocido, con impacto comercial positivo o neutral sustentado. La etiqueta v2 es una síntesis provisional y no declara cumplimiento definitivo.

### 9.5 `weaknesses`

Unidades `partially_supported`, `gap_evidenced`, `conditional` o con impacto alto/crítico no resuelto.

### 9.6 `next_action`

Primera acción según orden:

1. blocker no subsanable / escalamiento crítico;
2. blocker subsanable;
3. faltante crítico;
4. validación jurídica;
5. acción técnica/financiera;
6. validación estratégica;
7. revisión humana final.

`next_action` se copia de una acción validada y su `basis_unit_id`; no puede introducir texto ni evidencia ajena a esa unidad.

### 9.7 `summary` y trazabilidad

`summary` no es texto libre del modelo. Backend lo compone determinísticamente con conteos por categoría/estado, cobertura y los `unit_id` materiales. Cada finding v2 conserva `evidence_refs` y un ID derivado de su unidad v3; ninguna afirmación material aparece en la proyección sin unidad y citas de origen.

### 9.8 `recommendation`

Valor advisory, nunca decisorio:

- `do_not_advance`: al menos un blocker sustentado como no subsanable;
- `pause`: blocker sustentado pendiente de validación o faltante crítico;
- `advance_conditionally`: sin blocker, pero existen condiciones/acciones materiales;
- `advance`: sin blocker ni acción material, cobertura completa y evidencia suficiente.

Si existen omisiones materiales o abstención crítica, no puede ser `advance`.

### 9.9 Determinismo

La proyección:

- depende únicamente de `integral_analysis` validado;
- conserva orden estable;
- deduplica por `unit_id`;
- genera IDs de findings estables;
- no introduce evidencia nueva;
- se prueba por snapshot/fixture, reordenamiento e idempotencia.

## 10. `critical_open_count`

Se calcula desde unidades v3, no desde texto libre:

Cuenta unidades únicas con al menos una de estas condiciones:

- faltante `critical: true`;
- `blocking.effect: blocker` sin cierre sustentado;
- impacto `critical` con validación pendiente;
- escalamiento `committee` o `management` requerido;
- fundamento jurídico material `not_verified`.

La proyección genera exactamente una pregunta crítica por unidad contada para mantener compatibilidad con consumidores v2.

## 11. Seguridad y minimización

1. Contratos cerrados en todos los niveles.
2. Límites de tamaño por summary/reason/condition y máximos por arreglo.
3. Allowlist de referencias por tipo de fuente.
4. Sin raw prompt, chunk text, documento completo, secretos, credenciales o instrucciones embebidas.
5. Sin nombres de personas, PII, cuentas bancarias, armas o anexos nominales en el resultado.
6. Sin acciones externas ni side effects.
7. Logs con IDs técnicos y códigos, no contenido.
8. Prompt injection documental se trata como texto no confiable.
9. Cualquier violación impide persistir el run completo.

## 12. Compatibilidad y rollout

### Fase A — contrato puro

- constantes/enums;
- validadores v3;
- builder de proyección v2;
- fixtures sintéticos;
- sin wiring de proveedor ni persistencia.

### Fase B — persistencia local

- allowlist de `integral_analysis`;
- dispatch por versión;
- policy/schema bump;
- lectura v2/v3;
- pruebas de coexistencia histórica;
- sin activación productiva.

### Fase C — engine detrás de flag

- flag fail-closed `AGT002_INTEGRAL_CONTRACT_V3`;
- input v3 usa manifest/cobertura existentes;
- proveedor devuelve sólo forma nativa v3;
- backend proyecta v2;
- fixtures sintéticos y caso E5 controlado sólo con gate posterior.

La UI queda para un bloque separado después de validar contenido sintético/controlado. **El flag v3 no podrá activarse para usuarios** hasta que exista una superficie humana que muestre por requisito evidencia, abstención, cinco ejes, fundamento jurídico y validaciones pendientes, y esa superficie pase QA visual con etiquetas reales.

## 13. Pruebas RED obligatorias

### Forma y enums

1. acepta fixture mínimo válido completo;
2. rechaza claves extras en cualquier nivel;
3. rechaza enums desconocidos, duplicados y secuencia fuera de orden;
4. rechaza strategic con `requirement_id` o tender requirement sin ID.

### Cobertura

5. rechaza requisito faltante, duplicado o extra;
6. rechaza falso `material_omissions: false` frente al input;
7. obliga abstención en unidades afectadas por omisiones;
8. valida versión e IDs de las 17 clases empresariales.

### Evidencia o abstención

9. rechaza lectura favorable/parcial o gap material sin citas;
10. rechaza cita fuera de allowlist o con source type incorrecto;
11. acepta abstención con faltante explícito;
12. rechaza texto/raw evidence y campos sensibles;
13. rechaza cualquier unidad sin componentes comercial y jurídico explícitos, aunque uno de ellos deba abstenerse.

### Cinco ejes

14. rechaza revisión sin presencia;
15. rechaza estado material de compliance sin revisión;
16. rechaza sustento favorable con vigencia/aplicabilidad desconocida cuando son materiales;
17. prueba que presencia no muta automáticamente los demás ejes;
18. rechaza estados definitivos `compliant|sufficient|approved` producidos por IA.

### Jurídico y operativo

19. rechaza `not_curable` sin soporte;
20. rechaza fecha verificada sin source ref;
21. rechaza rol nominal o side effect true;
22. obliga escalamiento para riesgo material definido;
23. obliga validación humana `pending`.

### Compatibilidad

24. un run v2 histórico se valida/presenta sin cambios;
25. un v3 produce proyección v2 estable;
26. el proveedor no puede suministrar/provocar campos v2;
27. todo envelope emitido por el engine es aceptado por el consumidor de su misma versión y v2/v3 se rechazan mutuamente;
28. `critical_open_count` coincide con preguntas críticas proyectadas;
29. GO/NO-GO humano permanece habilitado aun con análisis ausente, contrario, obsoleto o crítico;
30. continuidad a Mesa recibe preguntas/ref seguras sin contenido;
31. reanálisis con nueva versión no colisiona con idempotency key previa.

### Persistencia

32. v3 persiste integral + proyección atómicamente;
33. fallo de validación no persiste run parcial;
34. promoción canónica v3 supersede sin mutar v2;
35. replay idempotente devuelve payload original;
36. concurrencia mantiene un canónico completado.

## 14. Criterios de aceptación

1. Cada requisito aparece exactamente una vez en orden institucional.
2. Comercial y jurídico convergen por unidad sin mezclar tipos de evidencia.
3. Presencia, revisión, vigencia, aplicabilidad y cumplimiento son independientes.
4. Toda conclusión material tiene evidencia allowlisted o abstención explícita.
5. Cada riesgo accionable tiene acción, rol enum, hito sustentado o desconocido, escalamiento y condición de cierre.
6. Toda unidad permanece pendiente de validación humana.
7. No existe campo ni ruta de autoridad automática.
8. V2 histórico permanece legible e inmutable.
9. La proyección v2 es determinística y única.
10. No se persiste contenido sensible ni evidencia bruta.
11. Pruebas focales, AGT‑002, paridad, build y baseline general quedan clasificadas.
12. No hay push, PR, migración remota, deploy, UI ni datos reales en este bloque.
