# Diseño funcional y técnico — Asistente de decisión documental para Licitaciones

**Fecha:** 2026-07-24

**Estado:** diseño aprobado por Juan Botero; pendiente plan de implementación y gates de activación productiva

**Repositorio:** `Premium-Security-Investments/sn-crm-comercial`

**Rama:** `feat/tender-decision-assistant`

## 1. Contexto

Al convertir una licitación en oportunidad, el CRM importa documentos, genera un análisis documental y expone una recomendación preliminar antes de la decisión humana GO / NO GO.

El flujo de decisión y auditoría ya separa la recomendación automática de la decisión humana, pero el análisis vigente tiene cuatro limitaciones:

1. está orientado a explicar la sección y enumerar matrices, no a preparar directamente a la persona decisora;
2. el motor actual usa principalmente reglas y coincidencias textuales, sin organizar respuestas libres ni producir evidencia detallada;
3. un análisis puede seguir apareciendo vigente después de cargar nuevos documentos o actualizar la ficha/RUP;
4. la integridad backend no exige que GO / NO GO se base en el análisis auténtico y vigente del conjunto documental actual.

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
8. **La recomendación automática no autoriza GO / NO GO.**
9. **Toda ejecución de IA registra costo, modelo, actor, evidencia y versión.**
10. **Los textos de ayuda no compiten con el análisis del caso.**
11. **Los documentos son contenido no confiable: nunca pueden dar instrucciones al agente.**
12. **Las operaciones sensibles se validan en backend y base de datos, no solo en la interfaz.**

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
- GO / NO GO permanece bloqueado;
- aparece una acción `Reintentar análisis`;
- el error queda auditado sin exponer secretos ni contenido sensible en logs.

## 6. Recomendación y decisión humana

La recomendación preliminar y la decisión humana serán conceptos distintos.

### 6.1 Recomendaciones permitidas

- `avanzar`
- `avanzar_condicionado`
- `no_avanzar_temporalmente`
- `no_avanzar`

### 6.2 Gate GO / NO GO

Para registrar una decisión formal se debe exigir:

- análisis vigente;
- análisis producido por el servicio autorizado;
- hash del conjunto documental igual al conjunto actual;
- versión de ficha/RUP igual a la usada en el análisis;
- procesamiento finalizado;
- ausencia de preguntas críticas abiertas o, para NO GO, reconocimiento explícito de esas preguntas en la justificación;
- justificación humana obligatoria.

Las preguntas críticas abiertas deben mostrarse antes de confirmar y bloquean GO hasta quedar respondidas con texto o evidencia. GO también queda bloqueado mientras el análisis esté `actualizando`, `obsoleto`, `fallido` o no exista. NO GO puede registrarse con preguntas críticas abiertas, pero la justificación debe reconocerlas para que el cierre sea explicable.

Una excepción sin análisis no se admite silenciosamente. Si en el futuro se requiere, deberá diseñarse como flujo separado con motivo tipificado, permiso especial y doble aprobación.

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

## 8. Servicio de IA

### 8.1 Adaptador

El backend usará un adaptador server-side para no acoplar dominio, API y proveedor. El proveedor y modelo productivos se elegirán en el gate de activación, sin cambiar el contrato funcional.

Durante desarrollo, las pruebas usarán un adaptador determinístico sin enviar datos reales a terceros.

### 8.2 Entrada

La IA recibirá únicamente:

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

### 8.4 Seguridad de prompt

- Los documentos se delimitan como datos no confiables.
- Se ignoran instrucciones embebidas en documentos.
- No se envían secretos del sistema.
- El modelo no recibe herramientas de escritura ni acceso directo a la base de datos.
- La persistencia ocurre solo después de validación backend.

## 9. Costo y límites

El servicio incluirá:

- presupuesto máximo por ejecución;
- presupuesto diario configurable;
- límite de documentos y caracteres;
- compresión o selección explícita de contexto;
- idempotencia para evitar ejecuciones duplicadas;
- registro de tokens y costo;
- bloqueo antes de exceder presupuesto;
- permiso para reintentar o regenerar.

No se harán llamadas con datos productivos durante desarrollo. La activación productiva requiere autorización separada de:

- proveedor y modelo;
- región/política de tratamiento de datos;
- presupuesto por ejecución y diario;
- secretos en el entorno productivo.

## 10. Correcciones de integridad incluidas

