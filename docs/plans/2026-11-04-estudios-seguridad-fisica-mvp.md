# Estudios de Seguridad Física en SIIO — plan del MVP

- **Fecha:** 2026-11-04
- **Pedido por:** Juan Botero
- **Estado:** propuesto. No hay código, migraciones ni despliegue. Este documento es solo el plan.
- **Objetivo:** que un estudio de seguridad física se haga de principio a fin en SIIO, y que el Excel
  quede solo como formato para importar lo histórico y para entregar copias.

## 0. El objetivo, en palabras de Juan (2026-11-05)

> "El objetivo es que quienes hacen estos estudios de ahora en adelante puedan capturar y registrar la información
> desde la plataforma o incluso desde un agente de texto, y que la información vaya quedando registrada y se
> genere el estudio de manera más automática."

Consecuencias para el orden de trabajo:

- **Lo primero es la captura, no la importación.** El tramo 1 es crear un estudio y registrar sede, zonas,
  riesgos, controles y fotos desde la plataforma, para el estudio nuevo de la próxima visita.
- **El agente de texto es otra puerta de entrada a los mismos datos.** El inspector escribe o dicta lo que vio
  ("en la bodega 3 la malla está rota, no hay cámara"); el agente lo convierte en una propuesta de zona, riesgo,
  control o evidencia; la persona la confirma y queda registrada. Es el patrón del chat de Vig-IA comercial
  (AGT-003): el agente propone y no califica ni aprueba solo.
