# AGT-002 — arquitectura reusable para futuras licitaciones

**Fecha:** 2026-08-17 · **Estado:** implementada y verificada en Fase 9. Manizales SA-24-2026 permanece como el único proceso V3 registrado y habilitado.

## 1. Objetivo

Permitir que una segunda licitación use el contrato V3 sin copiar el runtime de Manizales y sin habilitar nada automáticamente. La reutilización ocurre por paquete gobernado, no por sustitución de identificadores.

## 2. Componentes implementados

- `agt002-process-package.js` — valida la forma cerrada del descriptor: identidad, referencia al manifiesto, aprobación humana, checklist y habilitación explícita. El contenido del manifiesto y su gobernanza permanecen en los módulos gobernados que el descriptor referencia.
- `agt002-process-onboarding-gate.js` — gate puro y fail-closed. Requiere simultáneamente paquete válido, aprobación humana, checklist completo, `explicitly_enabled=true`, allowlist server-owned y coincidencia exacta de identidad.
- `agt002-integral-manifest-source.js` — registry indexado por `(opportunity_id, proceso)`. Devuelve `null` con V3 apagado y lanza error para un proceso no inscrito cuando V3 está activo; nunca hereda Manizales ni fabrica un manifiesto vacío.
- `agt002-manizales-manifest-source.js` — delegador compatible hacia el registry genérico; conserva su API y comportamiento externo.
- `contracts/agents/AGT-002/v3/` — schemas JSON versionados para envelope, análisis integral, scope y paquete de proceso, con manifiesto de archivos.
- `data/agt002/processes/README.md` y `_template/process.package.template.json` — convención y plantilla segura. La plantilla nace sin aprobación, checklist incompleto y deshabilitada.

La capa de validación (`agt002-integral-analysis-v3.js`, `agt002-evidence-state-manifest.js`, `agt002-integral-category-manifest.js`) sigue siendo proceso-agnóstica y exige cobertura 1:1.

## 3. Registro inicial y compatibilidad

El registry contiene exactamente un paquete inicial: Manizales SA-24-2026. El paquete referencia el manifiesto gobernado existente y su gobernanza curada; no duplica ni reescribe esos activos.

La clave real es `(opportunity_id, proceso)`, no slug, nombre de archivo ni orden de registro. La combinación solicitada debe coincidir exactamente con la identidad del paquete y con la allowlist server-owned.

Con el flag V3 apagado, la selección retorna `null` y el runtime conserva el camino anterior. Con V3 activo, una combinación desconocida falla antes de tocar el proveedor.

## 4. Incorporación de un proceso futuro

Un segundo proceso sólo puede entrar si existen todos estos elementos:

1. identidad real `(opportunity_id, proceso)`;
2. manifiesto gobernado con citas verificables;
3. catálogo y enlaces de evidencia curados;
4. aprobación humana trazable;
5. checklist de onboarding completo;
6. habilitación explícita del paquete;
7. inscripción deliberada en la allowlist server-owned;
8. pruebas de mismatch, flag apagado, identidad exacta y regresión Manizales.

El procedimiento operativo completo vive en `docs/runbooks/agt002-process-onboarding-gate.md`.

## 5. Límites conservados

- El registry no convierte oportunidades ni decide qué licitación analizar.
- El paquete no contiene conclusiones de cumplimiento ni GO/NO-GO.
- El validador V3 no se relaja para procesos nuevos.
- Ningún paquete se descubre automáticamente desde disco.
- La presencia de un archivo bajo `data/agt002/processes/` no habilita nada por sí sola.
- Sólo código server-owned puede ampliar la allowlist.

## 6. Invariante central

**Ausencia de paquete válido + aprobación + checklist + habilitación explícita + allowlist para un `(opportunity_id, proceso)` implica abstención/error cerrado; nunca manifiesto sintético, heredado o parcialmente aceptado.**