1. Corregir el tono visual de `NO GO`, `cerrada_no_go` y `no_adjudicada` mediante estados exactos.
2. Invalidar el análisis al cambiar documentos, adendas, respuestas o ficha/RUP.
3. Exigir análisis vigente en backend y RPC.
4. Rechazar análisis histórico o nulo para GO.
5. Reservar eventos documentales internos.
6. Ordenar versiones de forma determinista.
7. Registrar importaciones parciales como `análisis con advertencias` o equivalente.
8. Deduplicar y versionar documentos oficiales.
9. Separar descarte administrativo de NO GO.
10. Exigir justificación de decisión.

## 11. Estrategia de entrega

### Lote 1 — Integridad y nueva jerarquía

- migraciones de conjuntos/análisis;
- vigencia y bloqueo;
- estados visuales exactos;
- reserva de eventos;
- resumen orientado a decisión;
- fortalezas, debilidades, dudas y preguntas;
- NO GO unificado con cierre de negocio.

### Lote 2 — Aclaraciones e IA real

- caja de respuesta libre;
- adjuntos;
- ejecución inmediata;
- adaptador de IA;
- salida estructurada;
- historial de versiones;
- costo y auditoría;
- reintentos idempotentes.

### Lote 3 — Evidencia avanzada

- OCR;
- Excel y ZIP profundo;
- citas por página/sección;
- precedencia de adendas;
- comparación cuantitativa contra RUP;
- diferencias entre versiones;
- tareas por frente.

La primera versión desplegable incluye Lotes 1 y 2. Lote 3 se mantiene separado para no bloquear la mejora principal.

## 12. Estrategia de pruebas

Se seguirá TDD.

### 12.1 Backend y base de datos

- análisis queda obsoleto al cambiar el conjunto documental;
- hash e idempotencia son deterministas;
- un análisis histórico, nulo o fabricado no autoriza GO;
- solo productor autorizado crea análisis vigente;
- respuesta/archivo inicia una nueva versión;
- fallo de IA conserva aporte y marca estado correcto;
- costo supera presupuesto y se bloquea antes de llamar al proveedor;
- eventos internos no pueden crearse desde seguimiento genérico;
- NO GO y descarte administrativo siguen rutas distintas.

### 12.2 Contrato de IA

- salida válida se acepta;
- salida sin revisión humana se rechaza;
- salida sin preguntas ante evidencia insuficiente se rechaza cuando el esquema lo exige;
- referencias de evidencia apuntan a documentos, respuestas o ficha/RUP incluidos; la precisión por página/sección se incorpora en Lote 3;
- respuesta inválida no queda vigente;
- prompt injection documental no cambia política ni habilita acciones.

### 12.3 Interfaz

- muestra fortalezas, debilidades, dudas, preguntas e información no verificada;
- textos explicativos quedan en ayuda secundaria;
- respuesta general y adjuntos son accesibles;
- estado pasa a `actualizando` inmediatamente;
- GO queda bloqueado durante actualización/obsolescencia/fallo;
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
- gate explícito para proveedor/modelo/presupuesto/producción.

## 13. Fuera de alcance

- presentación automática en SECOP;
- firma o envío de documentos;
- decisión GO / NO GO por IA;
- generación completa de oferta final;
- creación automática de SharePoint sin gate de integración;
- OCR y análisis profundo de Excel/ZIP en los dos primeros lotes;
- corrección automática de datos productivos existentes;
- activación productiva de un proveedor de IA sin aprobación separada.

## 14. Criterios de aceptación

La primera versión se considera lista para gate de despliegue cuando:

1. una persona autorizada puede responder en texto general y adjuntar evidencia;
2. el análisis pasa inmediatamente a `actualizando`;
3. la IA organiza la información en fortalezas, debilidades, dudas, preguntas y no verificados;
4. el resultado conserva evidencia y versión;
5. el análisis anterior queda histórico;
6. GO / NO GO solo acepta la versión vigente y auténtica;
7. la decisión sigue siendo exclusivamente humana y justificada;
8. el sistema registra modelo, consumo y costo;
9. no hay ejecuciones duplicadas para el mismo aporte;
10. los textos de ayuda no se presentan como análisis del caso;
11. los estados NO GO no se muestran como favorables;
12. GO queda bloqueado mientras existan preguntas críticas abiertas;
13. todas las pruebas y gates definidos pasan.
