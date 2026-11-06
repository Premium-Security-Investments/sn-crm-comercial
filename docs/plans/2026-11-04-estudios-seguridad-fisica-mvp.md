# Estudios de Seguridad Física en SIIO — plan del MVP

- **Creado:** 2026-11-04. **Replaneado:** 2026-11-05, con el informe real de HADA International (PDF de 39 páginas).
- **Pedido por:** Juan Botero.
- **Objetivo (Juan, 2026-11-05):** "que quienes hacen estos estudios de ahora en adelante puedan capturar y registrar la
  información desde la plataforma o incluso desde un agente de texto, y que la información vaya quedando registrada y
  se genere el estudio de manera más automática".
  - Los Excel sirven para entender qué se busca; no se importan ni siguen existiendo.
- **Criterio de salida del MVP:** un estudio real, de una sede nueva, hecho de punta a punta en SIIO, y cuyo informe el
  analista entregaría al cliente sin rehacerlo en Word. "De punta a punta" es captura, revisión, aprobación, informe y
  archivo.

## 1. Lo construido (verificado al 2026-11-05)

| Tramo | Qué hace | PR | Migración | Estado |
|---|---|---|---|---|
| Metodología v1 | Cálculo único en el servidor (detalle abajo). Las variantes históricas solo sirven para recalcular Excel viejos. | #507 | — | desplegado |
| 1. Registrar | Estudio con su cliente, sede, zonas, riesgos, controles y plan de acción (detalle abajo). | #507, #511 | 178 | desplegado |
| 2. Evidencias | Fotos (JPG, PNG, WEBP, HEIC) y PDF de hasta 15 MB, por riesgo o del estudio. El servidor reconoce el tipo por los bytes y guarda el sha256. | #509 | 179 | desplegado |
| Nota de campo | Vig-IA (AGT-003, `agt003.estudios-nota-campo`, 60 al día) propone zonas y riesgos citando la nota. No califica: la persona califica y confirma. | #514 | 181 | desplegado |
| 3. Revisión y aprobación | Preparador → revisor → aprobador. Nadie revisa ni aprueba lo suyo, y eso lo impiden el servidor y la base. La versión se congela con su foto JSON y sha256; reabrir da la versión N+1. | #512 | 180 | desplegado |
| 4. Informe y archivo | Al aprobar se encola el archivo. El servidor de tareas arma el informe Word y PDF con membrete desde la versión congelada, y sube el informe, el JSON y las evidencias a `99_Del_CRM/Estudios_de_Seguridad/<estudio>/v<N>/`. | #526 | 186 | desplegado; el trabajo `estudios-seguridad-archivo` está instalado y corriendo |

**Detalle de la metodología v1:**
- impacto doble, sobre la empresa y sobre las personas; cuenta el mayor;
- control = C·E·Ef/125, con tope de 0,9; baja la probabilidad una sola vez;
- 4 niveles.

**Detalle del tramo 1:**
- Permiso `estudios_seguridad`.
- El cliente sale de Avancys o del CRM; no se escribe a mano.
- La sede es un puesto de Avancys. Si no está, se escribe y queda marcada.
- Los riesgos salen del catálogo del maestro o son propios.

**Operativo: todavía no.** Ningún usuario tiene el permiso y no se ha hecho ningún estudio real. Juan crea los usuarios
(preparador, revisor y aprobador) el 2026-11-06.

## 2. Lo que enseña el informe real de HADA

`ESTUDIO_DE_SEGURIDAD_HADA_-_2026_-_2.0.pdf`, adjunto de Juan del 2026-11-05:
- Título: "Plan Estratégico de Seguridad y Gestión de Riesgos", de octubre de 2026.
- Lo firma el analista de seguridad.
- Es **el producto que el cliente recibe**, y el informe que hoy genera SIIO se queda corto frente a él.

### 2.1 Estructura del informe que se entrega

1. **Portada:** logo del cliente, mes y año, "Plan Estratégico de Seguridad y Gestión de Riesgos", "elaborado por la
   Dirección Nacional de Operaciones y Gestión de Riesgos" y el nombre de la empresa.
2. **Índice.**
3. **Introducción:**
   - descripción del cliente;
   - objetivo, objetivos específicos y alcance;
   - marco legal: Decreto 356 de 1994, Decreto 1072 de 2015, ISO 45001:2018, ISO 31000:2018, Ley 1581 de 2012 y
     Decreto 1377 de 2013;
   - metodología "Management Risk": matriz cruzada de probabilidad × impacto.
4. **Capítulo I-A, caracterización:**
   - contexto externo e interno, con un **mapa satelital** que marca las instalaciones (bodegas, fases);
   - ubicación y vía de aproximación: distancias a puertos, aeropuerto y ciudad, y coordenadas;
   - situación delincuencial, con **fuentes** (INDEPAZ y alertas tempranas de la Defensoría);
   - **estadística de delitos** de la Policía Nacional, con fecha de entrega;
   - grupos delincuenciales del sector;
   - **entidades de apoyo** con teléfonos: Policía, Gaula, Bomberos, Defensa Civil, Cruz Roja y ambulancias;
   - **dispositivo de seguridad**: servicios, horario, si son armados y guía canino;
   - procesos internos del cliente analizados.
