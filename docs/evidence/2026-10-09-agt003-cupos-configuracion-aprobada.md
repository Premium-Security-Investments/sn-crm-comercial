# Evidencia — AGT-003: la configuración aprobada gobierna modelo y cupos de Vig-IA Comercial

```text
AGENTE: AGT-003 / Vig-IA Comercial (trabajo sobre la Plataforma de Agentes → puerta única de modelos, Paso 2 parte 3)
PROYECTO: SIIO / CRM comercial (sn-crm-comercial)
FECHA_CORTE_UTC: 2026-10-09
OBJETIVO: que la configuración APROBADA y vigente en la Plataforma de Agentes gobierne de verdad el modelo, el
          encendido/apagado y los cupos (equipo y por persona) del copiloto y del análisis profundo; y agregar el campo
          "Perfil de uso de IA" en Usuarios y permisos.
REPOSITORIO: sn-crm-comercial
RAMA: feat/agt003-cupos-aprobados (base: feat/it-agentes-configuracion, PR #341, aún no fusionado; commit base dacc173)
COMMIT_SHA: ver el PR (commit único de esta rama)
PR: ver la descripción del PR (base feat/it-agentes-configuracion)
ESTADO_DEL_TRABAJO: código escrito y PR abierto. Migraciones 117–119 ESCRITAS, NO aplicadas. Sin despliegue.
```

## CAMBIOS_REALIZADOS

- Lector de la configuración vigente (`platform.current_agent_configuration`, sólo lectura, AGT-003, ambiente
  `VERCEL_ENV` o `production`) con caché de 60 s por instancia, tiempo límite de 2 s y **falla abierta**: última
  configuración conocida en la instancia o, si nunca la tuvo, valores del código (20/día, 30/mes, modelo del entorno).
  Versión inválida → `console.warn` y se siguen usando los valores previos.
- Política por función y persona: encendida/apagada, modelo (lista cerrada; si no, el del entorno), cupo del equipo
  en hora de Bogotá, cupo por persona según su "Perfil de uso de IA" (`profile_caps`, `unlimited` + `safety_max`),
  excepciones vigentes (`expires` ≥ hoy en Bogotá). Orden: excepción > perfil > equipo; nunca por encima del equipo.
- Reservas atómicas nuevas (equipo + persona) con caída a las originales si la migración no está aplicada.
- Rechazos con códigos distintos: `AGT003_CAPABILITY_DISABLED`, `VIGIA_COPILOT_QUOTA` / `VIGIA_COPILOT_PERSONAL_QUOTA`,
  `AGT003_LEAD_ANALYSIS_QUOTA` / `AGT003_LEAD_ANALYSIS_PERSONAL_QUOTA`.
- Usuarios y permisos: select "Perfil de uso de IA" (perfiles no archivados de la plataforma, "Sin perfil"),
  deshabilitado con aviso si la plataforma no responde, validado en el servidor y auditado.
- IT → Agentes → Uso de IA: "Tope actual del equipo" con el origen (configuración vigente vN o valores del código) y
  el día en hora Bogotá.

## Reglas de cupo por persona (documentadas también en `agt003-ai-quota.js`)

| Situación de la persona | Cupo por persona |
|---|---|
| Sin perfil, o perfil que no está en `profile_caps` | Ninguno: sólo el cupo del equipo |
| Perfil `{ per, max }` | `max` por `per` |
| Perfil `{ unlimited: true, safety_max }` | Techo `safety_max` en el periodo del cupo del equipo |
| + excepción vigente del mismo periodo | perfil (o techo) + `extra` |
| + excepción sin cupo por persona | No crea cupo: el techo sigue siendo el equipo (una excepción nunca lo supera) |
| + excepción de otro periodo (día vs. mes) | No se aplica; `console.warn` |
| Cupo por persona mayor que el del equipo (mismo periodo) | Se recorta al del equipo |

## MIGRACIONES (escritas, no aplicadas)

- `117_agt003_copilot_quota_by_actor.sql` — `actor_id` en reservas vivas del copiloto, índices y
  `psi_claim_agt003_copilot_run_v2` (mismo lock y semántica que 043; equipo y persona; `scope` en la respuesta).
- `118_agt003_lead_analysis_quota_by_actor.sql` — `psi_claim_agt003_lead_analysis_v2` (mismo lock y semántica que 114).
- `119_crm_profile_ai_usage_profile.sql` — `psi_sales_profiles.ai_usage_profile` (slug) y
  `psi_admin_set_profile_ai_usage_profile` con auditoría en `psi_access_audit_log`.
- Reversas en `supabase/rollbacks/117…119_*_rollback.sql`.

## PRUEBAS_EJECUTADAS / RESULTADO_DE_PRUEBAS / AMBIENTE

Locales, en el worktree, sin bases reales (dobles y PGlite). Resultados exactos en la descripción del PR.

## FALLOS_RIESGOS_Y_LIMITES

- Mientras 117/118 no se apliquen, rige la caída: copiloto con la reserva original (día UTC) usando el tope del
  equipo de la configuración; análisis profundo con la reserva original y el periodo Bogotá de la configuración. Sin
  cupo por persona hasta aplicar.
- La caché de 60 s hace que un cambio aprobado tarde hasta ~1 min en regir en cada instancia.
- El modelo del entorno (`AGT003_COPILOT_MODEL`) en producción: por confirmar que sea `sonnet`.

## PENDIENTES / SIGUIENTE_PASO

Revisión del dueño, aplicación de 117–119 por el dueño, fusión de #341 y rebase de esta rama a `main`.
