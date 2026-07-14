# SIIO Executive Dashboard — Loop 1 Verification

**Fecha:** 2026-07-14 00:53 UTC  
**Rama:** `feature/siio-main-integration`  
**PR:** #12  
**Producción:** sin cambios  
**Supabase:** migración/seed 016 preparada, no aplicada

## Objetivo verificado

Convertir los tres archivos históricos de Junta en un flujo inicial para el Dashboard Gerencial permanente:

- `SRC-011` — PYG abril 2026: fuente financiera.
- `SRC-012` — nómina administrativa junio 2026: fuente sensible, solo agregados.
- `SRC-013` — presentación abril 2026: referencia/salida histórica, no fuente de verdad.

## Artefactos

- `scripts/extract_siio_board_sources.py`
- `tests/siio-board-source-extractor.test.py`
- `data/siio/board_snapshot_financial_2026-04_payroll_2026-06.json`
- `supabase/migrations/016_siio_initial_executive_snapshot_seed.sql`
- `src/siioExecutive.ts`
- `scripts/check_siio_executive_snapshot.mjs`
- `tests/siio-executive-dashboard-static.test.mjs`
- Dashboard F2 actualizado en `src/main.tsx` y `src/styles.css`

## Snapshot real redacted

- Métricas financieras: 9.
- Áreas de nómina: 12.
- Personas representadas únicamente en agregado: 157.
- Campos de identidad emitidos: 0.
- Compensaciones individuales emitidas: 0.
- Diferencias de control detectadas: 1 (`Agencia Medellin`, total de origen vs. devengado menos deducciones).
- La diferencia se conserva como alerta para revisión; el neto mostrado se calcula determinísticamente.

## Dashboard implementado

- Resumen ejecutivo permanente.
- Periodo financiero y periodo de nómina separados.
- Ingresos, utilidad operacional, utilidad neta y margen neto.
- Nómina agregada por área.
- Alertas de calidad de datos.
- Vigencia y confianza de las fuentes F4.
- Lectura gerencial de registros, decisiones y bloqueos.
- Franja compacta con F1–F6 oficiales.
- `Modo Junta` separado como vista/salida del Dashboard.
- Estado explícito `pendiente de validación financiera` cuando corresponda.
- Estado `sin datos publicados` mientras 016 no esté aplicada; no se muestran ceros engañosos.

## Evidencias mecánicas

```text
npm run check:permissions                         PASS
python3 tests/siio-board-source-extractor.test.py PASS (3/3)
node tests/siio-executive-dashboard-static.test.mjs PASS
npm run build                                     PASS
Pruebas *.test.mjs                                32 PASS / 1 FAIL heredado
```

La única prueba fallida es `tests/tender-company-profile-editable-static.test.mjs`, por el literal `Cargar RUP actualizado`. La misma prueba falla en `main`; no es regresión de este loop.

## Gates pendientes

1. **Gate DB:** aprobar o rechazar aplicación de migración 016 en Supabase producción.
2. **Validación financiera:** confirmar cifras y periodos con el responsable financiero.
3. **Control nómina:** revisar la diferencia agregada de Agencia Medellín en el archivo fuente.
4. **QA autenticado:** ejecutar matriz por roles cuando Juan decida retomarlo.
5. **Gate merge/deploy:** PR #12 continúa draft; no merge ni deploy productivo sin aprobación.
