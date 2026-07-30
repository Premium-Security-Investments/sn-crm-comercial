# Diseño — Programa de mejora del análisis de Vig‑IA desde la conversión

**Fecha:** 2026-07-29

**Estado:** Diseño aprobado; pendiente de plan técnico ejecutable

**Producto anfitrión:** SIIO — Licitaciones / Oportunidades

**Identidad visible:** Vig‑IA · Copiloto de Licitaciones

**Identificador interno:** `AGT-002`

## 1. Decisión funcional

Desde el momento en que una licitación se convierte en oportunidad, Vig‑IA se convierte en el motor canónico de análisis y acompañamiento.

El flujo objetivo es:

```text
Radar de licitaciones
→ conversión humana en oportunidad
→ activación inmediata de Vig‑IA
→ preparación del expediente
→ análisis preliminar con evidencia
→ preguntas y validaciones humanas
→ decisión humana GO / NO GO
→ continuidad de Vig‑IA en la Mesa de trabajo cuando exista GO
```

El GO no autoriza el primer análisis. Es una decisión humana posterior, informada por el trabajo de Vig‑IA.

Las reglas determinísticas permanecen para descubrimiento, ingestión, integridad, extracción objetiva, cálculos reproducibles, seguridad, idempotencia, versiones y trazabilidad. Después de la conversión no pueden producir, reemplazar ni sobrescribir el análisis canónico.

## 2. Relación con diseños existentes

Este diseño extiende el dominio de Vig‑IA desde la conversión hasta la decisión GO / NO GO y conecta ese contexto con la Mesa de trabajo post‑GO definida en:

- `docs/superpowers/specs/2026-07-28-agt002-dossier-workbench-design.md`;
- `docs/superpowers/specs/2026-07-27-siio-public-tender-durable-workflow-design.md`.

No crea un segundo agente ni un segundo expediente. La oportunidad, el snapshot documental, los análisis versionados y la Mesa de trabajo pertenecen al mismo caso y conservan trazabilidad continua.

El diseño post‑GO mantiene su autoridad documental y sus controles. Este programa corrige el supuesto temporal: Vig‑IA ya debe estar activo antes del GO.

## 3. Hallazgos confirmados de la auditoría

### 3.1 Procesamiento operativo

En el caso auditado de Manizales:

- la conversión creó el job automáticamente;
- el job nació autorizado por la custodia de conversión;
- se detectaron 14 documentos;
- 5 se importaron;
- 9 ya existían o no tenían cambios;
- 0 fallaron;
- se creó el snapshot;
- el análisis de Vig‑IA se persistió;
- el procesamiento total tomó aproximadamente 29 minutos.

El worker procesa una unidad por invocación y conserva un lease de 90 segundos después de una fase exitosa. Con un scheduler por minuto, el siguiente ciclo suele encontrar el lease activo y no avanza.

### 3.2 Experiencia de usuario

- La UI no muestra progreso documental suficiente.
- Al terminar el backend, la UI no recarga automáticamente documentos y análisis persistidos.
- La oportunidad puede seguir mostrando “Análisis pendiente” hasta refrescar la página.
- Existen dos acciones ambiguas: una de Vig‑IA y otra de análisis determinístico.

### 3.3 Canonicalidad del análisis

El flujo actual construye primero un análisis por reglas con recomendación, riesgo, encaje, bloqueadores y siguiente acción. Después entrega ese resultado a Vig‑IA como `deep_analysis`.

Esto introduce sesgo de anclaje y produce un flujo híbrido:

```text
evidencia parcial
→ conclusión determinística
→ Vig‑IA
```

Además, si Vig‑IA no está disponible, el sistema puede presentar el resultado por reglas como fallback de análisis.

### 3.4 Contexto incompleto

La entrada actual de Vig‑IA incluye directamente:

- ID, nombre de entidad y título de la oportunidad;
- hasta 12 documentos;
- hasta 3.000 caracteres por documento;
- hasta 36.000 caracteres totales;
- tres campos empresariales que no están alineados con el esquema corporativo vigente.

No existe chunking, recuperación semántica ni corpus normativo conectado.

### 3.5 Gobierno que debe preservarse

- snapshots y versiones documentales;
- hashes, deduplicación e idempotencia;
- análisis append‑only;
- evidencia y productores auditables;
- contratos JSON cerrados;
- citas mediante identificadores permitidos;
- redacción de información sensible;
- revisión humana obligatoria;
- autoridad exclusivamente humana para GO / NO GO, aprobación, firma, envío y presentación.

