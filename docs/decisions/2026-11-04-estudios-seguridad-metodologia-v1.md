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
