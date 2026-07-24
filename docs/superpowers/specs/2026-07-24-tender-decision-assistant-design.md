# Diseño funcional y técnico — Asistente de decisión documental para Licitaciones

**Fecha:** 2026-07-24

**Estado:** diseño aprobado por Juan Botero; alcance SIIO y puente temporal Hermes aprobados para implementación; el uso de documentos productivos requiere gates separados de proveedor, tratamiento de datos y presupuesto; AGT-002 conserva el destino institucional definitivo

**Repositorio:** `Premium-Security-Investments/sn-crm-comercial`

**Rama:** `feat/tender-decision-assistant`

## 1. Contexto

Al convertir una licitación en oportunidad, el CRM importa documentos, genera un análisis documental y expone una recomendación preliminar antes de la decisión humana GO / NO GO.

El flujo de decisión y auditoría ya separa la recomendación automática de la decisión humana, pero el análisis vigente tiene cuatro limitaciones:

1. está orientado a explicar la sección y enumerar matrices, no a preparar directamente a la persona decisora;
2. el motor actual usa principalmente reglas y coincidencias textuales, sin organizar respuestas libres ni producir evidencia detallada;
3. un análisis puede seguir apareciendo vigente después de cargar nuevos documentos o actualizar la ficha/RUP;
4. la interfaz no distingue con suficiente claridad entre vigencia de la recomendación y autoridad de la decisión humana.

El objetivo no es que la IA decida. El objetivo es que la persona encargada tenga información suficiente, concreta y verificable para decidir si Seguridad Nacional debe seguir adelante.

## 2. Objetivo de producto

La sección debe responder de forma directa:

> ¿Tenemos razones y evidencia suficientes para seguir adelante con esta licitación?

Para ello, el sistema debe presentar:

- fortalezas del caso;
- debilidades y bloqueadores;
- dudas abiertas;
- preguntas concretas para la persona responsable;
- información no verificada;
- evidencia asociada;
- siguiente acción recomendada;
- recomendación preliminar, separada de la decisión humana.

Cuando haya dudas, la persona responsable podrá escribir una respuesta general en lenguaje natural y adjuntar archivos. La IA organizará inmediatamente esa información, actualizará la conclusión y conservará la versión anterior en el historial.

## 3. Principios

1. **La IA prepara la decisión; nunca la toma.**
2. **Ausencia de evidencia no equivale a cumplimiento.**
3. **Toda fortaleza o debilidad debe distinguir hecho, inferencia y pendiente.**
4. **Una conclusión solo es vigente para un conjunto documental y una ficha/RUP específicos.**
5. **Agregar documentos, respuestas o cambios de RUP invalida la conclusión anterior.**
6. **Las preguntas deben ser concretas, accionables y resolubles mediante texto o evidencia.**
7. **La persona responde en lenguaje natural; el sistema organiza la información.**
8. **La recomendación automática no autoriza, bloquea ni sustituye GO / NO GO humano. Una persona con `LICITACIONES_GO_NO_GO_APPROVE` conserva autoridad absoluta para registrar cualquiera de las dos decisiones.**
9. **Toda ejecución de IA registra costo, modelo, actor, evidencia y versión.**
10. **Los textos de ayuda no compiten con el análisis del caso.**
11. **Los documentos son contenido no confiable: nunca pueden dar instrucciones al agente.**
12. **Las operaciones sensibles se validan en backend y base de datos, no solo en la interfaz.**
13. **AGT-002 es la única identidad institucional definitiva de IA para Licitaciones. Hermes puede operar temporalmente como motor auditado `HERMES-INTERIM`, sin presentarse como AGT-002 ni convertirse en un segundo agente institucional.**

## 4. Usuarios y permisos

Podrán responder preguntas, escribir información adicional y adjuntar evidencia:

- responsable asignado a la oportunidad;
- Dirección de Licitaciones;
- Gerencia;
- Admin.

Podrán registrar GO / NO GO únicamente quienes ya tengan el permiso formal `LICITACIONES_GO_NO_GO_APPROVE`.

La IA y cualquier identidad de agente tendrán prohibido registrar GO / NO GO.

## 5. Experiencia funcional

### 5.1 Encabezado: Resumen para decidir

El detalle mostrará primero un bloque único con:

- **Recomendación preliminar:** `avanzar`, `avanzar condicionado`, `no avanzar temporalmente` o `no avanzar`;
- **Estado:** `actualizando`, `vigente`, `requiere información`, `obsoleto` o `fallido`;
- **Cobertura documental:** archivos esperados, disponibles, procesados, incompletos y faltantes;
- **Riesgo principal**;
- **Siguiente acción recomendada**;
- fecha, versión y alcance de la conclusión.

La palabra `dictamen` se reemplazará por `preanálisis documental` o `conclusión preliminar`.

### 5.2 Información para decidir

El contenido aparecerá en este orden:

1. **Fortalezas** — razones concretas para avanzar.
2. **Debilidades y bloqueadores** — riesgos que pueden impedir competir, cumplir o ganar.
3. **Dudas abiertas** — elementos que la evidencia no permite confirmar.
4. **Preguntas para la responsable** — preguntas concretas derivadas de las dudas.
5. **Información no verificada** — afirmaciones que no deben tratarse como hechos.
6. **Siguiente acción** — acción, frente sugerido y urgencia.
7. **Detalle por frente** — jurídico, técnico, financiero, experiencia, formatos y comercial, inicialmente colapsado.

Cada elemento deberá incluir, cuando exista:

- severidad;
- estado (`confirmado`, `parcial`, `pendiente`, `no cumple`, `no verificable`);
- fuente;
- página o sección;
- fragmento de evidencia;
- responsable sugerido.

### 5.3 Ayuda secundaria

Los textos explicativos sobre la sección se moverán a un bloque colapsable `Cómo funciona`.

No aparecerán dentro del resumen, fortalezas, debilidades, preguntas ni conclusión del caso.

### 5.4 Respuesta libre y archivos

La pantalla tendrá una caja única:

> Escriba lo que sabe o responda las preguntas pendientes.

La persona podrá:

- escribir una respuesta general;
- adjuntar uno o varios archivos cuando sean útiles;
- enviar sin clasificar manualmente cada frase.

Al enviar:

1. se guarda la respuesta y sus archivos;
2. la conclusión vigente pasa inmediatamente a `actualizando`;
3. comienza una nueva ejecución de IA;
4. se organizan las ideas contra las preguntas abiertas;
5. se genera una nueva versión;
6. la versión anterior queda en el historial.

El resultado debe indicar:

- preguntas respondidas;
- fortalezas confirmadas;
- debilidades resueltas;
- riesgos nuevos;
- preguntas que siguen abiertas;
- evidencia añadida;
- cambios en la recomendación.

### 5.5 Error y reintento

Si el análisis falla:

- la información aportada permanece guardada;
- la versión anterior se conserva y se marca `obsoleta`;
- GO / NO GO permanece disponible para una persona con el permiso correspondiente y el fallo se muestra como advertencia;
- aparece una acción `Reintentar análisis`;
- el error queda auditado sin exponer secretos ni contenido sensible en logs.

## 6. Recomendación y decisión humana

La recomendación preliminar y la decisión humana serán conceptos distintos.

### 6.1 Etiquetas visibles de recomendación

- `GO recomendado`
- `GO condicionado`
- `NO GO recomendado`
- `Información insuficiente`

Los valores históricos o internos se normalizan a estas etiquetas sin alterar el resultado original almacenado.

### 6.2 Autoridad humana GO / NO GO

AGT-002 recomienda, pero no autoriza ni bloquea. Una persona con `LICITACIONES_GO_NO_GO_APPROVE` puede registrar GO o NO GO aunque la recomendación sea contraria, existan preguntas críticas, el análisis esté obsoleto, haya fallado o no exista.

La interfaz debe mostrar esas condiciones como advertencias antes de confirmar, nunca como bloqueos. La recomendación original permanece separada e inmutable. El comentario humano es opcional.

Backend, RPC y base de datos deben exigir identidad humana, permiso, oportunidad/licitación válidas y consistencia de ámbito cuando se suministre `analysis_run_id`. No deben exigir análisis, estado `completed`, vigencia, ausencia de preguntas críticas, coincidencia con la recomendación ni comentario. `analysis_run_id` puede ser nulo para conservar explícitamente la trazabilidad de una decisión sin análisis.

### 6.3 Cierre y descarte

`Sacar de oportunidad` no puede reemplazar el NO GO formal.

- Una decisión de negocio para no continuar se registra como NO GO.
- Una corrección administrativa de conversión errónea usa una acción separada, restringida y auditada.