## 4. Objetivos

### 4.1 Objetivo operativo

Reducir el tiempo y la incertidumbre entre conversión, procesamiento documental y disponibilidad del análisis sin eliminar los controles durables.

### 4.2 Objetivo analítico

Permitir que Vig‑IA razone sobre la evidencia completa y vigente de la oportunidad, el expediente, Seguridad Nacional, el contexto comercial y el marco normativo aplicable.

### 4.3 Objetivo de experiencia

Mostrar de manera comprensible qué está haciendo Vig‑IA, qué ha terminado, qué falta, qué falló y qué requiere intervención humana.

### 4.4 Objetivo de gobierno

Conservar fuentes, versiones, citas, abstención ante ausencia de evidencia y autoridad humana inmutable.

## 5. Principios

1. Vig‑IA es canónico desde la conversión.
2. El GO es una decisión humana, no una autorización de análisis.
3. No existe fallback silencioso de reglas como análisis canónico.
4. Las reglas validan hechos objetivos; no reemplazan razonamiento contextual.
5. Un fallo de IA produce espera o atención, no un análisis ficticiamente completado.
6. Cada afirmación material debe vincularse a evidencia.
7. Documento, evidencia empresarial y norma jurídica son clases de fuente distintas.
8. Cada fuente tiene identidad, procedencia, versión, vigencia y fecha de consulta.
9. Las omisiones por presupuesto deben registrarse explícitamente.
10. Los cálculos exactos siguen siendo determinísticos y reproducibles.
11. Las migraciones preservan evidencia y tienen rollback seguro.
12. La implementación es incremental, con flags fail‑closed y gates humanos.
13. `api/[...path].js` y `server/index.js` mantienen paridad.
14. Ningún bloque concede a Vig‑IA autoridad para decidir, aprobar, firmar, enviar o presentar.
15. NoxCloud permanece fuera de alcance y sin activación productiva.

## 6. Arquitectura objetivo

```text
Conversión humana
│
├── crea/recupera oportunidad
├── crea job idempotente
└── dispara ejecución inmediata acotada
        │
        ▼
Pipeline durable de procesamiento
├── descubre documentos
├── importa/versiona
├── extrae y segmenta
├── construye snapshot
├── prepara contexto v2
├── recupera evidencia relevante
└── solicita análisis canónico a Vig‑IA
        │
        ▼
Run de análisis append-only
├── oportunidad estructurada
├── evidencia documental
├── evidencia corporativa/RUP
├── contexto comercial autorizado
├── normativa versionada
├── hechos e inferencias separados
├── preguntas y asuntos no verificados
└── revisión humana requerida
        │
        ▼
Decisión humana GO / NO GO
        │
        └── si GO: continuidad en Mesa de trabajo
```

El scheduler del pipeline no impulsa el caso ordinario. Reconciliará trabajos pendientes, leases vencidos, fallos recuperables y ejecuciones que no pudieron ser disparadas inmediatamente.

## 7. Programa por entregas

### 7.1 Bloque 0 — Línea base y controles transversales

Sin cambio funcional:

- trabajar desde `origin/main` vigente en rama aislada;
- registrar pruebas y fallos preexistentes;
- introducir flags fail‑closed por bloque;
- verificar paridad backend;
- definir métricas y logs sin información sensible;
- establecer gates de migración, rollback y despliegue.

Flags previstos:

- `TENDER_IMMEDIATE_DISPATCH`;
- `TENDER_CONTINUOUS_DRAIN`;
- `AGT002_CANONICAL_ONLY`;
- `AGT002_CONTEXT_V2`;
- `AGT002_DOCUMENT_RETRIEVAL`;
- `AGT002_LEGAL_CORPUS`.

Con flags apagados, el comportamiento debe ser idéntico al actual.

### 7.2 Entrega 1 — Operación inmediata y progreso visible

#### Disparo inmediato

La conversión debe:

1. crear o recuperar idempotentemente la oportunidad;
2. crear o recuperar el job;
3. confirmar la transacción durable;
4. disparar una ejecución acotada sin esperar al scheduler.

El disparo no debe convertir la transacción de conversión en una operación larga. La persistencia durable se confirma antes del trabajo pesado.

#### Continuidad

El worker podrá procesar varias unidades consecutivas mientras conserve:

- lease válido;
- presupuesto de tiempo;
- presupuesto de elementos;
- idempotencia;
- estado no terminal.

