# Cierre de sesión — Vig-IA Comercial Gate 0

**Fecha:** 2026-07-18  
**Proyecto:** Plataforma SIIO / CRM Comercial  
**Repositorio:** `Premium-Security-Investments/sn-crm-comercial`  
**Rama:** `feat/vig-ia-commercial-gate0`  
**HEAD:** `4d097f0418834f8f733202ce3a0a0fbdc1217c39`  
**PR:** https://github.com/Premium-Security-Investments/sn-crm-comercial/pull/18

## Resultado ejecutivo

Vig-IA Comercial Gate 0 quedó implementado, revisado, probado y validado con autenticación real en Vercel Preview. El PR está abierto, limpio y mergeable. Producción no fue modificada porque la actualización de la credencial productiva requiere una nueva autenticación administrativa de Supabase y Juan no tenía disponibilidad para completar otro código de verificación.

## Resultados completados y verificados

### Implementación y gobierno

- Motor determinístico y explicable `gate0-v1.0` sobre la fuente `CRM-F1`.
- Endpoint read-only `GET /api/vigia/priorities`.
- Autenticación, permiso de módulo y alcance comercial resueltos antes de leer oportunidades.
- Restricción por rol, owner y área comercial; director sin área falla cerrado.
- Allowlist y minimización explícita de campos.
- Paginación completa del snapshot.
- Métodos distintos de GET devuelven `405` sin lectura CRM.
- Fechas inválidas quedan como evidencia de calidad con cero puntos.
- Deep links fail-closed y CTA gobernados por permisos.
- Separación de Licitaciones preservada.
- Sin migraciones ni escrituras productivas del agente.

### QA automatizado y preflight productivo

- 78/78 archivos `tests/*.test.mjs`: PASS.
- `npm run check:siio-integration`: PASS.
- `npm run build`: PASS.
- `npm audit --audit-level=high`: 0 vulnerabilidades.
- `git diff --check origin/main...HEAD`: PASS.
- Advertencia no bloqueante: bundle principal mayor a 500 kB.

### Smoke autenticado en Preview

**Preview validado:** https://seguridad-nacional-qbsozav76-jmb-maxs-projects.vercel.app/#/centinel  
**Deployment:** `dpl_94bwZVGBXJs72g34ZGVswSFRgzyn` — `Ready`

| Caso | Resultado |
|---|---:|
| Gerencia con Vig-IA | `200` |
| Gerencia sin módulo Vig-IA | `403` |
| Director con módulo pero sin área comercial | `403` |
| Comercial sin módulo Vig-IA | `403` |
| Gerencia sin módulo de Licitaciones | `403` |
| Campos sensibles prohibidos | `0` |
| Perfiles QA residuales después del cleanup | `0` |

Datos observados en el smoke:

- 219 oportunidades activas visibles.
- 219 oportunidades priorizadas.
- Fuente `CRM-F1`.
- Política `gate0-v1.0`.
- `read_only: true`.
- Revisión humana obligatoria.

Las identidades, perfiles y permisos QA temporales fueron eliminados. También se eliminaron archivos temporales con credenciales y se cerró la sesión administrativa usada para Preview.

### PR y auditoría

- PR #18 abierto.
- Estado actual: `MERGEABLE` / `CLEAN`.
- HEAD remoto confirmado: `4d097f0418834f8f733202ce3a0a0fbdc1217c39`.
- Evidencia QA actualizada en `docs/qa/vigia-commercial-gate0-verification.md`.
- Descripción del PR actualizada con el smoke autenticado.

## Pendientes determinados

### 1. Establecer acceso administrativo persistente y seguro a Supabase

**Estado:** pendiente.

La sesión usada para Preview se cerró por seguridad. Para evitar pedir códigos de verificación en cada intervención, la próxima autenticación debe dejar un perfil CLI persistente protegido en este servidor, o utilizar un mecanismo equivalente de gestión segura de secretos. Esto requiere una última verificación interactiva cuando Juan esté disponible.

No debe compartirse por chat ninguna contraseña, API key o token permanente.

### 2. Actualizar la credencial de Supabase en Vercel Producción

**Estado:** pendiente; Producción conserva su configuración anterior.

Actualizar `SUPABASE_SERVICE_ROLE_KEY` en el ambiente **Production** del proyecto Vercel `seguridad-nacional-crm`, usando la credencial vigente recuperada mediante acceso administrativo autorizado. No modificar Preview, que ya quedó validado.

### 3. Integrar PR #18 a `main`

**Estado:** pendiente.

El PR está abierto, limpio y mergeable. Debe integrarse únicamente después de completar la actualización de la credencial productiva o coordinarla en el mismo corte, para evitar publicar una aplicación dependiente de una credencial inválida.

### 4. Desplegar Producción

**Estado:** pendiente; no se ejecutó `vercel --prod`.

Desplegar el commit integrado al proyecto `seguridad-nacional-crm`. Confirmar URL, deployment ID, commit, estado `Ready` y capacidad de rollback.

### 5. Ejecutar smoke autenticado post-deploy

**Estado:** pendiente.

Repetir en Producción los mismos casos validados en Preview:

- Gerencia autorizada → `200`.
- Gerencia sin módulo → `403`.
- Director sin área → `403`.
- Comercial sin módulo → `403`.
- Separación de Licitaciones → `403`.
- Minimización: cero campos sensibles prohibidos.
- Política `gate0-v1.0`, read-only y revisión humana.
- Confirmar ausencia de escrituras sobre oportunidades, metas, licitaciones y datasets SIIO.
- Eliminar identidades/perfiles/permisos QA y comprobar residuales en cero.

### 6. Cerrar auditoría productiva

**Estado:** pendiente.

Actualizar:

- `docs/qa/vigia-commercial-gate0-verification.md`;
- descripción/estado final del PR;
- URL e ID del deployment productivo;
- commit desplegado;
- códigos HTTP observados;
- resultado del cleanup;
- estado histórico y actual de la credencial, siempre sin registrar su valor.

## Punto exacto para retomar

Cuando Juan tenga disponibilidad para una única verificación, continuar con:

> **“Continuemos con Producción y dejemos el acceso persistente.”**

Orden de ejecución:

1. autenticar Supabase y conservar acceso administrativo seguro;
2. recuperar y validar la credencial vigente;
3. actualizar Vercel Production;
4. integrar PR #18;
5. desplegar Producción;
6. ejecutar smoke autenticado;
7. limpiar QA y cerrar auditoría.
