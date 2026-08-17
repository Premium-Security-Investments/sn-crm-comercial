# AGT-002 — convención de paquete por proceso

**Fecha:** 2026-08-17 · **Estado:** implementada en `agt002-process-package.js`, el schema V3 y `data/agt002/processes/`.

Este documento resume la forma ejecutable real. La autoridad es `agt002-process-package.js` y `contracts/agents/AGT-002/v3/process-package.schema.json`.

## 1. Ubicación y descubrimiento

```text
data/agt002/processes/
  README.md
  _template/
    process.package.template.json
```

La carpeta no tiene autodiscovery. Agregar un archivo no registra ni habilita un proceso. La inscripción real ocurre explícitamente en el registry server-owned de `agt002-integral-manifest-source.js`.

Manizales conserva su manifiesto en `data/agt002/manizales-sa-24-2026.integral-manifest.v1.json`; el descriptor inicial lo referencia por medio del módulo gobernado existente, sin moverlo ni duplicarlo.

## 2. Forma cerrada del descriptor

Un descriptor contiene exactamente:

- `schema_version` — hoy `agt002-process-package@1`.
- `opportunity_id` — UUID real de la oportunidad.
- `proceso` — identificador exacto del proceso.
- `manifest_ref`:
  - `artifact_type`;
  - `contract_version`;
  - `path` relativo al manifiesto gobernado.
- `human_approval`:
  - `required` debe ser `true`;
  - `approved` booleano;
  - `approver` y `approved_at`, obligatorios y no vacíos cuando `approved=true`.
- `onboarding_gate.checklist` — arreglo cerrado de `{id, passed}`, sin IDs duplicados.
- `enablement`:
  - `flag` server-owned;
  - `explicitly_enabled` booleano.

Propiedades desconocidas, UUID inválido, identidad inconsistente, referencias vacías, checklist vacío/duplicado o tipos inválidos producen rechazo.

El descriptor no embebe las entradas del manifiesto, clases de evidencia ni overrides. Esos activos permanecen en módulos gobernados separados y el registry los resuelve sólo después de pasar el gate.

## 3. Gate de onboarding

Además de la forma válida, `agt002-process-onboarding-gate.js` exige:

1. coincidencia exacta de `(opportunity_id, proceso)`;
2. `human_approval.approved === true`;
3. aprobador y fecha no vacíos;
4. presencia y aprobación de todos los IDs de checklist requeridos;
5. `enablement.flag` igual al flag server-owned esperado;
6. `enablement.explicitly_enabled === true`;
7. pareja incluida explícitamente en la allowlist server-owned.

La validación de forma y la autorización son gates distintos: una plantilla deshabilitada puede tener forma válida, pero nunca pasar onboarding.

## 4. Estado seguro de la plantilla

`data/agt002/processes/_template/process.package.template.json` nace no habilitable:

- identidad de reemplazo, no productiva;
- aprobación humana en falso;
- checklist completo en falso;
- `explicitly_enabled=false`;
- referencia de manifiesto de reemplazo.

Copiar la plantilla sin completar y aprobar todos los gates falla cerrado.

## 5. Qué no va en el descriptor

- secretos, tokens, headers, connection strings o URLs firmadas;
- PDFs, documentos empresariales o payloads crudos;
- conclusiones de cumplimiento o GO/NO-GO;
- entradas de manifiesto inventadas;
- flags globales que descubran/habiliten cualquier archivo presente.

## 6. Reglas para un proceso nuevo

- Mantener el validador V3 y la cobertura 1:1 sin relajaciones.
- Crear manifiesto y gobernanza separados, trazables y revisados.
- Crear pruebas de flag apagado, proceso desconocido, mismatch de identidad y checklist incompleto.
- Demostrar que Manizales conserva comportamiento idéntico.
- Obtener aprobación humana y autorización antes de ampliar la allowlist.
- Ejecutar canary único y revisión humana antes de disponibilidad continua.

Runbook operativo: `docs/runbooks/agt002-process-onboarding-gate.md`.
