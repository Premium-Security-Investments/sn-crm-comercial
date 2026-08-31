# Plan de implementación — correcciones visuales del expediente de licitación

**Fecha:** 2026-08-31  
**Rama:** `fix/agt002-pereira-visual-fixes-20260831`  
**Alcance:** frontend, estilos, pruebas semánticas y este plan. No incluye migraciones, API, lógica de negocio del servidor, datos, ejecuciones de AGT-002, decisiones GO/NO-GO, `CURRENT.md`, push, PR ni deploy.

## Objetivo

Corregir la jerarquía visual y operativa del detalle de una oportunidad de licitación: la lista V3 completa de pendientes debe vivir en **Análisis**; **Decisión** debe priorizar el control formal humano y mostrar sólo un puntero compacto hacia esos pendientes. Además se elimina la duplicación pre-GO, se retira la auditoría técnica del render operativo y se mejoran jerarquía de botones, acciones documentales, densidad, copy y ayudas de formulario sin alterar contratos ni validaciones.

## Contratos que deben preservarse

- La persona autorizada conserva control absoluto sobre GO/NO-GO; el análisis nunca bloquea ni registra una decisión.
- Ningún expediente o control post-GO se habilita antes de una decisión GO vigente.
- La actualización documental no genera un análisis nuevo y la carga complementaria conserva su flujo actual.
- La confirmación, persistencia, permisos e historial de GO/NO-GO no cambian.
- La validación de actuaciones sigue exigiendo una descripción no vacía.
- La telemetría y sus contratos de backend permanecen intactos aunque dejen de aparecer en la UI operativa.
- No se introducen identificadores, trazas técnicas ni lenguaje interno en la UI.

## Tarea 1 — fijar contratos semánticos en RED

**Archivos de prueba**

- Modificar `tests/agt002-decision-axis-surface-ui.test.mjs`.
- Modificar `tests/agt002-decision-axis-surface-integration.test.mjs`.
- Modificar `tests/tender-guided-workspace-ui.test.mjs`.
- Modificar `tests/tender-offer-preparation-static.test.mjs`.
- Modificar `tests/tender-business-timeline-ui.test.mjs`.
- Modificar `tests/tender-document-actions-layout.test.mjs`.
- Modificar `tests/tender-go-no-go-ui.test.mjs`.
- Crear `tests/tender-pereira-visual-fixes-ui.test.mjs` para los contratos transversales de copy, helper, densidad y estilos.

**Casos que deben fallar antes de implementar**

1. La proyección V3 completa se renderiza en `TenderAnalysisSection` cuando la superficie unificada está activa.
2. `TenderDecisionAxisSurface` no contiene tarjetas V3 completas y sí contiene un puntero accesible a `#tender-analysis`; su CTA enfoca el ancla canónica de Análisis.
3. El control formal GO/NO-GO aparece antes que el puntero secundario en el modo V3, sin duplicar panel ni CTA primaria.
4. No existe el id legado `tender-decision-operational-pending`; los ids de proyección pertenecen a Análisis y la navegación/IntersectionObserver siguen observando los seis contenedores canónicos.
5. `TenderDossierWorkspacePanel` no produce markup ni carga workspace en pre-GO.
6. `PublicTenderFollowUp` no renderiza ni solicita la auditoría técnica, mientras conserva el historial de negocio y los contratos backend/API.
7. `Registrar GO` conserva jerarquía primaria y `Registrar NO GO` usa un estilo `button.danger` secundario/destructivo con hover y foco visibles.
8. Las acciones de documentos exponen roles/clases semánticas para consultar, actualizar y cargar, con layout responsive y foco visible.
9. El resumen y el panel formal tienen clases/reglas de densidad explícitas, sin ocultar contenido.
10. La presentación visual de `converted` conserva exactamente “Convertida en oportunidad”, sin capitalización CSS y sin modificar eventos históricos.
11. Cuando la descripción está vacía, `Guardar actuación` permanece deshabilitado y un helper visible enlazado con `aria-describedby` explica el requisito.

**Comando RED focal**

