# Diseño — navegación segmentada de SIIO y Licitaciones

**Fecha:** 2026-07-16
**Estado:** Aprobado
**Rama:** `feature/segmented-module-navigation`

## Problema

Las cuatro vistas internas de SIIO y Licitaciones se renderizan como botones apilados a ancho completo. Consumen altura, retrasan el contenido operativo y parecen acciones primarias en vez de navegación secundaria. La causa base es la regla global `nav { flex-direction: column }`; SIIO no sobreescribe la dirección y Licitaciones no tiene estilo específico para sus pestañas.

## Alcance aprobado

- El menú lateral permanece exactamente igual: mismos nombres, rutas, permisos y orden.
- `Licitaciones` continúa abriendo Radar.
- `SIIO Gerencial` continúa abriendo Resumen ejecutivo.
- SIIO conserva cuatro vistas internas: Resumen ejecutivo, Seguimiento gerencial, Fuentes e inteligencia y Agentes.
- Licitaciones conserva cuatro vistas internas: Radar, Seguimiento, Expedientes y Perfiles de búsqueda.
- Ambas navegaciones usan un control segmentado de ancho completo, una fila y cuatro segmentos iguales.
- En Licitaciones, el control aparece inmediatamente después del banner o encabezado contextual de cada vista.
- En SIIO, el control permanece después del banner general existente.

## Diseño visual

El contenedor tendrá fondo azul grisáceo claro, borde fino, radio moderado y padding interior de cuatro píxeles. Cada segmento ocupa una cuarta parte del ancho. Los segmentos inactivos son planos, sin sombra y con contraste alto; el activo usa azul institucional sólido y texto blanco. El control no debe competir con las llamadas a la acción del contenido.

En escritorio la altura objetivo es 40–44 px. En móvil sigue siendo una sola fila de cuatro columnas; las etiquetas largas pueden ocupar dos líneas dentro de una altura compartida. No se permite transformar el control en columna ni generar overflow horizontal del documento.

## Comportamiento y accesibilidad

- Se conserva `aria-current="page"` en la vista activa.
- El foco de teclado debe ser visible.
- Las rutas hash actuales no cambian.
- No se crean nuevas llamadas API ni mutaciones.
- La navegación debe funcionar con teclado y clic.
- El estado activo debe seguir derivándose de la ruta actual.

## Arquitectura

Ambos componentes de navegación compartirán una clase visual `module-segmented-nav`, manteniendo sus clases semánticas actuales. El estilo compartido vivirá en `src/styles.css`; SIIO conservará únicamente los ajustes específicos que no dupliquen el control común.

`TendersModule` seguirá siendo el orquestador de rutas. Creará una sola instancia lógica de `TenderModuleTabs` y la entregará a la vista activa. Cada vista la insertará después de su propio `<header>`, evitando hacks de orden CSS y preservando el encabezado contextual correcto.

## Pruebas y QA

- Prueba estática nueva para comprobar cuatro opciones, clase compartida, cuadrícula de cuatro columnas, ausencia de layout vertical y ubicación posterior al encabezado en las cuatro vistas de Licitaciones.
- Suite completa, checkers SIIO, TypeScript y build.
- QA autenticado en desktop y móvil para SIIO y Licitaciones.
- Verificación de ancho de documento, estado activo, rutas y menú lateral sin cambios.
- Smoke productivo tras deploy.

## Fuera de alcance

- Renombrar o ampliar el menú lateral.
- Cambiar permisos o rutas.
- Eliminar Radar o Resumen ejecutivo.
- Cambiar filtros, datos, RPC o acciones operativas.
- Rediseñar banners o contenido de las vistas.