## 7. Arquitectura de datos

El análisis válido dejará de depender exclusivamente de JSON libre dentro de `psi_sales_interactions.notes`.

### 7.1 Conjuntos documentales

Una entidad tipada representará el snapshot de evidencia:

- oportunidad y licitación;
- hash del conjunto;
- documentos incluidos;
- hash SHA-256 real de cada contenido;
- documentos excluidos y razón;
- fecha de corte;
- versión/fecha de ficha y RUP;
- estado de cobertura.

### 7.2 Ejecuciones de análisis

Cada ejecución almacenará:

- oportunidad;
- conjunto documental;
- versión y estado;
- proveedor y modelo;
- versión de prompt y esquema;
- actor que originó la ejecución;
- inicio y finalización;
- resultado estructurado;
- errores seguros;
- tokens de entrada/salida;
- costo estimado y real;
- idempotency key.

### 7.3 Rondas de aclaración

Cada aporte de la persona responsable almacenará:

- texto original;
- actor y fecha;
- archivos adjuntos;
- análisis anterior;
- nueva ejecución;
- preguntas que la IA consideró respondidas;
- cambios estructurados entre versiones.

### 7.4 Evidencias

Los hallazgos podrán apuntar a:

- documento;
- página o sección;
- fragmento;
- archivo de respuesta;
- respuesta humana;
- ficha/RUP.

### 7.5 Auditoría CRM

Las interacciones CRM conservarán eventos legibles para timeline, pero no serán la autoridad para certificar un análisis.

Los `kind` internos `tender_document_*` y `tender_offer_preparation` quedarán reservados a rutas internas/RPC. Las rutas generales de seguimiento rechazarán esos payloads.

## 8. Integración canónica, puente Hermes y destino AGT-002

### 8.1 División de responsabilidades

SIIO conserva la lógica de dominio, los datos, contratos, snapshots, vigencia, permisos, persistencia y gates GO / NO GO. Plataforma Agentes gobierna la identidad técnica, policy de ejecución, evidencia de run y auditoría de AGT-002. AGT-002 será el productor institucional definitivo del razonamiento documental y la recomendación preliminar.

El contrato v1 actual de AGT-002 es inmutable, `contract_only`, `read` y `persisted_results_only`. No se modificará destructivamente. Las capacidades de generación y aclaración se incorporarán en una versión nueva del contrato institucional.

SIIO usará una interfaz server-side `TenderAnalysisEngine` con productores explícitos. El preanálisis vigente continuará como `siio_rules_v1`; el puente inteligente temporal se registrará como `HERMES-INTERIM`; el destino definitivo será `AGT-002`. Ningún resultado histórico cambiará retroactivamente de productor.

Hermes operará mediante un perfil dedicado `psi-licitaciones-interim` y su API Server OpenAI-compatible, ligado a loopback o red privada, con bearer secret server-side, sin CORS público y sin herramientas de terminal, archivos, web, memoria, mensajería, delegación o escritura. Cada análisis será stateless e independiente. SIIO enviará el snapshot en el cuerpo HTTP, nunca en argumentos de proceso, validará el JSON antes de persistirlo y aplicará timeouts, idempotencia, límites y circuit breaker.

El respondedor sintético queda exclusivamente en `tests/fixtures`; nunca formará parte del runtime ni podrá persistirse como `AGT-002`. Mientras ningún motor inteligente esté habilitado, el analizador determinístico seguirá claramente identificado como `Preanálisis por reglas SIIO`.

### 8.2 Entrada

El motor inteligente autorizado —`HERMES-INTERIM` durante el puente o `AGT-002` después de su activación— recibirá únicamente:

- metadatos necesarios de la oportunidad;
- texto extraído de documentos vigentes dentro de límites explícitos;
- ficha/RUP vigente;
- respuestas humanas previas;
- esquema de salida;
- política de decisión asistida.

### 8.3 Salida estructurada

La respuesta deberá validar contra un esquema que incluya:

- recomendación preliminar;
- resumen decisorio;
- fortalezas;
- debilidades;
- bloqueadores;
- dudas;
- preguntas;
- información no verificada;
- detalle por frente;
- evidencias;
- siguiente acción;
- revisión humana requerida siempre en `true`.

Una respuesta inválida no puede convertirse en análisis vigente.

### 8.4 Seguridad de ejecución

