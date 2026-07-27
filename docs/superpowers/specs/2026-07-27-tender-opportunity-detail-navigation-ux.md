# Diseño UX — navegación compacta de Ver expediente

**Fecha:** 2026-07-27  
**Estado:** aprobado por Juan Botero en conversación  
**Repositorio:** `Premium-Security-Investments/sn-crm-comercial`  
**Alcance:** detalle de oportunidades de Licitación Pública (`Ver expediente`)

## 1. Problema

La vista de detalle consume una proporción excesiva de la primera pantalla en navegación. El breadcrumb, las acciones y seis accesos internos aparecen como bloques separados y, por una regla global sobre `nav`, se apilan verticalmente. Además, la navegación primaria del módulo (`Radar | Seguimiento | Oportunidades`) y la navegación interna del expediente usan lenguajes visuales distintos.

La navegación actual también presenta tres caminos equivalentes para volver a Oportunidades y llama “Línea de avance” a controles que solo hacen desplazamiento hacia secciones; esto sugiere un progreso que el sistema no calcula.

## 2. Objetivos

1. Mostrar primero la identidad y el valor de la oportunidad.
2. Reducir la navegación interna a una barra compacta de una sola fila en escritorio.
3. Mantener separados, pero visualmente coherentes, el nivel módulo y el nivel expediente.
4. Comunicar estado únicamente cuando exista información confiable.
5. Mantener un único regreso explícito a Oportunidades.
6. Conservar acceso visible a la fuente oficial.
7. Evitar que el diseño móvil vuelva a convertirse en seis botones verticales.

## 3. Jerarquía aprobada

El orden exacto de la vista será:

1. **Encabezado global existente**
   - título `Detalle de oportunidad`;
   - acción `Nueva oportunidad`.
2. **Banner azul de la oportunidad**
   - estado comercial;
   - entidad, por ejemplo `AEROCIVIL`;
   - responsable, regional y valor;
   - acciones propias del expediente, como `Editar` y `Sacar de oportunidad`.
3. **Navegación compacta del módulo**
   - `Radar | Seguimiento | Oportunidades`;
   - `Configuración` como acción secundaria sujeta a permiso.
4. **Barra híbrida del expediente**
   - `← Oportunidades`;
   - nombre corto de la entidad;
   - accesos a las seis secciones;
   - `Fuente oficial ↗`.
5. **Contenido restante del expediente**.

El encabezado global se conserva. El banner azul aparece inmediatamente debajo y antes de cualquier navegación del módulo o del expediente.

## 4. Navegación del módulo

`Radar | Seguimiento | Oportunidades` se presenta como un control segmentado compacto alineado a la izquierda, no como tres columnas de ancho completo.

La misma composición se reutiliza en las vistas del módulo y en el detalle. No se mantiene una variante visual separada para el expediente.

`Configuración` permanece fuera de los tres tabs operativos y solo aparece cuando el perfil tiene permiso.

## 5. Barra híbrida del expediente

En escritorio, la barra usa una sola fila:

```text
← Oportunidades | AEROCIVIL | Resumen · Documentos · Análisis · Decisión · Preparación · Seguimiento | Fuente oficial ↗
```

Requisitos:

- sticky una vez que el usuario deja atrás el banner azul;
- fondo claro con contraste suficiente;
- altura compacta;
- accesos con forma de chips o controles discretos, no botones primarios;
- desplazamiento suave a la sección correspondiente;
- sección visible actualizada automáticamente;
- sin breadcrumb independiente;
- sin numeración 1–6, porque no son pasos obligatoriamente secuenciales;
- `← Oportunidades` es el único regreso de este bloque;
- `Fuente oficial ↗` abre una URL pública validada en una pestaña nueva.

## 6. Secciones

Los accesos internos son:

| ID de ancla | Etiqueta compacta | Etiqueta accesible |
|---|---|---|
| `tender-summary` | Resumen | Resumen de la oportunidad |
| `tender-document-review` | Documentos | Revisión documental |
| `tender-analysis` | Análisis | Análisis / preanálisis |
| `tender-decision` | Decisión | Decisión GO / NO GO |
| `tender-preparation` | Preparación | Preparación de oferta |
| `tender-follow-up` | Seguimiento | Seguimiento comercial |

## 7. Estados visuales

### 7.1 Separación entre posición y estado

- **Azul** indica exclusivamente la sección visible/activa.
- El estado operativo se comunica con un punto, texto accesible y tooltip.
- El fondo azul de la sección activa puede coexistir con un punto verde, ámbar, rojo o gris.

### 7.2 Tonos

- **Verde — resuelto:** existe información vigente y confiable.
- **Ámbar — atención:** requiere revisión, decisión o acción humana.
- **Rojo — error o bloqueo:** existe un fallo o vencimiento real.
- **Gris — desconocido/no aplica:** no hay datos suficientes, la carga no terminó o la sección no aplica.

