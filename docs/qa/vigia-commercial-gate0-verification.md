# Verificación Gate 0 — Vig-IA Comercial AGT-003

**Fecha:** 2026-07-18  
**Rama:** `feat/vig-ia-commercial-gate0`  
**Contrato:** `docs/decisions/2026-07-18-vig-ia-comercial-gate.md`  
**Estado:** QA local y preview superados; despliegue productivo y smoke final pendientes.

## 1. Alcance verificado

- Motor determinístico y versionado `gate0-v1.0`.
- Fuente única `CRM-F1` / `v_psi_sales_opportunity_enriched`.
- Endpoint dedicado `GET /api/vigia/priorities`.
- Validación de módulo antes de leer el CRM.
- Allowlist explícito de columnas.
- Scoping por rol/owner/área mediante las funciones compartidas de autorización.
- Separación funcional de Licitaciones.
- Frontend gerencial con score, nivel, señales, evidencia, fuente, corte y recomendación.
- Deep links al Dashboard y oportunidad.
- Feedback local sin persistencia.
- Sin migraciones ni escrituras automáticas del agente.

## 2. Datos reales observados

Consulta agregada de solo lectura sobre el CRM productivo:

| Métrica | Resultado |
|---|---:|
| Filas fuente | 323 |
| Activas visibles | 219 |
| Priorizadas | 219 |
| Prioridad alta | 182 |
| Prioridad media | 24 |
| Prioridad baja | 13 |
| Score máximo | 110 |
| Score mínimo priorizado | 10 |

Señales más frecuentes:

| Señal | Conteo |
|---|---:|
| Estancamiento crítico | 177 |
| Sin próxima acción | 155 |
| Valor no registrado | 138 |
| Cierre esperado vencido | 103 |
| Gestión vencida | 35 |
| Estancamiento preventivo | 15 |
| Alto valor | 9 |
| Etapa crítica | 8 |
| Regional pendiente | 5 |
| Cierre cercano | 3 |

Interpretación: el alto número de prioridades no es un fallo de cálculo; expone el rezago y la calidad actual del CRM conforme al contrato aprobado. Vig-IA no oculta ese backlog ni inventa frescura.

## 3. TDD y suite completa

Ciclo RED observado:

- motor ausente;
- endpoint ausente;
- UI ausente;
- exclusión de oportunidades sin señales inicialmente fallida.

Después de la implementación, los tres contratos Vig-IA y la regresión completa pasaron:

```text
node tests/vigia-engine.test.mjs
node tests/vigia-endpoint-static.test.mjs
node tests/vigia-ui-static.test.mjs
for f in tests/*.test.mjs; do node "$f"; done
npm run check:siio-integration
npm run build
```

Resultado real:

- 78 archivos `*.test.mjs`: PASS.
- Incluye integración HTTP autenticada con Supabase simulado para 401/403, role ceiling, director sin alcance, scoping por owner, minimización, método 405 y paginación de 1.001 filas.
- Checker SIIO: PASS.
- TypeScript y Vite build: PASS.
- `npm audit`: 0 vulnerabilidades después de actualizar `adm-zip` a 0.6.0.
- Smoke ZIP de lectura/extracción: PASS.
- Advertencia no bloqueante preexistente: chunk principal mayor a 500 kB.

## 4. Smoke autenticado local por roles

Se aprovisionaron dos identidades QA temporales y reversibles contra Supabase:

1. Gerencia con módulos Vig-IA, Dashboard y Oportunidades.
2. Comercial sin módulo Vig-IA.

Resultados:

| Caso | Resultado |
|---|---:|
| Gerencia → `GET /api/vigia/priorities` | 200 |
| Fuente declarada | CRM-F1 |
| Política read-only | `true` |
| Revisión humana obligatoria | `true` |
| Gerencia sin Licitaciones → `/api/tenders` | 403 |
| Comercial sin Vig-IA → `/api/vigia/priorities` | 403 |
| Campos sensibles prohibidos presentes | 0 |
| Perfiles QA residuales tras cleanup | 0 |

No se alteró ninguna oportunidad, meta, licitación ni dataset SIIO durante este smoke.

## 5. Hallazgos de revisión independiente corregidos

La primera revisión independiente bloqueó el despliegue y la segunda detectó tres regresiones remanentes. Antes de continuar se corrigieron todos sus hallazgos:

1. El módulo y el alcance se resuelven antes de leer oportunidades; director sin área comercial recibe 403 y cero lecturas CRM.
2. La consulta de director se restringe en base de datos mediante `owner_id`; no se descarga el CRM completo para filtrar después.
3. Los CTA a Dashboard y Oportunidades sólo aparecen si el perfil posee el módulo destino.
4. El snapshot pagina todas las filas y ya no se trunca silenciosamente en 1.000.
5. Los parámetros desconocidos o manipulados del deep link fallan a un alcance vacío explicado en pantalla.
6. Las fechas malformadas quedan como evidencia explícita de calidad de datos con cero puntos: no crean ni escalan prioridades.

Además, los métodos distintos de GET reciben HTTP 405 sin lectura del CRM; un rol elegible sin `modulo_vig_ia` recibe 403 antes del CRM; y una prioridad sin servicio abre el Dashboard con todos los servicios, sin aplicar un default ajeno.

## 6. Evidencia visual local y preview

- Build de producción local servido en `http://127.0.0.1:4173`.
- Ruta `#/centinel` conserva login protegido antes de sesión.
- El frontend compiló con la nueva consola Vig-IA y sus estilos responsive.
- Preview final Vercel: `https://seguridad-nacional-33efnet3m-jmb-maxs-projects.vercel.app/#/centinel`.
- Estado de deployment: `Ready`, target `preview` (`dpl_Hv4h7eebopxbhBsxbfz5W7gdhTsg`).
- Commit desplegado: `41f62e8b9556e46a0406d2c27c3ba9f8b4c35639`.
- PR: `https://github.com/Premium-Security-Investments/sn-crm-comercial/pull/18` (`OPEN`, mergeable).
- La URL pública directa está protegida por Vercel; `vercel curl` autenticado confirmó documento raíz HTTP 200 y contenedor React.
- API Vig-IA sin sesión: HTTP 401 con `Debe iniciar sesión.`, correcto.
- `POST /api/vigia/priorities`: HTTP 405 con `Método no permitido.`, correcto.

## 7. Pendientes de cierre

- Confirmar el resultado de la revisión independiente final.
- Repetir smoke autenticado por roles en el preview con credenciales Supabase vigentes.
- Autorizar, desplegar y ejecutar smoke final en producción.