```bash
node --test \
  tests/agt002-decision-axis-surface-ui.test.mjs \
  tests/agt002-decision-axis-surface-integration.test.mjs \
  tests/tender-guided-workspace-ui.test.mjs \
  tests/tender-offer-preparation-static.test.mjs \
  tests/tender-business-timeline-ui.test.mjs \
  tests/tender-document-actions-layout.test.mjs \
  tests/tender-go-no-go-ui.test.mjs \
  tests/tender-pereira-visual-fixes-ui.test.mjs
```

Se conservará en el reporte final el comando, el conteo de fallos y los síntomas esperados observados antes de tocar la implementación.

## Tarea 2 — compartir la proyección V3 y moverla a Análisis

**Archivos**

- Crear `src/tenders/components/TenderOperationalPendingProjection.tsx`.
- Modificar `src/tenders/components/TenderDecisionAxisSurface.tsx`.
- Modificar `src/tenders/components/TenderAnalysisSection.tsx`.
- Modificar `src/tenders/components/tender-decision-axis-surface.css`.
- Modificar `src/styles.css` sólo para la integración de Análisis.

**Pasos**

1. Extraer las tarjetas y grupos de pendientes V3 a un componente presentacional compartido, manteniendo títulos, fallbacks humanos, referencias gobernadas y ausencia de ids/enums/trazas.
2. Exponer un selector compartido y puro que determine el modo de proyección: cinco ejes sin lectura material y al menos una unidad integral abierta.
3. En `TenderAnalysisSection`, cuando `decisionSurfaceElsewhere` y el selector sean verdaderos, renderizar una única proyección completa dentro de `#tender-analysis`.
4. En `TenderDecisionAxisSurface`, reemplazar la proyección completa por un puntero compacto con conteo, explicación y control que navegue/enfoque `#tender-analysis` mediante `focusTenderDetailSection`.
5. Hacer que, en ese modo, el panel formal sea el primer bloque sustantivo de Decisión; mantener una sola instancia del panel formal y una sola CTA primaria.
6. Eliminar funciones e ids de foco que apunten al antiguo listado dentro de Decisión.
7. Mantener el comportamiento actual de los cinco ejes cuando sí hay lectura material.
8. Añadir estilos responsive para la proyección en Análisis y para el puntero compacto, sin overflow horizontal.

## Tarea 3 — eliminar duplicación pre-GO

**Archivo**

- Modificar `src/tenders/components/TenderDossierWorkspacePanel.tsx`.

**Pasos**

1. Conservar el cálculo fail-closed de estados habilitados.
2. Retornar `null` antes del markup operativo cuando el estado no sea post-GO.
3. Mantener el `reload` protegido para no consultar ni inicializar workspace en pre-GO.
4. Dejar `TenderOfferPreparationPanel` como único estado compacto previo a GO.
5. Confirmar que checklist, artefactos, workbench e inicialización siguen inaccesibles hasta GO.

## Tarea 4 — retirar auditoría técnica del render operativo

**Archivos**

- Modificar `src/main.tsx`.
- Modificar `tests/tender-business-timeline-ui.test.mjs`.

**Pasos**

1. Eliminar el `<details>` “Auditoría técnica de Vig-IA Licitaciones” de `PublicTenderFollowUp`.
2. Retirar del componente la carga y estado de telemetría que ya no tienen consumidor visible.
3. Conservar el loader API, contratos, etiquetas/backend y eventos históricos sin modificación.
4. Mantener el historial comercial unificado, su paginación y su deduplicación de hitos canónicos.
5. Verificar que ningún texto de auditoría técnica queda en el HTML operativo.

## Tarea 5 — jerarquía de acciones y accesibilidad

**Archivos**

- Modificar `src/styles.css`.
- Modificar `src/tenders/components/TenderDocumentSection.tsx`.
- Modificar `src/tenders/components/TenderGoNoGoDecisionPanel.tsx` sólo si hace falta una clase/atributo semántico adicional.

**Pasos**

