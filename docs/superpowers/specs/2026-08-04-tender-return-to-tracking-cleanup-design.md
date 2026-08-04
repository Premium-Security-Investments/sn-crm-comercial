# Diseño corregido: salidas de una oportunidad de licitación y limpieza operativa

**Fecha:** 2026-08-04  
**Estado:** pendiente de aprobación final después de corrección solicitada por Juan Botero

## Objetivo

Diferenciar claramente las tres ubicaciones operativas de una licitación pública:

1. **Oportunidades**: proceso actualmente calificado como oportunidad comercial.
2. **Seguimiento**: proceso que todavía interesa, pero requiere observación o gestión antes de volver a ser oportunidad.
3. **Radar**: proceso retirado de Oportunidades sin seguimiento activo; permanece disponible para consulta y evaluación futura.

La vista operativa debe mostrar solo información que ayude a decidir o actuar. La trazabilidad técnica se conserva en datos, eventos y pruebas, no como ruido en la interfaz ordinaria.

## Alcance

### 1. Acciones disponibles en Oportunidades

En el detalle de una oportunidad de licitación existirán dos acciones distintas:

- **Sacar de oportunidad**: se mantiene con su nombre actual. Retira la oportunidad de la sección Oportunidades y devuelve la licitación al Radar.
- **Pasar a seguimiento**: nueva acción. Retira la oportunidad de la sección Oportunidades y mueve la licitación a la bandeja Seguimiento.

Ninguna de estas acciones equivale a descartar definitivamente la licitación.

### 2. Estados y ubicación visible

`psi_public_tenders.internal_status` será la fuente de verdad de la ubicación operativa:

- `convertida_oportunidad`: visible únicamente en Oportunidades.
- `en_revision`: visible únicamente en Seguimiento.
- `nueva`: visible en Radar y fuera de Oportunidades y Seguimiento.
- `descartada`: estado preexistente fuera de este cambio; no será usado por ninguno de los dos botones del detalle de Oportunidades.

Las oportunidades de licitación vinculadas a un proceso cuyo estado sea `en_revision` o `nueva` deben quedar excluidas de la bandeja Oportunidades y de los indicadores del pipeline activo, sin contarse como pérdidas o descartes.

### 3. Conservación de historial y reconversión

Los registros comerciales, documentos, análisis, interacciones y eventos históricos no se borrarán.

Al sacar una oportunidad al Radar o pasarla a Seguimiento se conservará la relación histórica necesaria para:

- saber qué oportunidad originó el expediente;
- preservar documentos y decisiones previas;
- reutilizar el mismo registro si posteriormente vuelve a Oportunidades;
- impedir duplicados.

Se conservará `converted_opportunity_id` como vínculo persistente con el registro comercial existente. Este campo conserva la relación histórica, pero no determina por sí solo la ubicación visible: `internal_status` manda. Por lo tanto, Radar y Seguimiento deben priorizar `internal_status` al construir sus etiquetas y filtros, y solo mostrar «Convertida en oportunidad» cuando el estado sea `convertida_oportunidad`.

### 4. Transacciones atómicas

Se implementarán dos transiciones explícitas y separadas.

#### 4.1 Oportunidad → Radar

En una sola transacción:

1. validar actor, permisos, oportunidad y vínculo único;
2. bloquear oportunidad y licitación;
3. si ya está en `nueva` como resultado de la misma transición, devolver `already_returned_to_radar` sin duplicar eventos;
4. comprobar que el origen esté en `convertida_oportunidad`;
5. comprobar el token de concurrencia;
6. cambiar `internal_status` a `nueva`;
7. limpiar campos de seguimiento activo;
8. retirar la oportunidad del pipeline visible sin clasificarla como descartada o perdida;
9. registrar una interacción y un evento inmutable `returned_to_radar`;
10. devolver la licitación actualizada.

#### 4.2 Oportunidad → Seguimiento

En una sola transacción:

1. validar actor, permisos, oportunidad y vínculo único;
2. bloquear oportunidad y licitación;
3. si ya está en `en_revision` como resultado de la misma transición, devolver `already_returned_to_tracking` sin duplicar eventos;
4. comprobar que el origen esté en `convertida_oportunidad`;
5. comprobar el token de concurrencia;
6. cambiar `internal_status` a `en_revision`;
7. asignar `tracking_owner_id` al actor autorizado;
8. establecer `tracking_status = pendiente_revision`;
9. retirar la oportunidad del pipeline visible sin clasificarla como descartada o perdida;
10. registrar una interacción y un evento inmutable `returned_to_tracking`;
11. devolver la licitación actualizada.

Ambas transiciones serán idempotentes por estado, vínculo y destino. Un fallo al insertar la interacción o el evento debe revertir toda la operación.

### 5. Corrección de «Seguimiento desactualizado»

La causa raíz observada es la pérdida de precisión del token `tracking_updated_at`: PostgreSQL puede entregar microsegundos y el servidor lo convierte mediante `Date`, reduciéndolo a milisegundos antes de llamar el RPC. Una comparación exacta puede rechazar entonces un token vigente.

