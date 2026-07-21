# Diseño — filtros compactos del Radar de Licitaciones

**Fecha:** 2026-07-21  
**Estado:** aprobado mediante mockup por Juan Botero

## Problema

El panel `Filtros del Radar` presenta nueve controles en una grilla de dos columnas. En escritorio ocupa cerca de 570 px de altura antes de mostrar resultados, mientras varios campos reciben mucho más ancho del necesario.

## Objetivo

Reducir la altura del panel a aproximadamente 160–200 px en escritorio, manteniendo visibles y funcionales los nueve controles actuales.

## Diseño aprobado

### Escritorio — 12 columnas

Primera fila:
- Buscar: 6 columnas.
- Fuente: 2 columnas.
- Región SN: 2 columnas.
- Cierre: 2 columnas.

Segunda fila:
- Valor: 2 columnas.
- Encaje: 2 columnas.
- Sección: 2 columnas.
- Estado interno: 2 columnas.
- Orden: 4 columnas.

El panel tendrá padding de 14–16 px, separación de 8–12 px, etiquetas compactas y controles de 40–42 px.

### Tablet

- Buscar ocupa todo el ancho.
- Los ocho filtros se distribuyen en tres columnas.
- Orden puede ocupar dos columnas cuando el ancho disponible lo requiera.

### Móvil — referencia 390 px

- Buscar y Orden ocupan todo el ancho.
- Los siete filtros restantes se distribuyen en dos columnas.
- Controles con al menos 44 px de altura táctil.
- Sin desplazamiento horizontal ni texto recortado de forma ilegible.

## Alcance técnico

- Añadir clases semánticas a los controles existentes en `TenderRadarView.tsx`.
- Sustituir la grilla genérica de dos columnas por reglas específicas en `styles.css`.
- Conservar estados, eventos, opciones, perfiles guardados, filtrado, ordenamiento y resultados actuales.
- No añadir botones, desplegables, dependencias ni cambios de backend.
- No modificar datos, roles, permisos ni APIs.

## Accesibilidad y respuesta visual

- Mantener etiquetas nativas asociadas a cada `select` mediante su contenedor `label`.
- Conservar estados de foco existentes.
- Mantener tamaño táctil mínimo de 44 px en móvil.
- Verificar escritorio y móvil con navegación autenticada.

## Criterios de aceptación

1. Los nueve controles continúan visibles y operativos.
2. En escritorio el panel usa exactamente dos filas de controles.
3. A 390 px no existe overflow horizontal.
4. El panel es sustancialmente más bajo que la versión actual.
5. No cambia la cantidad ni el contenido de las opciones.
6. Suite de pruebas, TypeScript y build permanecen verdes.
7. El smoke autenticado no registra errores de consola ni escrituras API.
