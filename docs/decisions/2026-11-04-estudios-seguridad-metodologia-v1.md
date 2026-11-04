# Metodología oficial v1 — Estudios de Seguridad Física

- **Estado:** aprobada por Juan Botero el 2026-11-04 ("Ok haga eso"). La validación por un revisor técnico de
  seguridad está pendiente: `por confirmar`.
- **Id:** `instalaciones-fisicas-v1`
- **Código:** `verticales/estudios-seguridad/metodologia.js`
- **Prueba:** `tests/estudios-seguridad-metodologia.test.mjs`
- **Plan:** `docs/plans/2026-11-04-estudios-seguridad-fisica-mvp.md`

## Por qué

La matriz de Cancha Horizontes y el documento maestro ESU 2026 valoran el riesgo con fórmulas distintas y dan
resultados distintos para el mismo riesgo (ver el plan, §1.2). SIIO necesita una sola fórmula, con dueño y con
versión.

## La regla

| Paso | Regla | De dónde viene |
|---|---|---|
| Impacto | Se califican dos impactos de 1 a 5, sobre la empresa o sede (A) y sobre personas y terceros (B). Cuenta el mayor. | Documento maestro |
| Inherente | probabilidad (1–5) × impacto | Ambos |
| Efectividad del control | calidad × eficacia × eficiencia / 125 (cada factor de 1 a 5), **con tope de 0,9**. Sin control vale 0. | Matriz, con el tope del maestro |
| Riesgo actual | probabilidad actual = máx(1, ⌈P × (1 − control existente)⌉), y magnitud = probabilidad actual × impacto | Matriz |
| Riesgo residual | probabilidad residual = máx(1, ⌈probabilidad actual × (1 − control propuesto)⌉), y magnitud = esa probabilidad × impacto | Matriz |
| Niveles | 1–5 bajo · 6–10 moderado · 11–15 alto · 16–25 crítico | Documento maestro |

El control baja la probabilidad y no la magnitud. Así el riesgo actual y el residual siempre caen en una
casilla del mapa de calor 5×5.

## Consecuencias

- Cada estudio queda amarrado a `instalaciones-fisicas-v1`. Cambiar la regla crea la v2, y los estudios
  aprobados no se recalculan.
- Al importar un Excel histórico, su único impacto se toma igual para A y para B, y el revisor los separa.
  Las magnitudes de Cancha Horizontes no cambian; solo cambia el nombre del nivel. Por ejemplo, el R21 pasa
  de 16 inaceptable → 8 tolerable a 16 crítico → 8 moderado.
- La fórmula histórica queda en el código como `matriz-historica-2026`. No es oficial: el importador la usa
  para avisar cuando un Excel no coincide con sus propias fórmulas.

## Hallazgo posterior (2026-11-04): los estudios reales cuentan el control dos veces

Juan compartió dos estudios reales entregados:

- `MATRIZ_HADA_COMPLETA_7.0.xlsx`: HADA International, enero de 2026, 23 riesgos y una foto de visita por riesgo.
- `EXCO_COLOMBIANA_SEPT._2026_2.0.xls`: EXCO Colombiana, enero de 2026, 7 riesgos.

Usan otra variante de la plantilla:

- probabilidad actual = ⌈P × (1 − control)⌉, igual que la v1;
- magnitud actual = ⌈probabilidad actual × (1 − control) × I⌉, es decir, **el mismo control se descuenta dos
  veces**.

En el código queda como `matriz-historica-control-doble-2026` y reproduce HADA (23 de 23) y EXCO (6 de 7).

La v1 descuenta el control una sola vez. Por eso, para la misma calificación, da un riesgo actual igual o más
alto que el que se les entregó a esos clientes; el residual no cambia. En HADA, el Excel marca 2 riesgos
inaceptables y con la v1 quedan 3 críticos: R5, R12 y R18.

**Se mantiene la v1** (confirmado por Juan el 2026-11-04, ver abajo). Descontar dos veces el mismo control subestima el riesgo: una sede se ve más segura de
lo que está. Los estudios nuevos no son comparables uno a uno con los entregados antes de la v1.

El riesgo de EXCO que no coincide es el R3: su probabilidad actual (5) se tecleó encima de la fórmula y quedó
por encima de la inherente (4). Un control no puede subir la probabilidad: con la fórmula del propio Excel da
13 tolerable y no 16 inaceptable.

## Una sola forma de trabajar (Juan, 2026-11-04)

> "La idea de esto es que tengamos una versión flexible pero que se vuelva la regla, es decir que ya poco a poco
> dejemos de tener 3 versiones de estudio y que cada persona cree su matriz y tengamos una sola forma de trabajar."

Hoy hay tres variantes de la misma plantilla (Cancha Horizontes, HADA y EXCO), cada una con su propia fórmula.
La v1 es la única regla de aquí en adelante. Esto se traduce en límites del sistema:

- **Fijo, nadie lo cambia en un estudio:**
  - la fórmula, las escalas y los niveles;
  - los campos obligatorios;
  - los estados y quién aprueba;
  - la estructura del informe.
  
  En SIIO no hay celdas con fórmula que se puedan sobrescribir: el cálculo lo hace el servidor.
- **Flexible, cada estudio lo adapta:**
  - las zonas y los activos de la sede;
  - qué riesgos del catálogo aplican;
  - los riesgos propios que no estén en el catálogo, que quedan marcados para que el revisor decida si pasan al catálogo;
  - los controles, las acciones, la narrativa y las evidencias.
- **La regla cambia solo por versión:** una v2 la propone el revisor técnico, la aprueba Juan y se aplica a los
  estudios nuevos. Los aprobados no se recalculan.
- **Lo histórico se lee, no se copia:** al importar un Excel viejo se guarda lo que se le entregó al cliente, con
  su variante (`matriz-historica-2026` o `matriz-historica-control-doble-2026`), y al lado su valor con la v1. Un
  estudio nuevo nunca nace de copiar un Excel: nace de la plantilla.