La corrección debe:

- preservar sin transformación el timestamp entregado por PostgreSQL cuando se usa como token opaco de concurrencia;
- mantener validación estricta para fechas ordinarias introducidas por clientes;
- mantener la comparación exacta en PostgreSQL;
- incluir una prueba con microsegundos;
- incluir una prueba que confirme el rechazo de un token realmente obsoleto.

La corrección aplicará a las dos transiciones. Aunque su nombre histórico sea `tracking_updated_at`, ese campo pertenece al registro de la licitación y será el token opaco de versión tanto para Oportunidad → Radar como para Oportunidad → Seguimiento.

### 6. Interfaz de acciones

En el encabezado del detalle:

- **Pasar a seguimiento** será una acción secundaria.
- **Sacar de oportunidad** conservará su nombre y será una acción separada.
- Cada acción explicará su destino antes de confirmar:
  - «Sacar de oportunidad» → vuelve al Radar.
  - «Pasar a seguimiento» → queda en Seguimiento.
- Cada acción solicitará un motivo breve.
- Durante una solicitud, ambos botones quedarán deshabilitados para evitar duplicados.
- Después de un éxito, la interfaz recargará los datos y navegará a la bandeja de destino.
- Los errores de concurrencia reales indicarán que otra persona modificó la licitación y que se debe recargar antes de intentar nuevamente.

### 7. Limpieza de la vista operativa

Se eliminarán de la interfaz ordinaria:

- ambos bloques «Detalles técnicos y auditoría»;
- UUID de snapshot, productor, estado técnico y nombre interno del motor;
- el acordeón «Cómo funciona»;
- «Citas de evidencia» con IDs internos;
- avisos duplicados sobre AGT-002, productor real o idempotencia;
- el acordeón y listado técnico de cobertura con páginas, secciones, versiones y «Base»;
- la métrica «Omitidos», porque no explica una acción para el usuario.

Se conservará:

- una sola explicación visible de que Vig-IA organiza evidencia pero no autoriza GO / NO GO;
- una franja compacta no desplegable con:
  - «N referencias utilizadas»;
  - «X de Y requisitos con evidencia».

La franja seguirá la misma sangría, ancho y tipografía del contenido del análisis. Los datos técnicos seguirán disponibles en persistencia, auditoría y pruebas.

## Manejo de errores

- Un vínculo inexistente o múltiple bloquea la transición.
- Una oportunidad no vinculada a una licitación pública no puede usar estas acciones.
- Un conflicto de concurrencia real devuelve HTTP 409 y no modifica ninguna tabla.
- Un fallo en interacción o evento revierte la transacción.
- La UI no muestra mensajes técnicos de PostgreSQL ni identificadores internos.
- Si una transición ya fue aplicada al mismo destino, la repetición responde con éxito idempotente sin duplicar trazabilidad.
- Si la licitación ya está en un destino diferente del solicitado —por ejemplo, pedir Radar cuando otra operación ya la movió a Seguimiento— se devuelve HTTP 409, no se cambia ningún dato y la UI solicita recargar.

## Pruebas y verificación

### Datos y RPC

- Oportunidad → Radar produce `internal_status = nueva`.
- Oportunidad → Seguimiento produce `internal_status = en_revision` y seguimiento inicial válido.
- Cada destino desaparece de Oportunidades y aparece únicamente en su bandeja correspondiente.
- Ninguna transición incrementa descartes o pérdidas.
- El historial y los documentos se conservan.
- La reconversión reutiliza la oportunidad existente y no crea duplicados.
- Las dos transiciones son idempotentes.
- Un fallo de evento provoca rollback completo.
- Un timestamp con microsegundos vigente es aceptado.
- Un token realmente obsoleto es rechazado.

### Interfaz

- existen los botones «Sacar de oportunidad» y «Pasar a seguimiento»;
- cada confirmación explica el destino correcto;
- cada éxito navega al Radar o Seguimiento correspondiente;
- no aparecen UUID, IDs de evidencia, AGT-002 ni metadatos técnicos;
- existe una sola advertencia humana;
- la cobertura es una franja compacta sin acordeón ni lista técnica;
- el diseño funciona en escritorio y móvil.

### Verificación final

1. pruebas focalizadas;
2. regresión completa secuencial;
3. build de producción;
4. paridad entre servidor y función Vercel;
5. `git diff --check`;
6. una revisión técnica independiente;
7. migración y despliegue;
8. comprobación mecánica del despliegue;
9. una validación guiada en la sesión autenticada de Juan.

## Fuera de alcance

- crear un nuevo botón de descarte definitivo en el detalle de Oportunidades;
- borrar trazabilidad histórica;
- cambiar la lógica de recomendación de Vig-IA;
- modificar la decisión humana GO / NO GO;
- rediseñar las demás etapas comerciales.
