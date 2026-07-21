# Verificación Gate 0 — Vig-IA Comercial AGT-003

**Fecha:** 2026-07-18
**Rama:** `feat/vig-ia-commercial-gate0`
**Contrato:** `docs/decisions/2026-07-18-vig-ia-comercial-gate.md`
**Estado:** QA local y smoke autenticado de preview superados; producción pendiente de autorización explícita.

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

## 4. Smoke autenticado por roles

Se aprovisionaron identidades QA temporales y reversibles contra Supabase para validar el backend real desplegado en Preview:

1. Gerencia con módulos Vig-IA, Dashboard y Oportunidades.
2. Gerencia sin módulo Vig-IA.
3. Director con módulo Vig-IA pero sin área comercial vigente.
4. Comercial sin módulo Vig-IA.

Resultados:

| Caso | Resultado |
|---|---:|
| Gerencia → `GET /api/vigia/priorities` | 200 |
| Fuente declarada | CRM-F1 |
| Política read-only | `true` |
| Revisión humana obligatoria | `true` |
| Gerencia sin Licitaciones → `/api/tenders` | 403 |
| Gerencia sin módulo Vig-IA → `/api/vigia/priorities` | 403 |
| Director con Vig-IA pero sin área comercial → `/api/vigia/priorities` | 403 |
| Comercial sin Vig-IA → `/api/vigia/priorities` | 403 |
| Campos sensibles prohibidos presentes | 0 |
| Perfiles QA residuales tras cleanup | 0 |

El smoke real del Preview devolvió 219 oportunidades activas visibles y 219 priorizadas bajo `gate0-v1.0`. No se alteró ninguna oportunidad, meta, licitación ni dataset SIIO; las identidades, perfiles y permisos QA se eliminaron al finalizar.

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
- Preview final Vercel: `https://seguridad-nacional-qbsozav76-jmb-maxs-projects.vercel.app/#/centinel`.
- Estado de deployment: `Ready`, target `preview` (`dpl_94bwZVGBXJs72g34ZGVswSFRgzyn`).
- Commit desplegado: `5e0a47ff448e2654769f106212accda05035129b`.
- PR: `https://github.com/Premium-Security-Investments/sn-crm-comercial/pull/18` (`OPEN`, mergeable).
- La URL pública directa está protegida por Vercel; `vercel curl` autenticado confirmó documento raíz HTTP 200 y contenedor React.
- API Vig-IA sin sesión: HTTP 401 con `Debe iniciar sesión.`, correcto.
- `POST /api/vigia/priorities`: HTTP 405 con `Método no permitido.`, correcto.

## 7. Revisión final y gate operativo

- Revisión independiente final: **GO para preview**, sin bloqueadores de código nuevos.
- Higiene Markdown: `git diff --check main...HEAD` quedó limpio después de normalizar espacios finales.
- La credencial vigente se recuperó mediante acceso administrativo autorizado a Supabase y `SUPABASE_SERVICE_ROLE_KEY` se actualizó únicamente en Vercel Preview; no se modificó Producción.
- El smoke autenticado contra el deployment final pasó para permiso positivo, rol sin módulo, director sin área, separación de Licitaciones, minimización y cleanup.
- Los archivos temporales con variables y credenciales se eliminaron después de registrar la evidencia.

## 8. Pendientes de producción

- Revisar el resultado del PR #18 y confirmar merge/release.
- Autorizar explícitamente la actualización de la credencial en Producción y el despliegue productivo.
- Ejecutar smoke final post-deploy y conservar rollback si aparece una regresión.