1. Añadir reglas específicas para `button.danger`: fondo claro, borde y texto destructivos, hover controlado, foco visible de alto contraste y disabled inequívoco.
2. Mantener GO con el estilo primario actual y NO-GO con `className="danger"`, tanto en el panel como en confirmación.
3. Dar a consultar/actualizar/cargar documentos una estructura y clases semánticas distintas pero coherentes, con rótulo de intención visible.
4. Conservar `details/summary` accesibles, estados cerrados por defecto y labels existentes.
5. Hacer que las tres acciones envuelvan correctamente y ocupen ancho completo en móvil, con objetivos táctiles suficientes y `:focus-visible`.

## Tarea 6 — densidad, copy y helper

**Archivos**

- Modificar `src/main.tsx`.
- Modificar `src/styles.css`.
- Modificar `src/tenders/components/tender-decision-axis-surface.css`.

**Pasos**

1. Añadir clases acotadas al detalle de licitación, ancla/panel de Resumen y panel formal de Decisión.
2. Reducir gaps y padding redundantes únicamente en esos bloques, conservando legibilidad y layout responsive.
3. Neutralizar `text-transform: capitalize` en el timeline comercial de licitaciones para presentar “Convertida en oportunidad” exactamente, sin reescribir datos ni historial.
4. Mantener el diccionario de presentación con el copy correcto.
5. Añadir helper visible cuando `note.trim()` está vacío: “Escriba una descripción para habilitar Guardar actuación.”
6. Enlazar textarea y helper mediante `aria-describedby`, conservar `required` y no cambiar el guard ni el atributo `disabled` del botón.

## Tarea 7 — GREEN y regresión focal

Ejecutar el comando focal de la Tarea 1 hasta obtener cero fallos. Después ejecutar:

```bash
node --test \
  tests/tender-detail-navigation.test.mjs \
  tests/tender-integral-analysis-presentation.test.mjs \
  tests/tender-preparation-honest-affordances-static.test.mjs \
  tests/tender-processing-ui-status.test.mjs \
  tests/tender-opportunity-exit-ui.test.mjs
```

Cualquier fallo por expectativa legítimamente reemplazada se actualizará sólo si coincide con el nuevo contrato visual. No se relajarán permisos, gates ni validaciones.

## Tarea 8 — suite completa razonable y build

**Comandos**

```bash
node --test tests/*tender*.test.mjs
npm run check:siio-integration
npm run build
git diff --check
```

Si la suite completa de licitaciones incluye integraciones que requieren servicios externos o excede el entorno disponible, se reportará el bloqueo exacto y se ejecutará el subconjunto local máximo; no se inventarán resultados.

## Tarea 9 — auto-revisión y commits

1. Revisar `git diff --stat`, `git diff` y `git diff --check`.
2. Buscar placeholders (`TODO`, `FIXME`, `XXX`, `TBD`, `<placeholder>`), trazas (`console.log`, `console.debug`, `debugger`) y texto técnico nuevo en los archivos tocados.
3. Confirmar que no se modificaron migraciones, `server/`, `api/`, datos, contratos backend, AGT-002, GO/NO-GO ni `CURRENT.md`.
4. Confirmar que no se ejecutó AGT-002, no se registró ninguna decisión y no hubo push/PR/deploy.
5. Crear un commit separado para este plan.
6. Crear un segundo commit claro para pruebas e implementación UI.
7. Entregar SHAs, archivos, evidencia RED→GREEN y todos los comandos/resultados reales.

## Criterios de aceptación

- La lista completa V3 aparece una sola vez y bajo Análisis.
- Decisión contiene el control formal como contenido principal y sólo un puntero compacto a los pendientes de Análisis.
- Navegación, foco, ids e IntersectionObserver usan los contenedores canónicos sin duplicados.
- Existe un solo empty-state pre-GO y ningún workspace se habilita antes de GO.
- No se renderiza auditoría técnica en Seguimiento.
- GO es primario; NO-GO es destructivo secundario y accesible.
- Las acciones documentales comunican consultar/actualizar/cargar y responden correctamente en móvil.
- Resumen y Decisión reducen espacio vacío sin rediseño masivo.
- Se presenta “Convertida en oportunidad”.
- El helper explica por qué `Guardar actuación` está deshabilitado.
- Pruebas focales, regresión relevante y build están verdes.
