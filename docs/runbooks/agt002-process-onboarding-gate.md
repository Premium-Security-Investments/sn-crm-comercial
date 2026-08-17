# AGT-002 — runbook de onboarding de un proceso/licitación nuevo

**Fecha:** 2026-08-17 · **Estado:** procedimiento objetivo para cuando exista el paquete reusable (tareas 3/4 del plan de fase 9, no implementadas todavía). Hasta entonces, este runbook documenta el procedimiento que Manizales SA-24-2026 sí siguió, generalizado, y sirve de checklist de gate para la primera vez que se ejecute con un segundo proceso.

## 0. Invariante de entrada

Ningún proceso distinto de Manizales SA-24-2026 (`opportunity_id 54190e51-15fb-46af-b0aa-8f13461a3110`, proceso `SA-24-2026`) tiene hoy un manifiesto gobernado, gobernanza curada (migraciones `064`/`066`) ni flag de habilitación propio. Este runbook no autoriza saltarse ese hecho; describe cómo cerrarlo para un proceso nuevo sin tocar el candado fail-closed existente.

## 1. Identificación del proceso

- Definir `opportunity_id` y `proceso` reales (no sintéticos) para la licitación objetivo.
- Confirmar que existe una oportunidad convertida en el Radar por el encargado de Licitaciones — AGT-002 nunca convierte procesos.
- Confirmar snapshot documental vigente y actor humano activo para ese caso.

## 2. Paquete de proceso (requiere las tareas 3/4 implementadas)

- Construir el manifiesto gobernado siguiendo el mismo patrón que `agt002-manizales-integral-manifest.js`: entradas atadas a citas verificadas contra excerpts reales, no contra el PDF completo sin registrar esa limitación.
- Curar `categoryOverrides` y `evidenceClassLinkByRequirementId` con `rationale`/`source_reference` trazables al pliego real — nunca overrides "para que pase" (ver `docs/architecture/agt002-human-review-policy.md` §2 sobre por qué esto es un acto humano, no de runtime).
- Validar el paquete contra el schema JSON versionado de `contracts/agents/AGT-002/v3/` (tarea 4 — no existe todavía; hasta que exista, no hay forma automatizada de validar estructuralmente un paquete nuevo).
- Ejecutar una corrección determinista (patrón `agt002-manizales-manifest-corrections.js`) sólo de degradación/abstención sobre el paquete nuevo, y confirmar idempotencia (segunda pasada = cero correcciones si la primera ya es conformante).

## 3. Gate fail-closed (requiere la tarea 3 implementada)

- El registry indexado por `(opportunity_id, proceso)` debe retornar `null`/error cerrado hasta que existan simultáneamente: paquete aprobado + gate de onboarding completo + flag explícito para ese proceso puntual.
- Confirmar mecánicamente (como se hizo para Manizales en esta sesión, leyendo `agt002-manizales-manifest-source.js`) que cualquier combinación `(opportunity_id, proceso)` no registrada lanza excepción antes de tocar el proveedor — nunca devuelve un manifiesto vacío ni hereda el de otro proceso.
- Confirmar que el flag de habilitación es específico al proceso, no un interruptor global que active "cualquier paquete presente".

## 4. Canary controlado del proceso nuevo

Seguir exactamente el procedimiento de `docs/runbooks/agt002-integral-v3-canary.md` §"Controlled single-run canary procedure", sustituyendo Manizales por el proceso nuevo:

1. Activar el flag del proceso **sólo** en el entorno de la corrida controlada.
2. Confirmar límites conservadores (`MAX_CONCURRENT=1`, `DAILY_MAX_RUNS` bajo).
3. Ejecutar exactamente una llamada real contra el snapshot del proceso.
4. Verificar `schema_version: "3.0.0"`, cobertura 1:1 exacta, citas de evidencia por cada conclusión favorable/parcial/brecha, `legal_assessment` coherente con la presencia/ausencia de corpus jurídico publicado, y `human_review_required === true` sin ningún campo que declare cumplimiento definitivo.
5. Persistir con `canonicalOnly: true` y confirmar exactamente un canónico por oportunidad tras la corrida.
6. Apagar el flag del proceso al terminar, salvo autorización humana separada para disponibilidad continua.

## 5. Revisión humana y QA visual

- Comparación V2/V3 sin pérdida para el proceso nuevo, con el mismo patrón que `tests/agt002-manizales-v2-v3-comparison.test.mjs`: toda dimensión histórica relevante debe mapear a al menos un requisito V3, cero pérdidas.
- QA visual autenticado con etiquetas reales del proceso nuevo, realizado por un humano, antes de exponer la UI V3 a cualquier usuario para ese proceso.
- Revisión independiente del paquete y del código de wiring (si lo hubo) antes de publicar.

## 6. Promoción a canonical

Sólo después de que los pasos 1–5 estén verdes y un humano decida explícitamente habilitar el proceso de forma continuada:

- Registrar la decisión y su fecha en el ledger de gobernanza del proceso (ver `docs/migrations/agt002-process-governance-ledger.md` para el patrón usado con Manizales).
- Mantener el flag del proceso apagado por defecto hasta esa decisión explícita — nunca activarlo "para probar" en un entorno compartido.

## 7. Qué este runbook no autoriza

- No autoriza construir código nuevo de registry/paquete en esta sesión (tareas 3/4 explícitamente fuera de alcance del bloque documental de fase 9).
- No autoriza relajar el validador `agt002-integral-analysis-v3.js` para el proceso nuevo — la cobertura 1:1 del `evidenceStateManifest` es exigida igual que para Manizales.
- No autoriza ningún GO/NO-GO, firma, envío o presentación derivada del canary — eso permanece humano.
