# AGT-002 — convención de paquete por proceso

**Fecha:** 2026-08-17 · **Estado:** convención documental para cuando exista el paquete reusable (tareas 3/4 del plan de fase 9, no implementadas todavía). No crea ningún archivo bajo `data/agt002/processes/` en esta sesión — ese directorio no existe hoy en el repositorio.

Este documento fija la convención de nombres y estructura que debe seguir cualquier implementación futura del paquete reusable descrito en `docs/architecture/agt002-reusable-licitacion-architecture.md`, tomando como único precedente real el manifiesto de Manizales.

## 1. Precedente real (verificado en código)

Hoy, el único manifiesto gobernado vive como un archivo plano en `data/agt002/manizales-sa-24-2026.integral-manifest.v1.json`, cargado por `agt002-manizales-integral-manifest.js` y expuesto por `agt002-manizales-manifest-source.js`. No hay convención de carpeta por proceso — hay exactamente un archivo, para exactamente un proceso.

## 2. Convención objetivo: un directorio por proceso

```
data/agt002/processes/
  README.md                                  <- explica la convención, enlaza este documento
  _template/
    process.package.template.json            <- forma vacía, con comentarios de campo obligatorio/opcional
  manizales-sa-24-2026/                       <- slug: <municipio-o-entidad>-<expediente>
    process.package.json                      <- metadatos del paquete + referencia al manifiesto
    manifest.v1.json                          <- el manifiesto gobernado (hoy: manizales-sa-24-2026.integral-manifest.v1.json)
    governance/
      category-overrides.json                 <- espejo versionado de lo curado en la migración 064/066
      evidence-class-links.json
```

**Slug:** `<identificador-corto-entidad>-<expediente-o-proceso>`, en minúsculas, guiones, sin espacios ni caracteres especiales — mismo patrón que ya usa el nombre de archivo de Manizales (`manizales-sa-24-2026`). El slug es sólo un identificador legible de directorio; el índice real del registry sigue siendo `(opportunity_id, proceso)`, nunca el slug ni el nombre de archivo (ver `docs/architecture/agt002-reusable-licitacion-architecture.md` §3).

## 3. Campos obligatorios de `process.package.json`

Basado en lo que la migración `066` ya exige y verifica para Manizales (procedencia completa, no inferida):

- `opportunity_id` (uuid) y `proceso` (texto) — la clave de indexación real.
- `manifest_ref` — ruta relativa al manifiesto gobernado del paquete.
- `schema_version` del paquete (independiente del `schema_version` del contrato V3, que sigue siendo `3.0.0`).
- Por cada entrada de gobernanza: `requirement_id`, `override_kind`, `category_value` o `evidence_class_id`, `rationale`, `source_reference`, `curated_by`, `curated_at`, `version` — exactamente los campos que la migración `066` exige y valida para Manizales, no un subconjunto relajado.
- `approval` — quién aprobó el paquete para pasar el gate de onboarding y cuándo (persona, no "el sistema").

## 4. Qué NO va en el paquete

- Nunca un archivo, secreto o URL firmada — el precedente de la migración `061` (registro de evidencia empresarial) es explícito: sólo metadatos, nunca el documento en sí.
- Nunca una conclusión de cumplimiento pre-calculada — el paquete provee la gobernanza de entrada (a qué clase de evidencia corresponde cada requisito), no el resultado del análisis.
- Nunca un manifiesto sin citas verificables contra un excerpt real; ver `docs/architecture/agt002-lessons-learned.md` §3 sobre qué significa "verificado" en este sistema.

## 5. Migración de Manizales a la convención

Cuando se implemente el paquete reusable (tarea 3), migrar Manizales a esta convención debe hacerse **sin reescribir su manifiesto ni su gobernanza curada** — mover/enlazar los archivos existentes a la nueva estructura de carpeta, conservando el contenido byte-idéntico, y dejar `agt002-manizales-manifest-source.js` como delegador compatible del registry genérico (no eliminarlo). El primer y único registro real del registry, el día que exista, debe seguir siendo Manizales.

## 6. Qué este documento no autoriza

- No autoriza crear `data/agt002/processes/` ni ningún archivo bajo esa ruta en esta sesión.
- No autoriza mover ni modificar el manifiesto real de Manizales — permanece donde está hasta que la tarea 3 se implemente y pruebe.