- **El estudio se genera, no se escribe.** Matriz, plan de acción e informe salen de lo registrado.
- **Los Excel no se importan ni siguen existiendo** (Juan, 2026-11-05: "los Excel son la base para entender lo
  que se busca con ellos, pero no es que los Excel sigan existiendo"). Cancha Horizontes, HADA y EXCO sirven
  de referencia de diseño: qué campos lleva un estudio, cómo es la ficha por riesgo, qué fotos se toman y qué
  trae el plan de acción. También sirven de casos de prueba del cálculo. No hay importador en el MVP, y las
  secciones 5 y 9 (F2) de este plan quedan sin efecto. La matriz sale como parte del informe, no como un Excel
  de trabajo.

Orden de tramos (sustituye al de las fases F2 a F7 en lo que choque):

1. Captura en la plataforma: estudio, sede, zonas, riesgos, controles, acciones y fotos, con el cálculo de la v1.
2. Captura por agente de texto, con confirmación humana.
3. Revisión, aprobación y versión congelada.
4. Generación del informe (con su matriz y su plan de acción), archivo en SharePoint y seguimiento en SIIO.

## 1. Lo que muestran los documentos de referencia

Revisé los dos archivos de la carpeta de OneDrive "Estudios de Seguridad" (personal de Juan Botero),
bajados por Graph el 2026-11-04:

| Archivo | sha256 |
|---|---|
| `CANCHA_HORIZONTES_MATRIZ_RIESGOS_2026.xlsx` (208.639 B) | `6f1ef67c443e2492fac7e0f9fab2448dbee718c218f5d00a6e704a4958fe206d` |
| `DOCUMENTO MAESTRO DE RIESGOS ESU 2026.docx` (779.350 B) | `cff1ca17f8787c5040b0d1ad07c72e58ab5358c9840caead7335931e1275c887` |

### 1.1 Matriz de Cancha Horizontes (31 hojas)

Estructura: `HOJA DE TRABAJO` (25 riesgos), `Plan de acción`, `Estadisticas`, una ficha por riesgo
(`R1`…`R25`), un mapa de calor (`Riesgo Act Cs Res`), unas listas sueltas (`Hoja1`) y
`ALCANCE Y CRITERIOS`.

**La metodología está en las fórmulas, y es consistente.** Volví a calcular los 25 riesgos fuera del
Excel y coinciden todos:

- Calificación del control = calidad × eficacia × eficiencia / 125 (cada factor de 1 a 5).
- Probabilidad actual = ⌈P × (1 − control actual)⌉.
- Magnitud = probabilidad × impacto.
- Probabilidad residual = máx(1, ⌈P actual × (1 − control propuesto)⌉), con el impacto sin cambios.
- Aceptabilidad: menos de 7 es aceptable, de 7 a 14 tolerable, 15 o más inaceptable.

**La identidad del documento está contaminada:**

- El título del plan de acción dice "CRONOGRAMA DE CUMPLIMIENTO AL PLAN ESTRATÉGICO **PANASA**".
- `ALCANCE Y CRITERIOS` dice "Unidad Deportiva **Barrio Cristóbal**" y "Unidad Deportiva **La Floresta**".
  Recién en la fila 35 nombra a Cancha Horizontes.
- Las filas 28 a 43 del plan de acción tienen `#REF!`, ceros y fechas de "octubre de 2050" a "2065".
- Las filas 28 a 42 de la hoja de trabajo son 15 filas fantasma: valen cero y todas tienen el código
  `R17R`. El mapa de calor general solo muestra ese `R17R`.
- En la columna "PROCESO" está el nombre de la sede, no un proceso.
- Las fichas tienen `G2 = #REF!` y el recuadro "FOTO DE EVIDENCIA" vacío. El libro trae una sola imagen.

**El contenido es plantilla, no hallazgo.** La propia hoja de alcance lo advierte: las causas son
"escenarios posibles, no hallazgos verificados", los controles son "medidas de referencia, no ejecución
confirmada" y las valoraciones son "estimaciones de trabajo sujetas a contraste con inventario y visita
técnica". Se nota en los datos:

- Los 25 controles actuales tienen la misma calificación (2/2/2) y los 25 propuestos también (4/4/4).
- Los textos siguen un molde repetido ("2. Asignar responsable de <control>. 3. Registrar la aplicación
  de <control>…").
- El seguimiento de los 25 riesgos dice "Pendiente de validación" y la fecha, "Por programar".

Consecuencia de diseño: al importar, todo entra como **propuesto, sin verificar**. Nada del Excel
histórico entra como control existente comprobado.

### 1.2 Documento maestro ESU 2026

Es la base técnica del contrato ESU (INDER, Plaza Mayor e instituciones educativas). Aporta lo que la
matriz no tiene:

- marco normativo (NTC-ISO 31000:2018, IEC/ISO 31010, Decreto Ley 356 de 1994);
- **22 procesos** (P01 a P22), cada uno con su objetivo de control y su tipología;
- **26 riesgos de catálogo** (R01 a R26), cada uno asociado a procesos;
- cinco tipologías (T1 a T5), con sus matrices priorizadas e indicadores de seguimiento;
- la delimitación de lo que la vigilancia controla y lo que solo reporta;
- la cadena que exige: proceso → punto crítico → riesgo → control → indicador → evidencia → riesgo
  residual.

**Choca con la matriz en la metodología:**

| | Matriz Cancha Horizontes | Documento maestro |
|---|---|---|
| Riesgo inherente | P × I | P × máx(impacto A empresa, impacto B personas) |
| Efecto del control | baja la **probabilidad**: ⌈P(1 − C·E·Ef/125)⌉ | baja la **magnitud**: inherente × (1 − eficacia de 0 a 0,9) |
| Niveles | <7 / 7–14 / ≥15 (3 niveles) | 1–5 / 6–10 / 11–15 / 16–25 (4 niveles) |

Con el mismo riesgo salen resultados distintos. El R21 (hurto de implementos, P4 × I4) da en la matriz
16 inaceptable → 8 tolerable. Con el maestro y la misma eficacia (0,512) da 16 crítico → 7,8 moderado.

**El sistema no puede tener dos fórmulas sin dueño.** La metodología se guarda como un dato versionado,
y cada estudio queda amarrado a la versión con la que se calculó.

**Decidido el 2026-11-04:** la metodología oficial es `instalaciones-fisicas-v1`. Mezcla las dos fuentes:

- del maestro, el impacto doble y los cuatro niveles;
- de la matriz, la calificación del control (con tope de 0,9) y que el control baje la probabilidad.

Ver `docs/decisions/2026-11-04-estudios-seguridad-metodologia-v1.md`.

### 1.3 Dos estudios reales: HADA International y EXCO Colombiana

Los compartió Juan el 2026-11-04 por adjunto, no por SharePoint. Usan la misma plantilla de 31 hojas, pero
son trabajo real, no plantilla:

- las calificaciones de los controles varían de un riesgo a otro;
- los procesos son de la empresa (gestión humana, TI, comercio exterior, producción);
- HADA trae una foto de la visita por cada ficha de riesgo;
- los planes de acción tienen fechas (de diciembre de 2026 a febrero de 2027).

Lo que cambian para el diseño:

- **Otra variante de fórmula, que cuenta el control dos veces.** Ver la decisión v1, sección "Hallazgo
  posterior".
- **Contaminación también en estudios reales.** El plan de acción de EXCO se titula "…PLAN ESTRATÉGICO
  PANASA". EXCO tiene 28 filas vacías (R8 a R35) con el código `R1R` y fechas de "octubre de 2032"; el
  archivo se llama "SEPT 2026", pero su encabezado dice "ENERO 2026".
- **Un dato tecleado encima de la fórmula:** en EXCO R3 la probabilidad actual quedó mayor que la inherente.
- **El alcance va más allá de la seguridad física.** HADA incluye riesgos de TI, comercio exterior y
  seguridad y salud en el trabajo. La plantilla "Instalaciones físicas v1" los admite como procesos del
  catálogo, pero conviene marcarlos como fuera del núcleo físico. `por confirmar`
- **Las fotos son evidencia de verdad.** El importador debe extraer la imagen de cada ficha `R<n>` y vincularla
  a su riesgo.

## 2. Principios

1. **SIIO es la fuente de verdad** de los datos estructurados y de los estados. SharePoint guarda los
   originales, las evidencias y los informes finales. Word, PDF y Excel son salidas.
2. **No se guardan resultados tecleados.** Se guardan los insumos (P, I, calificaciones). Magnitud,
   nivel y residual se calculan con la versión de la metodología y quedan congelados en la versión
   aprobada.
3. **Se aprueba una versión, no el estudio vivo.** Una vez aprobada, la versión es inmutable. Corregir
   algo abre la versión N+1.
4. **Separación de funciones:** quien prepara no revisa ni aprueba su propio estudio.
5. **La IA propone, no decide.** Redacta y señala inconsistencias. Lo que aporta queda marcado como
   "propuesta IA". No cambia estados, no califica y no cierra riesgos.
6. **Una plantilla por tipo de estudio.** El MVP trae solo "Instalaciones físicas v1". ESU, CCTV,
   seguridad electrónica y las demás llegan después como plantillas nuevas, no como columnas nuevas.
7. **Gerencia ve solo lo aprobado.** Al seguimiento SIIO pasan las acciones y los hallazgos de una
   versión aprobada, no el estudio técnico.

## 3. Modelo de datos

Prefijo `psi_security_`, como las demás tablas del CRM. Todas con RLS.

| Tabla | Para qué |
|---|---|
| `psi_security_methodologies` | Versión de la metodología: escalas de probabilidad e impacto con sus descripciones, fórmula del control, cómo se aplica el residual y umbrales de nivel. Inmutable cuando un estudio la usa. |
| `psi_security_templates` | Plantilla, por ejemplo "Instalaciones físicas v1": secciones obligatorias, metodología por defecto y textos del informe. |
| `psi_security_catalog_processes` / `psi_security_catalog_risks` | Catálogo de la plantilla (P01–P22 y R01–R26 del maestro como semilla, filtrados por tipología), con controles mínimos y evidencia mínima sugerida. |
| *(sin tabla de clientes ni de sedes)* | **No se capturan clientes, sedes, puestos ni contratos** (Juan, 2026-11-05): ya están en las fuentes conectadas a SIIO. El estudio solo guarda referencias, con fuente declarada, según [[fuente-por-dato]]: el cliente y el contrato vienen de **Avancys**, donde nace el NIT; la sede o el puesto, de **SIIO Programación** (`programacion.puestos`, que tiene `cliente_id`), y si el estudio es para un prospecto que aún no es cliente, de la **oportunidad del CRM**. La única dirección o sede que se escribe a mano es la de un prospecto sin oportunidad, y queda marcada. Qué expone Avancys sobre contratos: `por confirmar`. |
| `psi_security_studies` | El estudio: cliente, sede, plantilla, metodología, estado, preparador, revisor, aprobador, alcance, metodología aplicada y fechas de visita. |
| `psi_security_study_zones` | Caracterización: activos y zonas críticas (el "escenario físico" del Excel). |
| `psi_security_study_risks` | Riesgo del estudio: código local, riesgo de catálogo, zona, proceso, enunciado causal (causa → evento → consecuencia), causas, P e I, origen (`importado`, `manual`, `propuesta_ia`) y estado de verificación. |
| `psi_security_study_controls` | Control existente de cada riesgo: descripción, calidad, eficacia, eficiencia, `verificado` y evidencia de soporte. |
| `psi_security_study_actions` | Plan de tratamiento: acción, control propuesto con su calificación, responsable, fecha compromiso y estado. |
| `psi_security_study_evidence` | Evidencia: archivo con id de SharePoint y sha256, tipo, vínculo a zona, riesgo o control, quién la tomó y cuándo. |
| `psi_security_study_events` | Bitácora de solo inserción: creado, importado, enviado a revisión, observación, devuelto, revisado, aprobado y archivado, con actor y fecha. |
| `psi_security_study_versions` | Versión congelada: snapshot JSON, sha256, metodología usada, archivos generados (matriz, plan, informe) y sus ids de SharePoint. |
| `psi_security_import_runs` | Cada importación: Excel original con sha256, mapeo aplicado, filas aceptadas y descartadas, y advertencias. |

El cálculo (control, magnitud, nivel y residual) vive en **una sola función pura del servidor**, con
pruebas, más una función SQL equivalente para las vistas. El cliente nunca calcula.

## 4. Estados, roles y permisos

```
borrador → en_revision → (devuelto → en_revision)* → revisado → aprobado (versión N) → archivado
aprobado → reabierto → versión N+1 en borrador
```

- **Permiso nuevo `estudios_seguridad`**, como `licitaciones`: da acceso al módulo. El rol dentro del
  estudio lo da la asignación al estudio (preparador, revisor o aprobador), no un rol global.
- **Preparador / inspector:** crea, importa, edita, adjunta evidencias y envía a revisión.
- **Revisor técnico:** comenta, devuelve o marca como revisado. Valida metodología, valoración y
  controles. No puede ser el preparador.
- **Aprobador:** aprueba una versión revisada y autoriza el informe. No puede ser el preparador.
- **Gerencia / SIIO:** no entra al estudio. Recibe en `siio_followups` las acciones aprobadas.
- Bloqueos de servidor, no solo de pantalla:
  - no se envía a revisión si falta alcance, sede o metodología, o si hay riesgos sin P o I;
  - no se aprueba con riesgos inaceptables sin acción con responsable y fecha;
  - una versión aprobada no se edita.

## 5. Importar un Excel histórico

Cancha Horizontes es el caso de prueba, no el modelo.

1. Se sube el `.xlsx`. Se guarda el original en SharePoint y se registra su sha256 en
   `psi_security_import_runs`.
2. Las columnas se reconocen **por encabezado**, no por posición: COD RIESGO, ESCENARIO, NOMBRE DEL
   RIESGO, CAUSAS, PROB, IMP, DESCRIPCIÓN DEL CONTROL, CALIDAD, EFICACIA, EFICIENCIA, RECOMENDACIONES y
   los controles propuestos.
3. Se descartan con motivo las filas sin nombre de riesgo, con códigos repetidos o con todo en cero
   (las 15 filas `R17R` de Cancha Horizontes).
4. Advertencias que se muestran antes de aceptar:
   - nombres de cliente o sede distintos entre hojas (PANASA, Barrio Cristóbal, La Floresta);
   - `#REF!`;
   - fechas fuera de rango;
   - calificaciones idénticas en todos los riesgos;
   - resultados del Excel que no coinciden con el recálculo.
5. Todo lo importado entra como `importado`, con los controles en `verificado = false`.
6. Pantalla de revisión: tabla de lo extraído con sus advertencias. Se acepta, se corrige o se descarta
   fila por fila antes de crear el estudio.

## 6. Salidas y archivo

- **Matriz** `.xlsx` generada desde la versión, con los valores ya calculados. Es una copia, no se
  vuelve a importar.
- **Plan de acción** dentro de la matriz y en el informe.
- **Informe Word y PDF** con el renderizador ya existente
  (`agt002-document-render`: membrete corporativo, documento como datos y conversión con `soffice`).
  Tiene ficha por riesgo, mapa de calor actual y residual, y fotos de evidencia.
- **Archivo en SharePoint**, en `Estudios de Seguridad/<cliente>/<sede>/<código estudio>/v<N>/`: original
  importado, evidencias, matriz, informe y `manifest.json` con los sha256. Se hace readback de cada
  archivo y se falla cerrado si SharePoint no responde, como `agt002-knowledge-sharepoint`.

## 7. Seguimiento en SIIO

Al aprobar la versión N, cada acción aprobada crea un registro en `siio_followups` con:

- origen nuevo `estudio_seguridad`;
- `origin_ref` = id de la acción;
- responsable, fecha y título.

Cerrar ese seguimiento no cierra el riesgo. El riesgo solo se recalifica en una versión nueva del
estudio, con evidencia.

## 8. IA en el MVP

Va en este orden y siempre como propuesta:

1. **Inconsistencias**, con reglas deterministas primero y modelo después:
   - riesgo sin control;
   - control sin evidencia marcado como verificado;
   - calificaciones idénticas en todo el estudio;
   - nombre de otro cliente en los textos;
   - acción sin responsable;
   - residual que sube.
2. **Sugerir riesgos del catálogo** según la tipología y las zonas.
3. **Redactar** el enunciado causal y la narrativa del informe. Lo redactado queda marcado como
   propuesta IA y lo acepta una persona.

## 9. Fases

Cada fase es un PR con pruebas y su propio handoff.

| Fase | Entrega | Prueba de cierre |
|---|---|---|
| F0 | Decisiones: metodología oficial (**hecha el 2026-11-04**), quiénes revisan y aprueban, carpeta de SharePoint. | Decisión escrita en `docs/decisions/`. |
| F1 | Migración del modelo, función de cálculo (**escrita el 2026-11-04**: `verticales/estudios-seguridad/metodologia.js`) y semilla de la plantilla "Instalaciones físicas v1" con su catálogo. | Prueba dorada: los 25 riesgos de Cancha Horizontes recalculados = valores del Excel (ya verificado fuera del código el 2026-11-04). Pruebas de RLS con pglite. |
| F2 | Importador y pantalla de revisión. | Importar Cancha Horizontes da 25 riesgos, 15 filas descartadas y las advertencias de identidad. |
| F3 | Edición del estudio: sede, zonas, riesgos, controles y acciones, más subida de evidencias. | Prueba de punta a punta en local. |
| F4 | Revisión, aprobación y versiones congeladas. | El preparador no puede aprobar, una versión aprobada no se edita y reabrir crea la N+1. |
| F5 | Matriz, informe Word/PDF y archivo en SharePoint con readback. | sha256 iguales al releer y Word válido. |
| F6 | Acciones aprobadas → `siio_followups`. | Aparecen en Seguimiento gerencial solo después de aprobar. |
| F7 | Asistente IA (inconsistencias y redacción). | No puede cambiar estado ni calificaciones (prueba de servidor). |

**Criterio para decir que se dejó de depender de Excel:** un estudio real, en una sede nueva, hecho de
punta a punta en SIIO, aprobado y archivado, sin editar ningún Excel en el camino.

## 10. Fuera del MVP

- Plantillas ESU, CCTV y seguridad electrónica.
- Captura sin conexión en campo.
- Firma digital.
- Portal para el cliente.
- Importación masiva de estudios históricos (por ahora, uno por uno).

## 11. Riesgos

- **La sesión de Graph es delegada (de Juan).** Para que SIIO archive en SharePoint sin nadie presente
  hace falta una identidad de aplicación con consentimiento de administrador del tenant. Mientras no
  exista, el archivo se puede hacer con la sesión actual en piloto, pero no en producción. `por confirmar`
- **Metodología:** decidida (v1). Falta que la valide un revisor técnico de seguridad. `por confirmar`
- **El maestro es específico del contrato ESU.** Sus tipologías T1 a T5 sirven de semilla, pero la
  plantilla "Instalaciones físicas" necesita su propia tipología genérica. `por confirmar`
- **Evidencias con personas o menores (P16/R25):** antes de guardar fotos hay que definir retención y
  acceso. `por confirmar`
