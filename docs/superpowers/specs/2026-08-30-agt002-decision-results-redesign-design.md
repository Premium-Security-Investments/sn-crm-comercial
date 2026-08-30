# AGT-002 — rediseño de resultados para decisión

**Fecha:** 2026-08-30
**Estado:** contrato visual aprobado para implementación
**Alcance:** presentación y selectores puros del frontend. No cambia datos, persistencia, modelos, prompts, contratos de análisis ni la autoridad humana GO/NO-GO.

## 1. Problema

La superficie `Análisis para decidir` interpreta correctamente hallazgos materiales ya proyectados en cinco ejes, pero falla en un estado real: cuando los cinco ejes llegan vacíos/`No evaluado` y el payload V3 sí contiene unidades abiertas. En ese caso presenta cinco chips `No evaluado · 0`, una tabla vacía, cifras internas de cobertura y rutas de trazabilidad técnica. La persona encargada ve cero trabajo aunque el análisis canónico conserva pendientes accionables.

La reparación debe mantener la superficie actual cuando hay hallazgos materiales reales y sustituir únicamente el estado vacío por una lectura operativa, humana y dinámica derivada del payload V3 existente.

## 2. Principios no negociables

1. **Proyección, no reinterpretación.** La UI usa exclusivamente campos ya persistidos. No infiere cumplimiento, materialidad, categorías ni decisiones a partir de texto.
2. **Diccionarios cerrados.** Las categorías internas se traducen mediante un mapa exhaustivo; un valor futuro/desconocido cae en `Pendientes por clasificar`, sin mostrar el enum crudo.
3. **Autoridad humana intacta.** El análisis organiza trabajo. No ejecuta, bloquea ni automatiza GO/NO-GO. El panel formal existente permanece disponible a la persona autorizada.
4. **Una lectura operativa.** Con la superficie unificada activa, `Análisis` conserva controles de corrida, pero la lectura accionable vive sólo en `Análisis para decidir`.
5. **Sin trazabilidad técnica frontal.** La vista operativa no muestra `unit_id`, `requirement_id`, hashes, offsets, localizadores, enums crudos, ejecución/snapshot ni acordeones de trazabilidad.
6. **Sin cifras internas de cobertura.** No se presenta una razón analizado/total como `6 de 6.809`; se presenta el número humano de pendientes accionables.
7. **Fail explicit.** Un campo ausente se comunica con copy explícito y neutral; nunca se convierte en cumplimiento.

## 3. Selección de modo

La superficie calcula dos modos sin mutar el payload:

### 3.1 Modo de ejes materiales

Se conserva el componente actual si cualquiera de los cinco ejes contiene al menos un hallazgo real. Los chips, estados, tabla/tarjetas, drawer de respuesta y precedencia de CTA siguen funcionando.

### 3.2 Modo de proyección operativa V3

Se activa sólo cuando se cumplen simultáneamente:

- los cinco ejes no contienen hallazgos;
- todos están `No evaluado` o ausentes (la ausencia se normaliza a `No evaluado`);
- `analysis.integral_analysis.analysis_units` contiene unidades abiertas.

Una unidad es abierta cuando `closure.status` no expresa cierre satisfecho. El filtro usa exclusivamente el enum estructural; no inspecciona título, conclusión, faltantes ni acción para decidir si está abierta. El valor `evidence_satisfied` se considera cerrado; los demás valores se conservan como pendientes fail-closed.

En este modo se reemplazan el rail de cinco chips y el cuerpo de eje vacío, en el mismo lugar de `Análisis para decidir`, por:

- estado `Lectura documental incompleta`;
- conteo dinámico `N pendientes accionables`;
- introducción que prioriza resolver pendientes sin proclamar análisis listo;
- grupos por categoría humana cerrada;
- una tarjeta por unidad abierta.

## 4. Categorías humanas cerradas

| Enum interno | Etiqueta visible |
|---|---|
| `discard` | Presentación y causales de rechazo |
| `habilitating` | Requisitos habilitantes |
| `technical` | Capacidad y obligaciones técnicas |
| `financial_execution` | Capacidad financiera y económica |
| `strategic` | Condiciones estratégicas y contractuales |
| desconocido | Pendientes por clasificar |

El orden visible es el de la tabla. No se crean categorías mediante heurísticas textuales.

## 5. Tarjeta operativa

Cada tarjeta muestra campos semánticamente separados:

