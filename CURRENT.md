# CURRENT — SIIO Comercial / Licitaciones / Vig‑IA

**Corte autoritativo:** 2026-08-06 11:52 COT · 2026-08-06 16:52 UTC
**Producción:** https://seguridad-nacional-crm.vercel.app
**Commit productivo:** `19987140def78d140cbca197b84f32467b6721e2`
**Deployment Vercel:** `dpl_5jV5B4PGR9ZGHHZkM2gmJYr6kRz5` · `READY`

## 1. Regla funcional y de autoridad vigente

El encargado de Licitaciones selecciona manualmente un caso del Radar y lo convierte en **Oportunidad**. La existencia de una oportunidad, un análisis completado o una recomendación condicionada no equivale a GO ni autoriza preparar o presentar una oferta.

Vig‑IA/AGT‑002 puede analizar, organizar evidencia, señalar brechas y proponer acciones. Nunca puede:

- convertir procesos del Radar en oportunidades;
- decidir GO/NO‑GO;
- aprobar requisitos, evidencias o propuestas de aprendizaje;
- asignar silenciosamente compromisos humanos;
- firmar, enviar o presentar ofertas.

Toda decisión humana debe ser trazable y asociarse al análisis vigente. El orden operativo es: **alertas de descarte → habilitantes → técnico → financiero/ejecución → estratégico**. Sin evidencia permitida, Vig‑IA debe abstenerse.

## 2. Estado confirmado por frente

| Frente | Estado confirmado | Gate pendiente |
|---|---|---|
| **E1–E3** | Pipeline durable, canonicidad y contexto v2 previamente verificados en producción | Mantener idempotencia, leases y cero fallback silencioso |
| **E4** | La recuperación/evidence packet fue utilizada por la ruta que produjo el canary E5 vigente | No inferir cobertura completa de SharePoint ni aplicabilidad empresarial por presencia documental |
| **E5** | **Canary canónico completado y verificado** con corpus jurídico `legal-corpus-v1.1` | La revisión jurídica y el GO/NO‑GO siguen siendo humanos |
| **E6** | Scheduler, endpoint, bridge, persistencia y autoridad probados técnicamente; secreto reparado y límites explícitos | Primer mensaje humano real en Mesa Vig‑IA y un único canary productivo |
| **F2 SIIO** | Código, migración de seguridad y deployment productivo completados | QA visual autenticado operado por Juan |
| **Identidad Vig‑IA** | **Desplegada y aprobada visualmente**: Vig‑IA Gerencial, Vig‑IA Licitaciones y Vig‑IA Comercial | Ninguno para identidad; no reemplaza el QA F2 restante |

El rollout visual de identidad está cerrado. No se declara rollout visual completo de F2 ni activación continua de E6 mientras esos gates permanezcan abiertos.

## 3. F2 — coherencia y seguridad transversal de SIIO

### Entregado

- PR **#77**: implementación F2.
- PR **#78**: corrección de colisión de migración.
- Migración definitiva: `062_siio_f2_security_coherence.sql`.
- Commit posterior del lote E6/documentación: `2904efba2be9db9fc4622bd1f45d77b609398c4d`.
- Deployment productivo: `READY`; alias canónico responde HTTP 200.

### Controles verificados

- Director permanece fuera del acceso operativo de SIIO.
- Junta consume informes en estado `presentado`; no opera el expediente.
- Nómina `restringido` no se expone por defecto.
- SIIO falla explícitamente si falta su fundación/configuración requerida.
- Privilegios directos inseguros post‑migración: `0`.
- Escrituras prohibidas post‑migración: `0`.
- Conteos de filas antes/después: idénticos; `data_preserved=true`.
- `service_role` conserva únicamente los accesos mínimos requeridos.

### Identidad visible desplegada

- PR **#81** fusionado en `main`: `19987140def78d140cbca197b84f32467b6721e2`.
- Deployment productivo: `dpl_5jV5B4PGR9ZGHHZkM2gmJYr6kRz5` · `READY`.
- Alias canónico verificado con HTTP 200 y asset `index-FSatnFHf.js`.
- QA visual autenticado aprobado por Juan sobre el catálogo institucional gobernado.
- Identidades visibles: **Vig‑IA Gerencial**, **Vig‑IA Licitaciones** y **Vig‑IA Comercial**.
- `AGT-001/002/003` permanecen como IDs internos; **Agente Comercial PSI** permanece como router y Agente IT no entra al catálogo SIIO.
- No hubo migraciones, cambios de DB, productores, permisos ni automatización de decisiones.

### Gate abierto

Falta QA visual autenticado. Juan opera la UI; Hermes da **un solo paso** y espera captura. No se declara cierre visual sin esa evidencia.

## 4. E5 — corpus jurídico y run canónico vigente

Run productivo verificado:

```text
analysis_run_id=50f798f0-a526-421f-bd26-7b0e5dd0d5da
corpus_version=legal-corpus-v1.1
corpus_id=fc392e00-0363-4307-b2c4-80835ac474ca
recommendation=advance_conditionally
critical_open_count=3
human_review_required=true
```

Gates aprobados:

- metadata canónica correcta;
- snapshot del run era el más reciente para la oportunidad;
- binding exacto al corpus publicado;
- evento terminal `completed` presente;
- cero claims activos;
- obligaciones jurídicas sólo citan la allowlist verificada;
- hechos documentales no se renombraron como derecho;
- cinco fuentes inciertas quedaron en revisión humana y cubiertas por abstención;
- texto de abstención canónico: `No verificado jurídicamente; requiere revisión humana`;
- no existe campo decisorio, firma, aprobación, envío o presentación autónoma.