Una fase exitosa actualiza el estado y libera o renueva el lease para continuar. No debe conservar un lease inactivo durante 90 segundos.

#### Reconciliación

El scheduler:

- recupera jobs pendientes sin ejecución;
- barre leases vencidos;
- reintenta fallos recuperables;
- detecta atascos;
- no duplica una ejecución inmediata activa.

#### Progreso visible

La UI mostrará:

- preparación del expediente;
- documentos detectados;
- procesados, existentes, fallidos y pendientes;
- snapshot listo;
- Vig‑IA en cola o analizando;
- análisis completado;
- fallo recuperable o atención requerida.

Al completar, la UI recarga documentos, snapshot, análisis y preguntas persistidas.

### 7.3 Entrega 2 — Canonicalidad de Vig‑IA

#### Superficie única

La oportunidad tendrá una única acción visible de análisis:

- “Analizar con Vig‑IA”;
- “Actualizar con Vig‑IA”;
- “Volver a analizar con Vig‑IA”.

La acción determinística deja de existir como análisis visible.

#### Estados de indisponibilidad

Si Vig‑IA no está disponible:

- no se persiste un run canónico por reglas;
- el job queda en espera de capacidad o atención;
- se registra la causa técnica sin exponer secretos;
- se reintenta automáticamente con backoff;
- se ofrece reintento manual idempotente;
- la UI muestra validaciones objetivas por separado.

#### Reglas postconversión

Las reglas pueden producir:

- fechas y valores extraídos;
- documentos obligatorios ausentes;
- inconsistencias mecánicas;
- cálculos financieros exactos;
- integridad y vigencia;
- clasificación documental;
- alertas técnicas.

No pueden producir como resultado canónico:

- GO / NO GO;
- encaje comercial definitivo;
- recomendación de avanzar o descartar;
- interpretación jurídica;
- fortaleza o debilidad contextual;
- conclusión que ancle a Vig‑IA.

### 7.4 Entrega 3 — Contrato de contexto Vig‑IA v2

#### Oportunidad

El contrato incluirá, con allowlist y procedencia:

- identidad de la oportunidad;
- entidad contratante;
- objeto;
- modalidad;
- presupuesto;
- cronograma y fecha de cierre;
- duración y lugar;
- fuente y referencia SECOP;
- razón de conversión;
- responsable interno;
- notas comerciales autorizadas;
- estado e historial relevante.

#### Expediente corporativo

Se definirá una fuente canónica para Seguridad Nacional con:

- razón social y NIT;
- RUP, fecha y estado;
- códigos UNSPSC;
- contratos y experiencia certificada;
- valores y equivalencias en SMMLV cuando correspondan;
- capacidad financiera y organizacional;
- licencias y servicios autorizados;
- certificaciones;
- capacidades técnicas y geográficas;
- documentos recurrentes;
- restricciones e información no verificada;
- evidencia fuente y vigencia.

No se entregarán campos inexistentes ni resúmenes sin fuente.

#### Contexto comercial

Solo se incluirán datos autorizados y pertinentes:

- interés estratégico;
- relación previa;
- oportunidades o contratos relacionados;
- responsables;
- capacidades disponibles;
- riesgos y notas humanas;
- respuestas a preguntas abiertas.

#### Clasificación de cumplimiento

Cada requisito se clasifica como:

- `cumplido_con_evidencia`;
- `cumplimiento_parcial`;
- `no_cumplido`;
- `sin_evidencia_suficiente`;
- `requiere_validacion_humana`.

La clasificación no equivale a decisión GO / NO GO.

### 7.5 Entrega 4 — Expediente documental completo

#### Segmentación

Todos los documentos vigentes del snapshot se procesan en fragmentos con:

- documento;
- versión;
- página o sección;
- tipo documental;
- hash;
- texto normalizado;
- vigencia;
- identificador de evidencia.

#### Precedencia documental

El sistema representa explícitamente:

- pliego base;
- adendas;
- respuestas y aclaraciones;
- anexos técnicos;
- estudios previos;
- formatos.

Una adenda puede modificar un requisito anterior sin borrar la evidencia histórica.

#### Recuperación

Vig‑IA recibe evidencia recuperada por relevancia y cobertura, no los primeros caracteres de una lista arbitraria.

El sistema registra:

- documentos cubiertos;
- fragmentos utilizados;
- contenido no recuperado;
- presupuesto consumido;
- razones de omisión.