5. **Capítulo I-B, diagnóstico:**
   - lista de los riesgos;
   - gráfica del riesgo actual contra el residual, por riesgo;
   - evaluación general;
   - **una ficha por riesgo**, con:
     - escenario físico, proceso y factor de riesgo;
     - calidad, eficacia y eficiencia en palabras, y la efectividad;
     - magnitud actual y residual, con su nivel;
     - **foto de evidencia**;
     - **mapa de calor 5×5 con la posición actual (Rn) y la residual (RnR)**;
     - controles actuales, causas y recomendaciones.
6. **Medición comparativa:** por cada riesgo, el actual, el residual, la reducción en puntos y en porcentaje, y el
   resultado ("disminuye" o "se mantiene").
7. **Capítulo I-C, plan estratégico** en tres ejes:
   - reducir la probabilidad: políticas de control de personal y mejoras;
   - mitigar las consecuencias: protocolos de atención; planes de emergencia, contingencia y continuidad;
   - mantener y controlar la criticidad: indicadores y comités.
8. **Mapa de criticidad general**, actual y residual: matriz 5×5 con todos los riesgos ubicados.
9. **Escalonamiento o cadena de mando**, con los teléfonos de Seguridad Nacional y del interventor del contrato.
10. **Capítulo II:** informes, registro y comunicación; comités bimensuales; cronograma de seguimiento.
11. **Firma del analista de seguridad** que hizo el estudio.

### 2.2 Lo que cambia en el diseño

- **El proceso de cada riesgo es un proceso del cliente**, como Gestión Humana, Comercio Exterior o Producción. No es
  el catálogo de procesos de vigilancia P01–P22 del documento maestro, y se necesitan los dos:
  - el proceso del cliente se escribe en cada estudio;
  - el del catálogo queda como clasificación técnica opcional.
- **Falta el "factor de riesgo"**, por ejemplo "Humano – Procedimental – Estratégico".
- **Las calificaciones se leen en palabras.** Verificado contra los Excel:
  - 2 = "Poco confiable / eficaz / eficiente";
  - 3 = "Medianamente…";
  - 4 = "Confiable / Eficaz / Eficiente";
  - para 1 y 5 no hay ejemplo: `por confirmar`.
- **Las escalas que ve el cliente** son las de la casa:
  - probabilidad: Muy baja, Baja, Media, Alta, Muy alta;
  - impacto: Insignificante, Leve, Moderado, Grave, Catastrófico.

  La v1 usa hoy los nombres del maestro (Rara…; Menor…Crítico). Se cambian **los nombres, no los números ni la
  fórmula**.
- **La caracterización de la sede es parte del estudio**, no un texto suelto. Incluye contexto, fuentes, estadística,
  grupos, entidades de apoyo, dispositivo y mapa. Varias partes salen de fuentes que ya existen:
  - el dispositivo, de los puestos del contrato en Avancys;
  - los teléfonos de Seguridad Nacional, de un directorio de la empresa.
- **El informe lleva las fotos y los mapas de calor dentro.** El generador con membrete de hoy no acepta imágenes, así
  que hay que ampliarlo con imágenes embebidas y celdas de color, sin perder su seguridad: el documento sigue entrando
  como datos, sin XML.
- **Lo que no cambia:**
  - la ficha por riesgo coincide con lo que ya se captura: zona = escenario físico; causas; controles;
    recomendaciones = control propuesto + plan de acción; foto;
  - la metodología v1.

### 2.3 Errores del PDF que el sistema ya evita o debe evitar

- La evaluación general quedó cortada: "la manifestación del riesgo actual es" y nada más.
- Dice "Efectividad: Muy baja" en controles calificados como eficaces y eficientes (R10).
- El residual de R23 está rotulado "R23", no "R23R". R22 tiene dos causas con el número 3.
- La gráfica y la matriz usan la fórmula que cuenta el control dos veces (ver la decisión v1).

## 3. Pendientes del plan anterior

| Pendiente | Decisión |
|---|---|
| Acciones aprobadas → Seguimiento gerencial (`siio_followups`) | Sigue. Es el tramo 8. |
| IA que detecta inconsistencias | Sigue, ampliada con los errores de §2.3. Es el tramo 9. |
| Metodología, plantillas y catálogo en tablas de la base | Se quedan en código versionado: cambiar la regla es una versión nueva con PR, no una edición suelta. |
| Importador de Excel | Descartado por decisión de Juan (2026-11-05). |
| Matriz en Excel como salida | Descartada: la matriz va dentro del informe y en el JSON de la versión. |
| Validación de la v1 por un asesor externo | Sigue pendiente (Juan lo está pidiendo). No bloquea, porque la metodología tiene versión. |
| Retención y acceso de fotos con menores | Descartado: Juan confirmó (2026-11-06) que los estudios no tendrán fotos de menores. Era una precaución del plan, no un requisito de los documentos. |