Nunca se infiere un estado positivo a partir de ausencia de errores. Ante duda, se usa gris.

### 7.3 Reglas por sección

**Resumen**
- no tiene estado operativo;
- solo recibe azul cuando es la sección visible.

**Documentos**
- verde: existe al menos un documento vigente y no hay fallo de carga/importación actual;
- ámbar: carga/importación pendiente o evidencia incompleta confirmada;
- rojo: carga o importación fallida;
- gris: no se ha cargado el estado o no hay evidencia suficiente para clasificar.

**Análisis**
- verde: análisis `completed` y `current`;
- ámbar: análisis existente pero obsoleto/no vigente;
- rojo: análisis `failed`;
- gris: sin análisis o todavía cargando.

**Decisión**
- verde: existe decisión humana formal vigente, tanto GO como NO GO;
- ámbar: análisis vigente listo y decisión humana pendiente;
- rojo: fallo al cargar o registrar la decisión;
- gris: todavía no hay base confiable para decidir o está cargando.
- NO GO no se representa como error.

**Preparación**
- verde: existe preparación vigente;
- ámbar: existe GO vigente pero la preparación falta o exige acción;
- rojo: fallo real de carga/creación/actualización;
- gris: no hay decisión, existe NO GO, no aplica o sigue cargando.

**Seguimiento**
- verde: próxima acción programada y vigente;
- ámbar: acción para hoy o dentro de tres días;
- rojo: acción vencida o faltante en oportunidad activa;
- gris: oportunidad en estado terminal o estado aún no disponible.

## 8. Actualización de estado

Los paneles ya cargan documentos, análisis, decisión y preparación. La navegación debe consumir resúmenes de esos estados mediante callbacks tipados, sin duplicar solicitudes ni crear un nuevo endpoint.

Los estados iniciales son `unknown`/gris hasta que cada panel confirme datos. Los errores se comunican estructuradamente; no se deducen analizando mensajes de texto.

Esta mejora no requiere backend, migración ni cambio de permisos.

## 9. Sección activa

La barra usa `IntersectionObserver` para observar las seis anclas.

- actualiza `aria-current="location"` en el acceso activo;
- el desplazamiento manual también actualiza el estado;
- al hacer clic, se aplica `scrollIntoView({ behavior: 'smooth', block: 'start' })`;
- si `IntersectionObserver` no está disponible, el primer acceso permanece activo y los botones siguen navegando;
- el observer se desconecta al desmontar o cambiar el conjunto de secciones.

## 10. Responsive

### Escritorio

- barra híbrida en una fila;
- entidad truncada con ellipsis cuando sea necesario;
- pasos ocupan el espacio flexible central;
- fuente oficial permanece al extremo derecho.

### Móvil y pantallas estrechas

- el banner conserva prioridad visual;
- la barra sigue sticky;
- regreso, entidad y fuente permanecen disponibles;
- los accesos usan desplazamiento horizontal con `overflow-x: auto`;
- no se apilan como seis filas;
- no se convierten en botones de ancho completo.

## 11. Accesibilidad

- `nav` con nombre accesible `Secciones del expediente`;
- `aria-current="location"` únicamente en la sección visible;
- cada indicador incluye texto no dependiente del color;
- `title` o descripción accesible explica el estado;
- foco visible en tabs, regreso, fuente y accesos;
- objetivos interactivos de al menos 36 px de altura en escritorio y 44 px en móvil;
- fuente oficial conserva `target="_blank"` y `rel="noreferrer"`;
- el orden DOM coincide con el orden visual.

## 12. Fuera de alcance

- cambios de backend, migraciones o nuevos campos;
- recalcular el ciclo de negocio;
- cambiar permisos o gates humanos;
- rediseñar el contenido interno de documentos, análisis, decisión o preparación;
- modificar el encabezado global fuera de la reubicación de elementos dentro del detalle;
- desplegar o publicar sin autorización separada.

## 13. Criterios de aceptación

1. El banner azul aparece inmediatamente debajo del encabezado global y antes de las navegaciones.
2. El breadcrumb vertical desaparece.
3. Los tabs del módulo se reutilizan en el detalle y son compactos.
4. La barra del expediente ocupa una fila en escritorio.
5. Solo existe un control de regreso a Oportunidades dentro del bloque.
6. Las seis anclas funcionan y la sección activa cambia durante el scroll.
7. Los estados solo se muestran cuando los paneles suministran datos confiables.
8. GO y NO GO resueltos comparten tono verde; NO GO no aparece como error.
9. En móvil, los accesos se desplazan horizontalmente y la barra permanece sticky.
10. Navegación por teclado, foco visible y atributos ARIA pasan revisión.
11. Las pruebas específicas, la regresión de navegación y `npm run build` pasan.
12. No se modifica backend, base de datos, migraciones ni permisos.