E5 está técnicamente cerrado. Su recomendación condicionada no reemplaza la decisión humana.

## 5. E6 — continuidad hacia la Mesa Vig‑IA

E6 lleva el expediente, snapshot, análisis, evidencia, preguntas y versiones a una conversación durable después del gate humano. El worker procesa como máximo un job por invocación y persiste mensajes/eventos de forma append‑only.

### Root cause y reparación

El scheduler recibía `403 No autorizado` cuando el drain estaba activo. Se confirmó desajuste del secreto dedicado entre el host y Vercel. Con el drain apagado, la misma ruta devuelve `404 No disponible`, que es el comportamiento fail‑closed esperado.

Se completó:

- timer detenido y deshabilitado durante la reparación;
- secreto dedicado rotado coordinadamente, sin exponer su valor;
- artefactos systemd instalados byte‑idénticos a Git;
- archivo de entorno del host con modo `0640`;
- límites productivos explícitos:
  - `MAX_CONCURRENT=1`;
  - `DAILY_MAX_JOBS=1`;
  - `TIMEOUT_MS=45000`;
  - `SWEEP_MAX=5`;
- `AGT002_WORKBENCH_DRAIN_ENABLED=false`;
- deployment productivo posterior a la rotación: `READY`;
- probe autenticado con drain apagado: HTTP 404, sin fuga del secreto.

PR **#79** añadió la prueba `secreto esperado ausente → 403, cero DB/RPC y cero bridge`. Revisión independiente: cero Critical/Important.

### Estado de cola al corte

```text
total_jobs=0
queued=0
active_claims=0
claimed_today=0
```

No se fabricó una decisión humana, un GO ni un mensaje productivo para aparentar éxito.

### Evidencia mecánica

Pasaron secuencialmente:

- worker route;
- endpoint estático;
- scheduler ops;
- runtime;
- worker, persistence y responder;
- paridad Express/Vercel;
- build;
- lifecycle E6 en PGlite;
- autoridad humana estática y dinámica.

El bridge está activo, pero su salud no sustituye la prueba del Workbench: son componentes y secretos separados.

## 6. Próximos pasos autorizables

### Paso 1 — QA visual F2

**Responsable:** Juan opera; Hermes guía y verifica.
**Acción:** abrir producción, iniciar sesión normalmente y enviar una captura de la pantalla inicial.
**Criterio de cierre:** recorrido autenticado confirma acceso por rol, Junta `presentado`, ausencia de nómina restringida y errores explícitos esperados.
**Límite:** un paso por captura; no declarar rollout por HTTP 200 o deployment `READY`.

### Paso 2 — preparar un único canary humano E6

**Precondición:** F2 visual sin bloqueantes críticos y una oportunidad real ya convertida, con gate humano válido.
**Responsable:** Juan escribe un único mensaje real en la Mesa Vig‑IA; Hermes no lo suplanta.
**Estado previo obligatorio:** timer deshabilitado, drain apagado, cola sin claims y límites `1/1`.

### Paso 3 — ejecutar el canary técnico E6

**Responsable:** Hermes, después del mensaje humano.
**Secuencia:**

1. inventario read‑only de cola y snapshot;
2. habilitar el drain sólo para la ventana controlada;
3. ejecutar una única invocación manual del servicio, sin timer;
4. verificar `queued → claimed → completed` o fallo terminal explícito;
5. comprobar mensaje, eventos, acciones requeridas, versiones y linaje;
6. comprobar que no existe decisión, aprobación, firma, envío o presentación de IA;
7. volver a `drain=false` al terminar el canary.

**Criterio de cierre:** exactamente un job procesado, una persistencia terminal válida, cero duplicados, cero claims activos y autoridad humana intacta.

### Paso 4 — decisión humana sobre operación continua

Sólo después del canary, Juan decide si se habilita el timer. Si se autoriza:

- conservar concurrencia `1` y cuota diaria inicial `1`;
- activar el timer;
- verificar un ciclo vacío posterior;
- mantener kill switch y rollback operativo por flags;
- no ejecutar rollback SQL 045/046/048 con datos dependientes.

### Paso 5 — siguiente evolución de producto, separada del cierre operativo

Después de cerrar F2 visual y E6 humano, diseñar la siguiente versión del análisis integral:

- matriz por requisito del pliego;
- evidencia empresarial tipada y aplicabilidad por caso;
- bloqueadores con acción, responsable sugerido, hito y condición de cierre;
- cobertura/omisiones explícitas de SharePoint;
- compatibilidad con runs históricos;
- UI compacta sin KPI duplicado ni panel jurídico desconectado.

Ese trabajo requiere diseño y aprobación humana antes de código. No debe mezclarse con el canary E6.

## 7. Estado operativo seguro al corte

- Producción desplegada y disponible.
- F2 técnicamente aplicado; QA visual pendiente.
- E5 canónico completado; decisión humana pendiente según cada caso.
- E6 desplegado pero **drain apagado y timer deshabilitado**.
- Cero jobs, cero claims y cero procesamiento masivo.
- No existe autorización para que Vig‑IA convierta, decida, firme, envíe o presente.
