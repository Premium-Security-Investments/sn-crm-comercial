# Verificación local — Alineación SIIO / AGT-002 MVP

- **Resultado:** PASS local
- **Fecha UTC:** 2026-07-24T16:46:33Z
- **Brief:** `/root/.hermes/projects/portfolio-orchestration/SIIO-AGT002-MVP-ALIGNMENT-BRIEF-2026-07-24.md`
- **Base verificada:** `478a0dfc769ada1cee9298d332213757593add49`
- **Commit funcional:** `a41712d4c6e608c7ecd36c9383e73751a4a4bd1e`
- **Rama:** `feat/tender-decision-assistant`
- **Modalidad:** local; sin push, PR, merge, deployment, migración remota, datos reales con IA, secretos, costos, reinicio de gateway ni activación de Hermes/AGT-002

## 1. Regla funcional verificada

AGT-002 conserva una recomendación separada de la decisión humana y no autoriza, sustituye ni bloquea GO/NO GO.

Una identidad humana activa con `LICITACIONES_GO_NO_GO_APPROVE` puede registrar GO o NO GO:

- con recomendación contraria;
- con preguntas críticas abiertas;
- con análisis obsoleto;
- con análisis fallido;
- sin análisis;
- sin comentario humano.

Esas condiciones se presentan como advertencias. Cuando se entrega `analysis_run_id`, RPC/base de datos verifican que el run pertenezca a la oportunidad y licitación. La recomendación original del run no se modifica.

## 2. Delta implementado

- Especificación alineada con autoridad humana absoluta y comentario opcional.
- Migración local `025_tender_analysis_foundation.sql`: `analysis_run_id` nullable, comentario opcional, sin gates por estado/vigencia/preguntas; conserva permisos humanos, ámbito, auditoría y supersesión.
- Servicio/RPC: acepta decisión sin análisis o comentario; preserva preparación de oferta e idempotencia; delega la validación de ámbito al RPC persistente.
- Lectura de análisis: expone run fallido vigente o último run obsoleto para advertir sin bloquear.
- Tipos/API: inputs nullable/opcionales.
- Panel: GO y NO GO disponibles para personas autorizadas; muestra advertencias y etiquetas canónicas.
- Etiquetas: `GO recomendado`, `GO condicionado`, `NO GO recomendado`, `Información insuficiente`, incluyendo variantes históricas con guiones bajos.
- Pruebas: cobertura de recomendación contraria/inmutable, preguntas críticas, análisis fallido/obsoleto/ausente, comentario opcional, ámbito, identidad técnica/no autorizada y etiquetas.

## 3. Pruebas focales

Todos terminaron con código `0`:

```text
PASS node tests/tender-analysis-foundation-migration.test.mjs
PASS node tests/tender-analysis-foundation-pglite.integration.test.mjs
PASS node tests/tender-analysis-rules-registration.test.mjs
PASS node tests/agt002-tender-analysis-contract.test.mjs
PASS node tests/hermes-interim-tender-analysis.test.mjs
PASS node tests/tender-analysis-go-gate-pglite.integration.test.mjs
PASS node tests/tender-go-no-go-api.test.mjs
PASS node tests/tender-go-no-go-ui.test.mjs
PASS node tests/tender-decision-brief-ui.test.mjs
PASS node tests/tender-configuration-permissions.test.mjs
```

## 4. Verificación integral

| Comando | Resultado |
|---|---:|
| `for f in tests/*.test.mjs; do node "$f"; done` | PASS — 111/111 |
| `npx tsc --noEmit` | PASS |
| `npm run check:backend-parity` | PASS — `backend parity OK` |
| `npm run check:siio-agents` | PASS — `SIIO governed agent catalog OK` |
| `npm run build` | PASS |
| `git diff --check` | PASS — sin salida |

El build conserva el warning no bloqueante conocido de un chunk minificado mayor de 500 kB.

## 5. Única revisión del lote

Se realizó una sola revisión independiente read-only. Hallazgo medio:

- el normalizador no cubría `avanzar_condicionado`, `no_avanzar` y `no_avanzar_temporalmente`.

Corrección:

- se agregaron primero expectativas focales;
- la prueba reprodujo el fallo;
- se añadieron las variantes al mapper;
- `tests/tender-go-no-go-ui.test.mjs` pasó;
- después se repitió la verificación integral y quedó 111/111 PASS.

No se ejecutó una segunda revisión.

## 6. Componentes preservados

- snapshots y hashes;
- runs tipados y productor real;
- auditoría, supersesión e historial;
- idempotencia;
- permisos humanos y prohibición para identidades técnicas;
- preparación de oferta tras GO;
- AGT-002 v1 y contratos existentes sin cambios (`git diff 478a0df..HEAD -- contracts/agents/AGT-002/v1` sin salida);
- `HERMES-INTERIM` apagado y sin activación.

## 7. Riesgos y límites residuales

- No existe evidencia de CI, staging o producción; este PASS es exclusivamente local.
- La migración 025 no se aplicó remotamente.
- Un run suministrado conserva alcance estricto, pero su estado, vigencia y recomendación son advertencias, por diseño aprobado.
- El warning de tamaño de chunk Vite permanece sin cambios y no pertenece a este paquete.
- Conversación, borradores, descarga adicional, SharePoint y activación real siguen fuera de alcance.

## 8. Verificación funcional de `#psi-general`

La revisión de requisitos posterior al cierre confirmó el comportamiento del gate y detectó un único faltante documental: la especificación no enumeraba el alcance aprobado de preparación asistida posterior al GO. Se corrigió la especificación, sin cambiar código, para incluir:

- matriz de cumplimiento, checklist, índice y cronograma;
- resumen ejecutivo y propuesta técnica base;
- carta de presentación, matriz de riesgos, preguntas de aclaración y solicitudes internas;
- borradores siempre versionados y sujetos a revisión humana;
- almacenamiento privado SIIO/Supabase durante el MVP;
- exclusión de propuesta económica, firmas, declaraciones jurídicas definitivas, comunicaciones automáticas y presentación en SECOP;
- SharePoint pospuesto a una acción humana confirmada posterior.

Después de esa corrección documental, a las `2026-07-24T16:54:26Z`, se repitieron los gates completos:

| Comando | Resultado fresco |
|---|---:|
| `tests/*.test.mjs` | PASS — 111/111 |
| `npx tsc --noEmit` | PASS |
| `npm run check:backend-parity` | PASS |
| `npm run check:siio-agents` | PASS |
| `npm run build` | PASS |
| `git diff --check` | PASS |

No se abrió una segunda revisión independiente; fue una comprobación mecánica contra el brief canónico y una corrección documental acotada.

## 9. Punto de reanudación

El paquete obtiene PASS funcional local después de la verificación de `#psi-general`. No abrir PR, hacer push, merge, deployment, migración remota ni iniciar el siguiente paquete sin autorización explícita de Juan.
