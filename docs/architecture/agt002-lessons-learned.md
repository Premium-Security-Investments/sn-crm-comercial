# AGT-002 — aprendizajes del piloto Manizales V3

**Fecha:** 2026-08-17 · **Alcance:** documental, fase 9 de consolidación. No cambia runtime, contratos ni migraciones.

Este documento consolida lo que el ciclo Manizales SA-24-2026 (fundaciones V3, gobernanza curada, corrección de schema Codex, piloto completo con manifiesto gobernado) probó en la práctica, para que la próxima licitación no repita el mismo descubrimiento por las malas. Cada punto cita el mecanismo de código que lo hace cumplir, no sólo la intención.

## 1. Evidencia-o-abstención no es opcional, es el contrato

El validador V3 (`agt002-integral-analysis-v3.js`) exige que cada unidad `tender_requirement` declare sus cinco ejes (`presence/review/validity/applicability/compliance`) exactamente como los deriva `agt002-evidence-state-manifest.js` a partir de un enlace curado gobernado — nunca como salida libre del modelo. Sin enlace curado, el eje abstiene al estado seguro `unknown`/`not_reviewed`. `compliance` nunca sale de `"unknown"` porque no existe todavía una vía de escritura real para esa determinación.

**Lección:** cualquier proceso nuevo hereda esta abstención por defecto. Si un proceso "parece" tener más cobertura que Manizales sin gobernanza curada equivalente, esa cobertura es ilusoria — el validador la rechazará o la reducirá a abstención. No hay atajo de "confiar en el modelo por esta vez".

## 2. Vigencia y aplicabilidad son ejes independientes, no derivados

Antes de esta arquitectura, era tentador inferir aplicabilidad desde la sola presencia de un documento. El diseño separa presencia, revisión, vigencia, aplicabilidad y cumplimiento como ejes que no se derivan entre sí; un documento presente puede estar vencido, inaplicable, o ambas cosas, y el contrato lo puede expresar sin colapsar a "cumple".

**Lección:** al construir el paquete de un proceso nuevo, la curación humana debe fijar cada eje explícitamente para las clases de evidencia relevantes, no asumir que "documento cargado" implica "vigente y aplicable".

## 3. Fuentes, versiones y hashes son la unidad de trazabilidad, no el texto libre

El manifiesto gobernado de Manizales (`agt002-manizales-integral-manifest.js`, `data/agt002/manizales-sa-24-2026.integral-manifest.v1.json`) ata cada entrada a citas verificadas contra `source_text_by_document_id` con límites de excerpt exactos, y la corrección mecánica (`agt002-manizales-manifest-corrections.js`) sólo degrada o abstiene, nunca promueve. La verificación independiente de la fase 2 del piloto confirmó 10 entradas deterministas contra los límites de cita reales — no contra el PDF completo, una limitación registrada explícitamente en `docs/verification/2026-08-15-agt002-manizales-v3-pilot.md`.

**Lección:** "verificado" en este sistema significa "la cita coincide con el excerpt almacenado", no "se releyó el documento fuente completo". Cualquier declaración de cobertura debe decir cuál de las dos cosas está afirmando.

## 4. Los límites de cobertura deben ser honestos, no agregados de conveniencia

`docs/verification/2026-08-15-agt002-manizales-v3-pilot.md` documenta explícitamente que `TenderIntegralAnalysisV3View.tsx` calculaba cobertura como `analyzed_requirement_ids.length / expected_requirement_ids.length` — una relación de cobertura del **envelope del contrato**, no de los 68 registros/15+20 ledgers del expediente completo. Un `4/4` en esa fracción no implica análisis completo de la licitación.

**Lección:** cualquier UI o reporte de cobertura para un proceso nuevo debe declarar explícitamente el universo frente al que se mide (contrato analizado vs. universo documental completo) y no dejar que un cociente perfecto sugiera lo segundo.

## 5. Compatibilidad V2/V3 se prueba por comparación sin pérdida, no por confianza

`tests/agt002-manizales-v2-v3-comparison.test.mjs` carga la línea base histórica V2 sanitizada y ejecuta el runner V3 local sobre el manifiesto gobernado real, confirmando que las 9 dimensiones históricas V2 mapean a requisitos V3 sin pérdida y que V3 cubre estrictamente más (20 requisitos analizables vs. 9 dimensiones históricas).

**Lección:** al migrar o extender un proceso, la prueba de "no perdimos nada" debe ser una comparación mecánica contra una línea base congelada, no una revisión visual del nuevo output.

## 6. El dispatch de versión es explícito, nunca por forma del payload

`agt002-preview-contract.js` / `agt002-tender-adapter.js` rechazan mutuamente V2 y V3: el modelo V3 sólo puede devolver `{ integral_analysis }`, y nunca se infiere la versión por la forma del JSON recibido.

**Lección:** cualquier tercera versión futura del contrato debe declarar su propio dispatch explícito, no reutilizar heurísticas de forma.

## 7. Compatibilidad relevante para el paquete reusable

Estos siete aprendizajes son exactamente lo que `docs/architecture/agt002-reusable-licitacion-architecture.md` intenta extraer como riel genérico sin copiar Manizales: el paquete de un proceso nuevo debe traer su propio manifiesto gobernado, sus propias citas verificadas, y debe pasar por el mismo validador fail-closed — no un validador relajado "porque es nuevo".
