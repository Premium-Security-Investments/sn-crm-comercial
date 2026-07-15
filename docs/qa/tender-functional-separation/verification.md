# Verificación QA — separación funcional de Licitaciones

**Fecha:** 2026-07-15
**Entorno:** preview local autenticado contra Supabase del CRM
**Resultado:** PASS — 45/45 comprobaciones

## Alcance

Se verificaron como vistas independientes:

1. Radar de oportunidades (`view=radar`)
2. Seguimiento (`view=seguimiento`)
3. Expedientes (`view=expedientes`)
4. Perfiles de búsqueda (`view=perfiles`)

Cada vista fue validada en desktop (1440×900) y móvil (390×844).

## Evidencia funcional

- Todos los endpoints de lectura requeridos respondieron sin errores 4xx/5xx.
- Radar cargó exclusivamente `bootstrap` y `tenders`.
- Seguimiento cargó exclusivamente `bootstrap` y `tender-tracking`.
- Expedientes cargó exclusivamente `bootstrap` y `tender-dossiers`.
- Perfiles cargó `bootstrap`, `tender-company-profile` y `tender-search-profiles`.
- No se observaron mutaciones HTTP durante la carga de ninguna vista.
- La vista activa expuso `aria-current="page"` en los ocho escenarios.
- No hubo banners de error.
- No hubo overflow horizontal de página.
- Aplicar un perfil guardado abrió Radar con su parámetro de perfil.
- Abrir un expediente con `focus=documents` enfocó `#tender-document-review`.
- Atrás/adelante del navegador preservó la vista seleccionada.

El detalle máquina-legible está en `qa-results.json`.

## Migraciones

Se aplicaron `017_tender_tracking_workflow.sql` y `018_tender_tracking_rpc.sql` después de preflight:

- 711 licitaciones preservadas.
- Cero duplicados externos o conversiones duplicadas bloqueantes.
- 8 columnas de seguimiento verificadas.
- Tabla de eventos verificada.
- 4 funciones RPC verificadas.
- 4 índices verificados.
- Cero privilegios directos `INSERT/UPDATE/DELETE` para `authenticated` sobre licitaciones e historial.

El rollback de emergencia está en `supabase/rollbacks/017_018_tender_tracking_rollback.sql` y fue probado sobre PGlite después de aplicar la migración RPC.

## Suite

- 47 archivos de pruebas JavaScript: PASS.
- 3 pruebas Python del extractor SIIO: PASS.
- Checkers SIIO, catálogo de agentes, navegación y permisos: PASS.
- Paridad byte a byte entre `api/[...path].js` y `server/index.js`: PASS.
- Sintaxis Node de handlers y utilidad de migración: PASS.
- `npm run build`: PASS.
- `git diff --check`: PASS.

## Hallazgo corregido durante QA

El badge de diagnóstico de fuentes de Radar medía 513 px en un viewport de 390 px por `white-space: nowrap`. Se aplicó un estilo scoped que permite wrapping dentro de `.tender-source-diagnostics`; la verificación posterior reportó `scrollWidth=390` y `clientWidth=390`.

## Evidencia visual

- `radar-desktop.png` / `radar-mobile.png`
- `tracking-desktop.png` / `tracking-mobile.png`
- `dossiers-desktop.png` / `dossiers-mobile.png`
- `profiles-desktop.png` / `profiles-mobile.png`
- `dossier-document-focus.png`
- `contact-desktop.jpg` / `contact-mobile.jpg`

## Riesgo no bloqueante

Vite advierte que el bundle JavaScript minificado supera 500 kB (~622 kB). No produjo error de build ni fallo funcional; se recomienda code splitting como mejora posterior.