No se afirma análisis integral cuando existen omisiones materiales.

### 7.6 Entrega 5 — Corpus normativo colombiano

#### Alcance inicial

El corpus se limita a fuentes oficiales y versionadas relacionadas con:

- contratación estatal;
- modalidades y procedimientos de selección;
- transparencia y anticorrupción;
- instrumentos de Colombia Compra Eficiente;
- vigilancia y seguridad privada;
- actos vigentes de Supervigilancia aplicables al objeto.

#### Modelo de fuente normativa

Cada unidad registra:

- tipo y número de norma;
- año;
- artículo o sección;
- texto vigente;
- autoridad emisora;
- fecha de expedición y vigencia;
- modificaciones o derogatorias conocidas;
- URL oficial;
- tema y sector;
- fecha de verificación;
- versión del corpus.

#### Uso

El análisis separa:

- requisito del pliego;
- obligación normativa;
- evidencia empresarial;
- interpretación de Vig‑IA;
- revisión jurídica requerida.

Cada run registra la versión del corpus. Si no puede verificarse la vigencia, el hallazgo se marca como no verificado y se remite a revisión humana.

El corpus no convierte a Vig‑IA en asesor jurídico ni le permite emitir decisiones jurídicas definitivas.

### 7.7 Entrega 6 — Continuidad y autoridad humana

Las preguntas y respuestas previas al GO se incorporan al mismo caso y se conservan al entrar en la Mesa de trabajo.

Cada nuevo análisis:

- crea una versión append‑only;
- referencia el snapshot documental;
- referencia contexto y política;
- referencia versión del corpus;
- conserva productor y modelo;
- no invalida decisiones humanas previas.

GO / NO GO, aprobación, firma, envío y presentación siguen siendo operaciones humanas con permisos explícitos. Ninguna ruta de IA, worker o scheduler puede ejecutarlas.

## 8. Contratos y persistencia

### 8.1 Envelope del análisis

El envelope canónico debe distinguir:

- estado del procesamiento;
- estado del agente;
- productor;
- modelo;
- versión de política;
- versión de contexto;
- snapshot documental;
- versión del corpus normativo;
- evidencia utilizada;
- omisiones conocidas;
- revisión humana requerida.

### 8.2 Productores

Los runs históricos por reglas se conservan para auditoría. No se borran ni se reetiquetan.

Desde la activación de canonicalidad:

- solo Vig‑IA puede crear un run canónico de análisis postconversión;
- las reglas producen artefactos de validación separados;
- no existe sobrescritura de evidencia histórica.

### 8.3 Tablas nuevas

Chunking, recuperación y corpus se incorporarán mediante tablas o artefactos append‑only con RPCs de lectura acotados. El plan técnico definirá el esquema exacto después de revisar las migraciones vigentes.

Ninguna migración elimina snapshots, análisis, decisiones o documentos históricos.

## 9. Manejo de errores

### 9.1 Fallos recuperables

- timeout;
- indisponibilidad temporal del bridge;
- cuota o capacidad temporal;
- error de descarga;
- lease vencido;
- error transitorio de extracción.

Producen reintento con backoff y estado visible.

### 9.2 Atención humana

- documento protegido o ilegible;
- contradicción documental no resoluble;
- ausencia de evidencia empresarial;
- vigencia jurídica no confirmada;
- respuesta humana requerida;
- error repetido que supera el límite técnico.

Producen una acción concreta, responsable sugerido y evidencia afectada.

### 9.3 Fallo cerrado

El sistema no completa análisis cuando:

- no existe snapshot válido;
- Vig‑IA no produjo una salida válida;
- las citas no pertenecen a la allowlist;
- falta autorización de acceso;
- el contexto viola el contrato;
- no puede determinarse qué evidencia se utilizó.

## 10. Observabilidad

Se medirán como mínimo:

- conversión → job durable;
- conversión → primer claim;
- conversión → snapshot;
- snapshot → solicitud a Vig‑IA;
- solicitud → análisis persistido;
- número de documentos y fragmentos;
- cobertura y omisiones;
- reintentos;
- leases recuperados;
- fallos por fase;
- tokens, costo y latencia;
- runs sin análisis canónico;
- cambios de estado realizados por humanos.

Los logs no incluyen documentos completos, prompts crudos, credenciales ni información sensible innecesaria.

## 11. Seguridad y autoridad

