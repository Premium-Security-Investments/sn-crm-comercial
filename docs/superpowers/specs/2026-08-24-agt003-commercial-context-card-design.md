# AGT-003: tarjeta de contexto comercial — diseño

**Fecha:** 2026-08-24
**Estado:** Aprobado por producto
**Alcance:** oportunidades comerciales no licitatorias (`service_type_code !== 'licitacion_publica'`), vista de detalle de oportunidad

## Problema

En el detalle de una oportunidad no licitatoria, el panel `Datos comerciales` (`src/main.tsx`, sección `#tender-follow-up` del branch no licitación) mezcla en un mismo `<dl>`, sin distinción visual entre ellos, campos operativos vigentes (sector, ciudad, sede) con metadatos técnicos de migración desde Excel (`legacy_excel_id`, `excel_hoja_origen`, `estado_pipeline_original`) y una observación (`observaciones`) que se muestra sin clasificar como comercial o importada. Al no jerarquizar estos grupos, el panel da la misma prioridad visual —o mayor, por ocupar más filas— a la trazabilidad histórica que a la información operativa vigente, pese a que la primera solo interesa ocasionalmente y la segunda es la relevante para el seguimiento comercial diario. Además, el `<div className="grid two">` que envuelve este panel y el formulario de seguimiento no fija `align-items`, por lo que hereda el `stretch` por defecto de CSS grid y la tarjeta izquierda se estira artificialmente a la altura del formulario de la derecha.

## Decisión

Se rediseña el panel como `Contexto comercial`: un bloque compacto con los campos operativos que no están ya visibles en el hero/resumen superior, y un `<details>` colapsado con los metadatos de migración cuando existen. No se toca DB, API ni permisos: es un cambio de presentación sobre campos ya cargados en `Opportunity`.

## Comportamiento

### 1. Título del panel

`Panel title="Datos comerciales"` pasa a `Panel title="Contexto comercial"`. Es el único cambio de rótulo; el resto del layout del detalle no se toca.

### 2. Bloque principal compacto

El bloque principal del panel muestra únicamente:

- **Sector** (`o.economic_sector`).
- **Ubicación**, compuesta por ciudad + sede en una sola fila: `${ciudad} · ${sede}`. Reglas de composición en la sección de datos.

No se repiten en este panel: servicio (`service_type_name`/`tipo_producto_original`), valor (`offer_value`), etapa (`stage_name`), responsable (`owner_name`), fechas (`created_at`, `expected_close_date`), próxima acción (`next_action_at`) ni decisor (`decision_maker_name`/`email`/`phone`), porque ya se muestran en el hero (`.hero`) o en el `grid three` de `Resumen de la oportunidad` que precede a este panel en la misma vista de detalle.

### 3. Datos de origen (metadatos de migración)

Si existe al menos uno de `legacy_excel_id`, `excel_hoja_origen` o `estado_pipeline_original` (valor no nulo y no cadena vacía tras `trim`), se agrega dentro del panel un `<details>` **cerrado por defecto** (sin atributo `open`) con `<summary>Datos de origen</summary>`. Dentro, cada campo presente se etiqueta:

| Campo               | Etiqueta          |
|---------------------|-------------------|
| `legacy_excel_id`       | ID migrado        |
| `excel_hoja_origen`     | Hoja de origen     |
| `estado_pipeline_original` | Estado al importar |

### 4. Observaciones

- Si `o.observaciones` tiene contenido **y** existe al menos un metadato de migración (es decir, el `<details>` de Datos de origen se renderiza), la observación se muestra dentro de ese `<details>` como **Observación importada**.
- Si `o.observaciones` tiene contenido y **no** existe ningún metadato de migración, la observación se muestra en el bloque principal (fuera del `<details>`) como **Observación comercial**.
- Si `o.observaciones` está vacío, no se renderiza ninguna fila de observación en ningún lugar.

### 5. Filas vacías y ocultamiento del `<details>`

- Dentro de `Datos de origen`, cada fila (`ID migrado`, `Hoja de origen`, `Estado al importar`, `Observación importada`) solo se renderiza si su valor fuente tiene contenido. No se usa `Dt`/`—` para estos campos: una fila sin dato simplemente no aparece.
- Si ninguno de los tres metadatos de migración tiene contenido (con o sin observaciones), el `<details>` completo no se renderiza. En ese caso, si hay observaciones, estas migran al bloque principal como se describe en el punto 4.

### 6. Layout de la cuadrícula

El `<div className="grid two">` que envuelve el panel `Contexto comercial` y el `FollowUpForm` se alinea al inicio (`align-items: start`) en lugar de heredar el `stretch` por defecto de `.grid`. La tarjeta izquierda toma su altura natural de contenido y no se estira a la altura del formulario de seguimiento.

El cambio se aplica con una clase de modificador dedicada al contenedor de este detalle (por ejemplo `commercial-context-grid`, combinada con `grid two` existente), **no** modificando la regla compartida `.grid.two` en `src/styles.css`, porque esa regla se reutiliza en otras vistas (`VigiaOpportunityCopilot`, panel de dashboard) donde `stretch` sigue siendo el comportamiento deseado.

## Reglas de datos

