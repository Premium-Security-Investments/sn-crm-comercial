# Decisión — Estudios de Seguridad: la metodología de la guía de calificación

- **Fecha:** 2026-11-11
- **Decide:** Juan Botero (Innovación/SIIO)
- **Reemplaza, para los estudios nuevos:** `2026-11-04-estudios-seguridad-metodologia-v1.md`. Los estudios que ya existieran conservarían su metodología; hoy no hay ninguno.

## Contexto
El equipo de riesgos entregó la «Guía de calificación de la matriz de riesgos 5 × 5 y evaluación de controles» de la sede Medellín, firmada por el analista de riesgos en noviembre de 2026. Juan decidió:

- "todo lo que nos respondieron en la guía esas ya son las respuestas";
- "vamos con el de 3 niveles";
- "si la guía ya dice que es 1 vamos con 1".

## La regla (`guia-calificacion-2026`, en `verticales/estudios-seguridad/metodologia.js`)
- **Probabilidad e impacto:**
  - la **probabilidad actual** la escoge el analista (1 a 5);
  - hay **un solo impacto** (1 a 5): Muy leve, Leve, Moderado, Grave y Crítico.
- **Valoración inicial:** probabilidad × impacto.
- **Efectividad del control:** calidad × eficacia × eficiencia ÷ 125. No tiene tope.
  - Nombres de las calificaciones: 1 = No confiable / Ineficaz / Ineficiente; 5 = Altamente confiable / Altamente eficaz / Altamente eficiente.
- **Riesgo actual:** ⌈valoración inicial × (1 − efectividad)⌉. El control se descuenta **una vez**, sobre la magnitud. Mínimo 1.
- **Riesgo residual:** probabilidad residual (la escoge el analista) × impacto.
  - Es una estimación.
  - Sin probabilidad residual, el residual es el actual.
- **Niveles:**
  - **aceptable:** 1 a 6;
  - **tolerable:** 7 a 14;
  - **inaceptable:** 15 a 25.
- **Prioridad en el informe:**
  - inaceptable → atención preferente;
  - tolerable → intervención programada;
  - aceptable → mantenimiento preventivo.
- **Plan de acción:** un riesgo inaceptable sin acción con responsable y fecha no se puede enviar a revisión.

## Lo que queda distinto de las hojas de cálculo del equipo
Las hojas de HADA, EXCO y Medellín descuentan el control dos veces: primero sobre la probabilidad y luego sobre la magnitud. La guía describe la regla con una sola vez, y Juan tomó la guía como la respuesta.

**Ejemplo:** con probabilidad 5, impacto 5 y control 3/3/3, la guía da 20 y la hoja de Medellín da 16.

## Flujo y firma (Juan, 2026-11-11)
- **Prepara:** el analista de riesgos.
- **Revisa:** el coordinador.
- **Aprueba:** el jefe de operaciones, que es quien firma el informe.
- El informe dice quién elaboró, quién revisó y quién aprobó.

## Seguimiento gerencial
Solo pasan las acciones a cargo de Seguridad Nacional (campo `responsible_party`, migración 205). Las del cliente se quedan en el plan del informe.

## Ajustes según la norma IEC 31010 (Juan, 2026-11-11: "vamos a regirnos por la norma")
Salen del estudio de la NTC-IEC/ISO 31010, adopción de IEC 31010:2019. El detalle y las fuentes están en el handoff `2026-11-11-AGT-000-estudios-seguridad-iec-31010`.

- **Impacto 5:** con impacto 5 (crítico), el nivel mínimo es **tolerable** y no se envía a revisión sin un plan de contingencia (una acción con responsable y fecha), aunque sea poco probable.
  - Se ajustó la metodología `guia-calificacion-2026` en su lugar, porque no había ningún estudio calculado con ella.
- **Escala de probabilidad anclada**, por frecuencia en la sede y antecedentes en la zona:
  - 1, no ha ocurrido en la sede y no hay antecedentes en la zona;
  - 2, hay antecedentes en la zona, pero no en la sede en el último año;
  - 3, ocurrió una vez en el último año;
  - 4, varias veces;
  - 5, casi todos los meses.
- **Probabilidad sugerida por los datos:**
  - fuentes: la estadística de delitos del estudio y las novedades de SecurityOps del puesto en 12 meses;
  - si el analista se aparta, escribe por qué;
  - se guardan la sugerida y la escogida;
  - sin datos, queda como "juicio sin dato".
- **Confianza y supuestos:** cada riesgo declara su confianza (alta, media o baja) y sus supuestos.
- **Revisor automático:** señala los riesgos graves sin dato de respaldo o con confianza baja.
- **Informe:**
  - cita la NTC-ISO 31000:2018 y la NTC-IEC/ISO 31010, aclarando que son guías y que el documento no es una certificación;
  - presenta la magnitud como orden y no como medida exacta.