- Los documentos se delimitan como datos no confiables.
- Se ignoran instrucciones embebidas en documentos.
- No se envían secretos del sistema.
- El modelo no recibe herramientas de escritura ni acceso directo a la base de datos.
- La persistencia ocurre solo después de validación backend.

## 9. Costo y límites

Hermes durante el puente y AGT-002/Plataforma Agentes en el destino definitivo aplicarán límites de ejecución y devolverán el consumo en su envelope. SIIO registrará y verificará esa información junto al análisis. El conjunto incluirá:

- presupuesto máximo por ejecución;
- presupuesto diario configurable;
- límite de documentos y caracteres;
- compresión o selección explícita de contexto;
- idempotencia para evitar ejecuciones duplicadas;
- registro de tokens y costo;
- bloqueo antes de exceder presupuesto;
- permiso para reintentar o regenerar.

No se harán llamadas con datos productivos durante desarrollo. SIIO podrá completar su preparación y probar el transporte con fixtures sin activar consumo real. La activación de `HERMES-INTERIM` requiere aprobación separada de proveedor/modelo, región y política de tratamiento de datos, presupuesto por ejecución y diario, secreto del API Server, aislamiento del perfil, toolsets deshabilitados, timeouts y compatibilidad del envelope.

La sustitución posterior por AGT-002 requiere además identidad técnica, policy version, contrato institucional nuevo y evidencia de integración. Cambiar `TENDER_ANALYSIS_ENGINE=hermes_interim` por `agt002` no modifica la interfaz, los snapshots ni los análisis históricos.

## 10. Correcciones de integridad incluidas

1. Corregir el tono visual de `NO GO`, `cerrada_no_go` y `no_adjudicada` mediante estados exactos.
2. Invalidar el análisis al cambiar documentos, adendas, respuestas o ficha/RUP.
3. Exponer vigencia, fallos y ausencia de análisis como advertencias sin convertirlos en gates humanos.
4. Permitir GO y NO GO sin análisis, conservando `analysis_run_id` nulo cuando corresponda.
5. Reservar eventos documentales internos.
6. Ordenar versiones de forma determinista.
7. Registrar importaciones parciales como `análisis con advertencias` o equivalente.
8. Deduplicar y versionar documentos oficiales.
9. Separar descarte administrativo de NO GO.
10. Mantener el comentario humano como campo opcional y auditable.

## 11. Estrategia de entrega

### Lote 1 — Integridad y nueva jerarquía

- migraciones de conjuntos/análisis;
- vigencia y advertencias no bloqueantes;
- estados visuales exactos;
- reserva de eventos;
- resumen orientado a decisión;
- fortalezas, debilidades, dudas y preguntas;
- NO GO unificado con cierre de negocio.

### Lote 2 — Puente Hermes auditado y preparación de aclaraciones

- interfaz `TenderAnalysisEngine` y selector `rules|hermes_interim|agt002`;
- perfil Hermes dedicado, stateless y sin herramientas operativas;
- API Server local/privada con bearer secret server-side;
- adaptador `HERMES-INTERIM` con salida estructurada, timeouts, idempotencia y circuit breaker;
- caja de respuesta libre y adjuntos detrás de feature flag;
- persistencia de aportes y estado pendiente/actualizando;
- historial de versiones, costo y auditoría;
- responder sintético solo en fixtures de pruebas;
- activación real separada para documentos anonimizados y productivos.

### Lote 2B — Sustitución por AGT-002

- adaptador contractual institucional AGT-002;
- validación de identidad técnica y policy version;
- pruebas de compatibilidad contra el mismo dominio de salida;
- cambio de motor sin reescribir UI, snapshots ni historia;
- retiro controlado de `HERMES-INTERIM` después del gate AGT-002.

### Lote 3 — Evidencia avanzada

- OCR;
- Excel y ZIP profundo;
- citas por página/sección;
- precedencia de adendas;
- comparación cuantitativa contra RUP;
- diferencias entre versiones;
- tareas por frente.

SIIO puede desplegar el Lote 1 de forma independiente. El Lote 2 puede integrarse con fixtures y habilitarse primero con documentos sintéticos o anonimizados; el uso de datos productivos requiere el gate Hermes específico. Lote 2B sustituye el motor por AGT-002 cuando esté operativo. Lote 3 se mantiene separado.

## 12. Estrategia de pruebas

Se seguirá TDD.

