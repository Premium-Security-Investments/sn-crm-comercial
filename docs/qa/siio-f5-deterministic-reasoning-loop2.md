# SIIO F5 — Motor de lectura gerencial determinística

**Fecha:** 2026-07-14

**Rama:** `feature/siio-main-integration`

**PR:** #12

## Alcance

Primer incremento funcional del F5 — Motor Interno de Razonamiento. El motor consume el snapshot ejecutivo derivado de F2/F4 y produce lecturas auditables. No usa texto generativo, no escribe decisiones y no altera datos de origen.

## Contrato de cada lectura

Cada señal contiene:

- identificador estable;
- frente `F5`;
- prioridad y tono;
- hallazgo;
- evidencia verificable;
- acción recomendada.

Si no existe evidencia suficiente, el motor no emite la lectura.

## Reglas iniciales

1. **Validación financiera pendiente**
   - Se activa cuando alguna métrica del periodo no tiene `validated_by`.
   - Recomienda validación humana antes de Modo Junta.
2. **Presión de costos**
   - Se activa cuando la variación porcentual de costos supera la de ingresos.
3. **Deterioro no operacional**
   - Se activa cuando el resultado no operacional es negativo y su variación absoluta también es negativa.
4. **Diferencia de control en nómina**
   - Se activa cuando los agregados del periodo contienen una o más alertas de fuente.

Con el snapshot vigente, las cuatro reglas se activan. Las cifras financieras continúan marcadas como pendientes de validación humana.

## Integración visual

- Panel `F5 · Lectura gerencial automática` en el Resumen Ejecutivo.
- Cada tarjeta presenta evidencia y acción recomendada.
- Vista propia `Motor de razonamiento` actualizada a estado activo.
- Diseño responsivo en dos columnas y una columna móvil.
- No se exponen datos personales de nómina.

## Verificación

```text
node scripts/check_siio_executive_snapshot.mjs       PASS
node tests/siio-executive-dashboard-static.test.mjs  PASS
npm run check:permissions                            PASS
npm run build                                        PASS
Pruebas *.test.mjs                                   32 PASS / 1 FAIL heredado
```

La prueba heredada fallida continúa siendo `tests/tender-company-profile-editable-static.test.mjs`; también falla en `main` y no está relacionada con SIIO.

## Límites vigentes

- El motor recomienda; no aprueba ni ejecuta decisiones.
- No reemplaza la validación financiera ni de Gestión Humana.
- No genera todavía histórico de señales en base de datos.
- No se desplegó la aplicación a producción.