- acceso por módulo y rol;
- service role solo en rutas de backend autorizadas;
- contexto limitado al caso y al usuario;
- prompt injection tratada como contenido no confiable;
- herramientas deshabilitadas durante análisis;
- contratos cerrados y validación fail‑closed;
- hashes y versiones auditables;
- acciones humanas separadas de recomendaciones;
- ningún envío externo automático;
- ningún despliegue, migración remota o activación sin gate humano.

## 12. Migraciones y rollback

Cada migración nueva debe:

- usar transacción cuando el motor lo permita;
- ser idempotente o fallar de forma segura;
- incluir rollback específico;
- documentar backfills irreversibles;
- negarse a borrar evidencia activa;
- preservar compatibilidad con flags apagados;
- tener pruebas PGlite y de clasificación del runner.

La activación se hace por flags y estados, no eliminando datos históricos.

## 13. Estrategia de pruebas

### 13.1 Unitarias

- transición de fases;
- lease y continuidad;
- budgets;
- clasificación de fuentes;
- contrato de contexto v2;
- allowlist de evidencia;
- estados de indisponibilidad;
- separación reglas/análisis.

### 13.2 Integración

- conversión → job → ejecución inmediata;
- disparo y scheduler simultáneos sin doble procesamiento;
- recuperación de lease vencido;
- snapshot → retrieval → análisis;
- persistencia append‑only;
- corpus versionado por run;
- autoridad humana en GO / NO GO.

### 13.3 Frontend

- progreso por fases;
- recarga automática;
- ausencia del botón determinístico;
- estados de espera y fallo;
- citas y revisión humana visibles;
- navegación hacia Mesa de trabajo después del GO.

### 13.4 Regresión y mecánica

- suite completa;
- pruebas focales AGT‑002;
- `check:backend-parity`;
- build;
- `git diff --check`;
- verificación de migraciones y rollbacks.

## 14. Rollout y gates

Cada entrega sigue:

1. implementación con flag apagado;
2. pruebas focales;
3. regresión;
4. revisión independiente única;
5. corrección solo si existe hallazgo Critical, Important o regresión;
6. gate humano para migración o despliegue;
7. activación controlada;
8. verificación observable;
9. rollback por flag si falla;
10. cierre con evidencia.

No se realizan push, PR, merge, migración remota, despliegue ni uso de datos reales sin el gate correspondiente.

## 15. Criterios de éxito del programa

El programa se considera completo cuando:

1. la conversión inicia procesamiento sin esperar al scheduler;
2. el worker avanza sin leases inactivos artificiales;
3. la UI muestra progreso y recarga el resultado;
4. no existe análisis determinístico visible postconversión;
5. las reglas no pueden sobrescribir ni sustituir a Vig‑IA;
6. la indisponibilidad de Vig‑IA se representa honestamente;
7. el contexto incluye oportunidad y expediente corporativo canónicos;
8. todos los documentos vigentes son recuperables con citas;
9. las omisiones quedan registradas;
10. el corpus jurídico es oficial, versionado y citable;
11. las respuestas humanas actualizan el análisis sin perder historial;
12. Vig‑IA conserva el contexto al pasar a la Mesa de trabajo;
13. GO / NO GO, aprobación, firma, envío y presentación permanecen exclusivamente humanos;
14. pruebas, paridad, build, migraciones y rollbacks están verificados;
15. una revisión integral final no identifica riesgos críticos abiertos.

## 16. No objetivos

- reescribir SIIO;
- crear un segundo expediente;
- eliminar reglas determinísticas útiles;
- automatizar GO / NO GO;
- automatizar aprobación, firma, envío o presentación;
- convertir Vig‑IA en autoridad jurídica;
- persistir prompts o documentos crudos sin necesidad;
- mezclar el scheduler documental con el scheduler conversacional de la Mesa;
- cambiar la semántica ilimitada del runtime de Mesa de trabajo;
- activar NoxCloud;
- realizar despliegues o migraciones dentro de la fase de diseño y planeación.

## 17. Orden aprobado

```text
B0 Línea base
→ E1 operación inmediata + progreso
→ E2 canonicalidad Vig‑IA
→ E3 contexto de oportunidad y empresa
→ E4 expediente documental completo
→ E5 corpus normativo
→ E6 continuidad y custodia humana
→ revisión integral final
```

La implementación podrá solapar trabajo de diseño de datos entre E3, E4 y E5, pero ningún bloque se activa en producción antes de cumplir su dependencia y su gate.