### 12.1 Backend y base de datos

- análisis queda obsoleto al cambiar el conjunto documental;
- hash e idempotencia son deterministas;
- un análisis histórico, nulo o fabricado no autoriza ni bloquea GO; un `analysis_run_id` suministrado debe pertenecer al ámbito de la oportunidad;
- solo productor autorizado crea análisis vigente;
- respuesta/archivo inicia una nueva versión;
- fallo o indisponibilidad del motor seleccionado conserva el aporte y marca estado correcto;
- costo supera presupuesto y se bloquea antes de solicitar una ejecución;
- eventos internos no pueden crearse desde seguimiento genérico;
- NO GO y descarte administrativo siguen rutas distintas.

### 12.2 Contrato AGT-002

- salida válida se acepta;
- salida sin revisión humana se rechaza;
- salida sin preguntas ante evidencia insuficiente se rechaza cuando el esquema lo exige;
- referencias de evidencia apuntan a documentos, respuestas o ficha/RUP incluidos; la precisión por página/sección se incorpora en Lote 3;
- respuesta inválida no queda vigente;
- prompt injection documental no cambia política ni habilita acciones;
- solo `HERMES-INTERIM` durante el puente o `AGT-002` después de su gate pueden producir análisis inteligentes vigentes; el productor siempre se conserva y muestra sin alias;
- el contrato v1 permanece intacto y las nuevas capacidades usan una versión nueva.

### 12.3 Interfaz

- muestra fortalezas, debilidades, dudas, preguntas e información no verificada;
- textos explicativos quedan en ayuda secundaria;
- respuesta general y adjuntos son accesibles;
- con feature flag activo, el estado pasa a `actualizando` inmediatamente;
- actualización, obsolescencia, fallo, ausencia de análisis y preguntas críticas se muestran como advertencias sin bloquear GO ni NO GO humano;
- historial conserva versiones;
- estados NO GO nunca se muestran como éxito;
- permisos limitan respuestas a responsable, Dirección, Gerencia y Admin.

### 12.4 Verificación

Antes de despliegue:

- migraciones PGlite;
- tests focalizados;
- suite completa;
- paridad `server/index.js` / `api/[...path].js`;
- build de producción;
- QA autenticada desktop/móvil;
- prueba de concurrencia e idempotencia;
- prueba de presupuesto sin datos reales;
- revisión de seguridad y tratamiento de datos;
- gate explícito para AGT-002, proveedor/modelo, presupuesto y producción.

## 13. Fuera de alcance

- presentación automática en SECOP;
- firma o envío de documentos;
- decisión GO / NO GO por IA;
- generación completa de oferta final;
- creación automática de SharePoint sin gate de integración;
- OCR y análisis profundo de Excel/ZIP en los dos primeros lotes;
- corrección automática de datos productivos existentes;
- implementación del runtime de AGT-002 dentro de SIIO;
- activación productiva de AGT-002 o de un proveedor de IA sin aprobación separada.

## 14. Criterios de aceptación

El lado SIIO se considera listo para el puente Hermes y la sustitución posterior por AGT-002 cuando:

1. una persona autorizada puede responder en texto general y adjuntar evidencia cuando el feature flag esté activo;
2. SIIO persiste el aporte y prepara un snapshot determinista e idempotente para el motor seleccionado;
3. los fixtures validan el contrato sin producir análisis operativos y `HERMES-INTERIM` puede organizar información real únicamente después de superar sus gates;
4. el resultado conserva evidencia y versión;
5. el análisis anterior queda histórico;
6. GO / NO GO permite una decisión humana autorizada con análisis contrario, obsoleto, fallido o ausente, y conserva el run original cuando existe;
7. la decisión sigue siendo exclusivamente humana; el comentario es opcional y auditable;
8. el sistema registra productor real, run, policy/schema version, proveedor, modelo, consumo y costo; Hermes nunca se registra como AGT-002;
9. no hay ejecuciones duplicadas para el mismo aporte;
10. los textos de ayuda no se presentan como análisis del caso;
11. los estados NO GO no se muestran como favorables;
12. las preguntas críticas abiertas generan advertencias y nunca sustituyen ni bloquean la decisión humana autorizada;
13. todas las pruebas y gates definidos pasan;
14. sin un motor inteligente aprobado, la conversación permanece deshabilitada y el análisis existente se identifica como `Preanálisis por reglas SIIO`.