- **Requisito:** `unit.title`, como título único de la tarjeta; fallback `Requisito sin título registrado.`
- **Qué sabemos:** `unit.conclusion.summary`; fallback `No hay una conclusión documental registrada.`
- **Qué falta por confirmar o aportar:** lista de `unit.missing_evidence[].reason`; fallback `No hay un faltante específico registrado; la validación humana continúa pendiente.`
- **Por qué importa:** `unit.commercial_impact.summary`; fallback `No hay impacto comercial documentado.`
- **Siguiente acción:** todas las `unit.actions[].summary` en orden; fallback `No hay una siguiente acción específica registrada; asignar revisión humana.`
- **Referencias:** si existen, cantidad y etiquetas humanas de tipo de fuente; nunca el identificador/localizador crudo. Si no existen, `Sin referencias documentales legibles asociadas.`

La tarjeta no muestra rótulos derivados de `conclusion.status`, `commercial_impact.level`, IDs ni campos técnicos.

## 6. Conteo ejecutivo

`tenderExecutiveOpenIssueCount` aplica esta precedencia:

1. si existe `decision_review`, suma `counts.blockers + counts.decision_questions` (cero es válido y autoritativo);
2. sin review, si `critical_open_count > 0`, devuelve ese valor aunque la proyección de ejes no esté disponible;
3. si falta o no es positivo, devuelve la cantidad de unidades V3 abiertas;
4. en ausencia de señales, devuelve cero.

`tenderExecutiveProjectionAvailable` puede seguir indicando que no existe clasificación material, pero no anula el conteo real de pendientes. El conteo no es un gate de decisión.

## 7. Jerarquía y duplicación

- `TenderDecisionExperience` sigue siendo el único montaje de la experiencia de decisión.
- `src/main.tsx` elimina el montaje exterior duplicado de `TenderIntegralAnalysisV3View` y su acordeón `Ver respaldo técnico del análisis` para la experiencia unificada.
- `TenderAnalysisSection` no repite la lectura operativa cuando `decisionSurfaceElsewhere` está activa.
- El control formal `TenderGoNoGoDecisionPanel` sigue apareciendo una vez.

## 8. Accesibilidad y responsive

- Un único `h2` identifica `Análisis para decidir`; el bloque operativo tiene `aria-labelledby` propio.
- El conteo se anuncia con `aria-live="polite"` sin modificar decisiones.
- Las tarjetas usan `article`, títulos y `dl`/listas semánticas.
- Eyebrows y labels usan color con contraste AA razonable sobre sus fondos (`#334f49` o más oscuro sobre blanco/papel claro).
- El layout usa `minmax(0, 1fr)`, `min-width: 0` y `overflow-wrap: anywhere`.
- Desktop agrupa en dos columnas cuando hay espacio; móvil usa una columna sin scroll horizontal.
- El foco visible de controles existentes se conserva.

## 9. Criterios de aceptación

1. Fixture pausado con seis unidades V3 abiertas y cinco ejes vacíos: seis tarjetas y copy humano de seis pendientes; cero chips `No evaluado · 0`.
2. HTML operativo sin `Ver trazabilidad técnica`, `Ver respaldo técnico del análisis`, `unit_id`, `requirement_id`, hashes, offsets ni enums crudos.
3. Cada tarjeta separa requisito, conocimiento, faltante, impacto, acción y referencias legibles.
4. Fixture con hallazgos materiales conserva cinco ejes y su comportamiento.
5. Fallback sin cifras internas de cobertura ni proclamación `LISTA`.
6. Conteo ejecutivo respeta review, luego `critical_open_count`, luego unidades abiertas.
7. Una sola lectura operativa y un solo panel formal.
8. CSS desktop/móvil sin overflow y labels con contraste corregido.
9. Harness SSR+Chromium produce HTML y PNG desktop/móvil y valida strings prohibidos.
10. No se ejecuta ni reintenta AGT-002/Vig-IA durante implementación, deploy o QA.
11. El estado, el conteo y el título de cada requisito aparecen una sola vez en la lectura operativa.

## 10. Fuera de alcance

- Nuevas corridas, reintentos, refresh del análisis o decisión GO/NO-GO.
- Cambios a backend, base de datos, schemas, modelos, prompts, workers o persistencia.
- Reclasificar materialidad o declarar cumplimiento.
- Publicar trazabilidad técnica en la vista de la persona encargada.
