# Registro de rollout productivo — Vig-IA, copiloto comercial de oportunidad

**Corte UTC:** 2026-07-28T23:40:20Z  
**Aplicación:** `seguridad-nacional-crm`  
**URL canónica:** https://seguridad-nacional-crm.vercel.app  
**Estado del rollout:** desplegado; validación funcional autenticada pendiente por parte de Juan.

## Trazabilidad GitHub

| Bloque | PR | Merge commit | Estado |
|---|---:|---|---|
| Fase 1 — copiloto gobernado | [#38](https://github.com/Premium-Security-Investments/sn-crm-comercial/pull/38) | `d23170e` | fusionado |
| Gate exclusivo de piloto | [#39](https://github.com/Premium-Security-Investments/sn-crm-comercial/pull/39) | `4d8b8a0` | fusionado |

El árbol del hotfix verificado localmente coincidió exactamente con el árbol de `origin/main` después del merge.

## Base de datos productiva

### Migración 043

Aplicada: `supabase/migrations/043_agt003_copilot_runs.sql`.

Verificación posterior:

- tablas de runs, claims y feedback presentes;
- RLS y triggers append-only presentes;
- RPC backend restringida a `service_role`;
- sin grants de ejecución o tablas para `anon` o `authenticated`;
- prerrequisitos `psi_sales_profiles` y `psi_sales_opportunities` presentes;
- sin estado parcial previo al apply.

### Migración 044

Aplicada: `supabase/migrations/044_agt003_copilot_pilot_permission.sql`.

Verificación posterior:

```text
catalog_exists=true
catalog_active=true
holder_count=1
holder_emails=[juanbotero@premiumsecurity.ai]
```

El permiso `vigia_copilot_pilot` se exige en backend y UI, además de `modulo_vig_ia` y `modulo_oportunidades`. Los módulos históricos de otros usuarios no fueron revocados ni modificados.

Rollback específico disponible:

```text
supabase/rollbacks/044_agt003_copilot_pilot_permission_rollback.sql
```

## Runtime y despliegue

Configuración productiva del canary:

```text
AGT003_COPILOT_ENGINE=agt003_bridge_preview
AGT003_COPILOT_WIRE_PROTOCOL=agt002
AGT003_COPILOT_POLICY_VERSION=agt003-opportunity-copilot-v1
AGT003_COPILOT_TIMEOUT_MS=30000
AGT003_COPILOT_MAX_CONCURRENT=1
AGT003_COPILOT_DAILY_MAX_RUNS=5
```

URL, modelo y HMAC permanecen como variables exclusivamente server-side protegidas. El runtime reutiliza explícitamente el transporte gobernado AGT-002 sin extraer ni duplicar secretos.

Último deployment observado como `Ready`:

```text
https://seguridad-nacional-jcx54lo8a-psi-llc-projects.vercel.app
```

El alias productivo quedó en `https://seguridad-nacional-crm.vercel.app`.

## Verificación mecánica

```text
ALL_TEST_FILES_PASSED=227
npm run build: exit 0
backend parity: OK
SIIO integration: OK
SIIO executive snapshot: OK
SIIO governed agent catalog: OK
navigation permissions: OK
git diff --check: limpio
```

También se verificó:

- bundle productivo con gate `vigia_copilot_pilot`;
- home productivo HTTP 200;
- endpoint de generación sin sesión rechazado;
- identidad piloto PSI única, activa, humana y con alcance comercial;
- bridge compartido accesible por HTTPS;
- ausencia de envío, tools, navegación autónoma, escritura CRM o cambio de etapa.

## Pendiente humano

Juan debe validar con la sesión Microsoft de `juanbotero@premiumsecurity.ai`:

1. abrir una oportunidad que no sea `licitacion_publica`;
2. confirmar que aparece el panel Vig-IA;
3. ejecutar **Generar borrador**;
4. revisar recomendación, evidencias y borrador;
5. confirmar que no existe acción de envío ni mutación CRM.

Esta validación puede crear un run gobernado real y consumir una ejecución del límite diario. No se ejecutó de forma automatizada porque no se dispone de la sesión autenticada de Juan.

## Contención y rollback operativo

Ante cualquier comportamiento inesperado:

1. fijar `AGT003_COPILOT_ENGINE=disabled` en producción;
2. redeploy de Vercel;
3. conservar 043 y sus datos append-only para auditoría;
4. si se requiere retirar el piloto, aplicar el rollback 044;
5. no activar correo, Microsoft 365, tools ni mutaciones CRM.

`CT-02B` permanece en `NO_GO`. La aprobación humana sigue siendo obligatoria y el sistema no envía correos.