## 4. Siguientes tramos

Cada tramo es un PR con pruebas, con la migración aplicada antes de fusionar y con su handoff.

**5. Lo que falta capturar.**
- **Entrega:**
  - proceso del cliente y factor de riesgo en cada riesgo;
  - caracterización de la sede: contexto externo e interno, fuentes, estadística de delitos (tabla), grupos, entidades
    de apoyo (tabla de contactos), vía de aproximación, coordenadas y mapa (como evidencia "mapa");
  - dispositivo de seguridad traído de los puestos del contrato en Avancys, con su fuente y editable;
  - logo del cliente (evidencia "logo");
  - escalas con los nombres de la casa y calificaciones en palabras.
- **Prueba de cierre:** un estudio de prueba con todos los capítulos llenos, y el informe toma cada dato de su lugar.

**6. Informe al nivel del de HADA.**
- **Entrega:**
  - generador con membrete ampliado: imágenes embebidas, celdas de color y saltos de página;
  - portada, índice, introducción y marco legal (texto fijo de la plantilla);
  - caracterización, lista de riesgos y gráfica actual/residual;
  - fichas con foto y mapa 5×5;
  - medición comparativa, plan estratégico en tres ejes y mapa de criticidad general;
  - cadena de mando y firma del analista que preparó el estudio.
- **Prueba de cierre:** el informe de un estudio de prueba con los 23 riesgos de HADA sale completo y sin las fallas de
  §2.3, y lo revisa el analista.

**7. Piloto con un estudio real.**
- **Entrega:** los usuarios que Juan crea el 2026-11-06 hacen un estudio real completo, en el celular y en el
  computador. Se corrige lo que salga.
- **Prueba de cierre:** el criterio de salida del MVP (arriba).

**8. Seguimiento gerencial.**
- **Entrega:** al aprobar, cada acción con responsable y fecha crea un seguimiento en `siio_followups`, con el origen
  nuevo `estudio_seguridad`. Cerrar el seguimiento no cierra el riesgo.
- **Prueba de cierre:** los seguimientos aparecen solo después de aprobar, y una sola vez.
- **Hecho (2026-11-06, migración 188):**
  - el seguimiento nace dentro de la transición de aprobar, con `created_role = 'sistema'` y `created_by` igual a quien aprobó;
  - una acción entra una sola vez, por índice único: reaprobar solo agrega las nuevas y no reescribe responsable ni fecha;
  - las acciones sin responsable o sin fecha, y las cumplidas o descartadas, no pasan;
  - la ficha muestra cuántos compromisos hay y cuántos están abiertos.

**9. Revisor IA de inconsistencias.**
- **Entrega:**
  - primero, reglas fijas: riesgo alto sin acción, calificaciones idénticas, nombre de otro cliente en los textos,
    residual que no baja, foto faltante en riesgos altos, efectividad incoherente;
  - después, redacción asistida del plan estratégico y de la evaluación general, siempre como propuesta.
- **Prueba de cierre:** el revisor no cambia estados ni calificaciones (prueba de servidor).

**Orden:**
- El 5 y el 6 van primero: sin ellos el analista tendría que rehacer el informe en Word, que es justo lo que se quiere
  dejar.
- El 7 arranca en cuanto existan los usuarios, sin esperar al 6. Lo que el piloto encuentre entra al 6.

## 5. Principios (sin cambios)

1. SIIO es la fuente de verdad de los datos. SharePoint guarda los originales, las evidencias y los informes. Word y
   PDF son salidas.
2. No se guardan resultados tecleados: se guardan los insumos y el servidor calcula.
3. Se aprueba una versión, no el estudio vivo.
4. Quien prepara no revisa ni aprueba lo suyo.
5. La IA propone; no califica, no aprueba y no cierra riesgos.
6. Una plantilla por tipo de estudio. ESU, CCTV y seguridad electrónica llegan después como plantillas nuevas.
7. Clientes, sedes y puestos vienen de sus fuentes (Avancys, CRM). No se escriben a mano, salvo en un prospecto, y en
   ese caso quedan marcados.
8. Gerencia ve solo lo aprobado.

## 6. Riesgos

- **Sesión de Microsoft delegada (de Juan).** El archivo en SharePoint depende de ella. Si vence, el pedido queda
  fallido con su motivo y se reintenta. La salida definitiva es una identidad de aplicación con consentimiento de
  administrador. `por confirmar`
- **Puente de Vig-IA (AGT-003).** La nota de campo depende de su sesión de Claude, que vence. Si no responde, se
  registra a mano.
- **Metodología v1 sin validar por el asesor.** Si cambia, será una v2, y los estudios aprobados no se recalculan.

## 7. Historia

Los hallazgos del 2026-11-04 sobre los Excel (Cancha Horizontes, HADA, EXCO), el documento maestro y el choque de
fórmulas están en:
- `docs/decisions/2026-11-04-estudios-seguridad-metodologia-v1.md`;
- la versión anterior de este archivo en git: `git log -- docs/plans/2026-11-04-estudios-seguridad-fisica-mvp.md`.