- **Ubicación**: se compone como `${ciudad} · ${sede}` cuando ambos tienen contenido. Si falta uno de los dos, se muestra solo el que existe (sin el separador `·` colgante). Si ninguno tiene contenido, se muestra `Por completar`.
- **Sector**: si `economic_sector` no tiene contenido, se muestra `Por completar`.
- En el bloque principal (Sector, Ubicación, Observación comercial cuando aplica) se reemplaza el placeholder `—` de `Dt`/`Info` por `Por completar` para los campos de este panel específicamente. Esto no cambia el comportamiento de `Dt`/`Info` en el resto de la aplicación; se resuelve con una función de formato propia del panel, no editando `Dt`.
- Dentro de `Datos de origen`, al no haber `Dt` con placeholder, no aplica el reemplazo por `Por completar`: la ausencia de dato es ausencia de fila (regla 5).
- Ningún campo mostrado en este panel se persiste, transforma ni deriva: son lecturas directas de `Opportunity` ya presentes en la respuesta de `/api/opportunity-detail`.

## Accesibilidad

- El colapsable usa `<details>`/`<summary>` nativos del navegador (igual que los usos existentes en `src/main.tsx`: `tender-technical-analysis`, `centinel-manual-query`), sin JavaScript adicional para abrir/cerrar ni gestión manual de foco.
- `<summary>Datos de origen</summary>` es el único texto interactivo del bloque; el `<details>` no lleva `open` por defecto, por lo que el lector de pantalla lo anuncia como colapsado.
- El bloque principal conserva la estructura `<dl>`/`<dt>`/`<dd>` ya usada por `Dt`, preservando la semántica de lista de descripción existente.

## Pruebas

TDD estático y de componente, sin cambios de producción hasta que las pruebas describan el comportamiento esperado:

1. **Estático** — sobre el código fuente de `src/main.tsx`:
   - el panel del branch no licitatorio ya no se titula `Datos comerciales` sino `Contexto comercial`;
   - el bloque principal no referencia `service_type_name`, `offer_value`, `stage_name`, `owner_name`, `created_at`, `expected_close_date`, `next_action_at`, `decision_maker_name`, `decision_maker_email` ni `decision_maker_phone` dentro de este panel;
   - existe un `<details>` con `<summary>Datos de origen</summary>` condicionado a la presencia de al menos uno de los tres metadatos de migración;
   - el contenedor `grid two` de este bloque incluye una clase adicional con `align-items:start` en `src/styles.css`, y la regla compartida `.two{...}` no cambia.

2. **Componente** — render del detalle de oportunidad no licitatoria con datos de fixture, cubriendo:
   - oportunidad con los tres metadatos de migración y observaciones: `Datos de origen` presente y cerrado por defecto (`hasAttribute('open') === false`); dentro aparecen `ID migrado`, `Hoja de origen`, `Estado al importar`, `Observación importada`; el bloque principal no muestra ninguna etiqueta de observación;
   - oportunidad sin ningún metadato de migración pero con observaciones: no existe `<details>`; el bloque principal muestra `Observación comercial` con el texto de `observaciones`;
   - oportunidad sin metadatos de migración ni observaciones: no existe `<details>` y no hay fila de observación en ningún lugar;
   - oportunidad con un solo metadato de migración presente (por ejemplo solo `legacy_excel_id`) y sin observaciones: `<details>` presente, solo la fila `ID migrado` se renderiza, sin filas vacías de `Hoja de origen` ni `Estado al importar`;
   - ciudad y sede ambas presentes: `Ubicación` muestra `${ciudad} · ${sede}`;
   - solo ciudad presente: `Ubicación` muestra solo la ciudad, sin separador colgante;
   - ni ciudad ni sede presentes: `Ubicación` muestra `Por completar`;
   - `economic_sector` vacío: `Sector` muestra `Por completar`;
   - abrir el `<details>` con clic en `<summary>` (simulado vía DOM) alterna su contenido visible sin JavaScript propio de la app (verifica ausencia de `onClick`/estado React controlando la apertura).

## Fuera de alcance

- Migraciones de base de datos, cambios de esquema o de la respuesta de `/api/opportunity-detail`.
- Cambios de API, endpoints o contratos de datos.
- Cambios de permisos, roles o alcance de autorización.
- Cualquier cambio al panel `Resumen de la oportunidad`, al hero o al `grid three` de licitaciones — este diseño solo toca el branch no licitatorio.
- Cambios al componente compartido `Dt`/`Info` o a la regla global `.grid.two`.
- Cambios al `FollowUpForm`, a la línea de seguimientos o a cualquier otro panel de la vista de detalle.
- Renombrar o reestructurar los campos `legacy_excel_id`, `excel_hoja_origen`, `estado_pipeline_original` u `observaciones` en el modelo de datos.

## Criterios de aceptación

- El panel se titula `Contexto comercial` en el detalle de oportunidades no licitatorias.
- El bloque principal muestra Sector y Ubicación (ciudad + sede compuestos), y nunca repite servicio, valor, etapa, responsable, fechas, próxima acción ni decisor.
- Cuando existe algún metadato de migración, aparece un `<details>` cerrado por defecto titulado `Datos de origen` con las etiquetas `ID migrado`, `Hoja de origen`, `Estado al importar` solo para los campos con dato.
- Cuando hay observaciones y metadatos de migración, la observación aparece dentro de `Datos de origen` como `Observación importada`; cuando hay observaciones sin metadatos de migración, aparece en el bloque principal como `Observación comercial`.
- Sin ningún metadato de migración presente, el `<details>` completo no se renderiza.
- Los campos vacíos del bloque principal muestran `Por completar` en vez de `—`.
- La tarjeta izquierda del `grid two` toma su altura natural y no se estira a la del formulario de seguimiento.
- No hay cambios de esquema de base de datos, de API ni de permisos; el cambio es exclusivamente de presentación sobre campos ya existentes.
- El colapsable usa `<details>`/`<summary>` nativos, sin gestión manual de foco ni JavaScript adicional de apertura/cierre.
- Las pruebas estáticas y de componente descritas arriba pasan en verde antes de considerar la tarea completa.
