# Verificación local — Vig-IA, copiloto comercial de oportunidad

**Fecha UTC de evidencia:** 2026-07-28T22:47:55Z  
**Rama:** `feat/vigia-phase1-opportunity-copilot`  
**Checkpoint previo al bloque final:** `59900f6`

> Este documento preserva la evidencia local previa al rollout. El estado productivo posterior está registrado en [`vigia-phase1-rollout-2026-07-28.md`](./vigia-phase1-rollout-2026-07-28.md).

## Alcance verificado

Slice local y sintético:

1. oportunidad CRM autorizada;
2. contexto mínimo, saneado y marcado como no confiable;
3. brief, objetivo, estrategia y borrador estructurado;
4. edición local en navegador;
5. feedback humano append-only;
6. sin envío, destinatarios, tools, navegación, escritura CRM ni cambio de etapa.

No se usaron datos reales, proveedor real, secretos, Microsoft 365, Supabase productivo, migraciones productivas ni despliegue.

## Contratos

| Schema | SHA-256 |
|---|---|
| `opportunity-copilot.request.schema.json` | `cb1019f67c153a09860ed6b814ca30e24b6a38aeb95184f8939357a612200f33` |
| `opportunity-copilot.response.schema.json` | `639ed9ae70b6104790d31e7d6af4f529e626390d529344c632c083420d114680` |

`AGT-003/v1` permanece intacto. La capacidad nueva vive exclusivamente en `AGT-003/v2-draft` como `agt003.opportunity-copilot.preview`.

## Controles demostrados

- autenticación antes de consultar oportunidad;
- autorización `ai.commercial_draft.run` con `modulo_vig_ia`, `modulo_oportunidades` y scope CRM;
- perfil agente, perfil inactivo, módulos parciales y oportunidad ajena fallan cerrado;
- máximo 20 interacciones y 20.000 caracteres agregados;
- correo, teléfono, bearer token, API key y URL firmada son redactados;
- observaciones e interacciones llevan marca explícita de texto CRM no confiable;
- policy prohíbe herramientas, envíos, escritura CRM y activos inventados;
- catálogo aprobado vacío fuerza cero recomendaciones de activos;
- respuesta con `send_now`, evidencia desconocida, activo inventado o `human_review_required=false` es rechazada;
- claim persistente precede al proveedor;
- idempotencia, cuota, concurrencia y lease se validan en PGlite;
- runs y feedback son append-only y consultables sólo por RPC backend restringido;
- respuestas tardías se descartan al cambiar oportunidad o regenerar;
- editor local no muta el run original;
- UI no contiene envío, selección de destinatario ni mutación de etapa;
- ambos entrypoints backend permanecen paritarios.

## Comandos de verificación

```bash
node tests/agt003-copilot-prompt-injection.test.mjs
node tests/agt003-copilot-end-to-end.integration.test.mjs
node tests/vigia-opportunity-copilot-state.test.mjs
node tests/vigia-opportunity-copilot-ui-static.test.mjs
node tests/agt003-copilot-pglite.integration.test.mjs
npm run check:backend-parity
npm run build
```

La verificación final también ejecuta todos los archivos `tests/*.test.mjs`, los checks SIIO, `git diff --check` y build TypeScript/Vite. El warning de chunk Vite mayor a 500 kB es preexistente/no bloqueante; no altera los controles del copiloto.

## Configuración segura

El repositorio usa `.env.local.example` como plantilla canónica. `AGT003_COPILOT_ENGINE=disabled` permanece por defecto. URL del bridge, secreto HMAC, protocolo wire y modelo son variables exclusivamente server-side; nunca se exponen con prefijo `VITE_` ni se registran en logs. Un bridge AGT-003 dedicado usa `AGT003_COPILOT_WIRE_PROTOCOL=agt003`; la reutilización temporal del transporte gobernado AGT-002 exige `agt002` explícito.

## Gates pendientes de rollout

Requieren autorización humana separada:

1. aprobar activos comerciales reales;
2. aprobar proveedor, modelo, costos y secretos;
3. desplegar Plataforma Agentes;
4. aplicar migración `043_agt003_copilot_runs.sql`;
5. configurar bridge HTTPS firmado;
6. desplegar SIIO;
7. conceder `modulo_vig_ia` únicamente a pilotos;
8. ejecutar canary con datos reales y revisión humana.

`CT-02B` continúa en `NO_GO`. No existe aprobación para enviar correos ni para escribir en CRM.
