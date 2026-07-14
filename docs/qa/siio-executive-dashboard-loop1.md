# SIIO Executive Dashboard — Loop 1 Verification

**Fecha:** 2026-07-14 01:07 UTC

**Rama:** `feature/siio-main-integration`

**PR:** #12

**Producción:** Supabase migración 016 aplicada; aplicación Vercel productiva sin deploy

**Supabase:** migración/seed 016 aplicada y verificada el 2026-07-14 01:07 UTC

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
- Mientras 016 no estuviera aplicada, la interfaz mostraba `sin datos publicados`; después de su aplicación consume el snapshot real sin usar ceros engañosos.

## Evidencias mecánicas

```text
npm run check:permissions                         PASS
python3 tests/siio-board-source-extractor.test.py PASS (3/3)
node tests/siio-executive-dashboard-static.test.mjs PASS
npm run build                                     PASS
Pruebas *.test.mjs                                32 PASS / 1 FAIL heredado
```

La única prueba fallida es `tests/tender-company-profile-editable-static.test.mjs`, por el literal `Cargar RUP actualizado`. La misma prueba falla en `main`; no es regresión de este loop.

## Aplicación de migración 016

Autorizada por Juan y ejecutada mediante la RPC administrativa `exec_sql`, en una sola transacción PostgreSQL.

Respaldo previo:

```text
/root/psi-comercial/backups/siio/016_preapply_20260714T005900Z.json
SHA-256: a72a161dbda19c43da0d63191e85dae93d2685c71944e6f060d0f501e08d4aaf
```

Verificación posterior desde la base:

```text
Columna net_total                                  presente
Índices únicos 016                                 2/2
Métricas financieras abril 2026                    9
Ingresos                                           51,845,041,733.93
Utilidad neta                                      1,266,594,904.78
Margen neto                                        2.4430%
Métricas pendientes de validación financiera       9
Agregados nómina junio 2026                        12 áreas / 157 personas
Devengado agregado                                 589,005,147.00
Deducciones agregadas                              80,418,102.88
Neto calculado                                     508,587,044.12
Alertas de calidad                                 1
Nivel de visibilidad                               junta_agregado
Columnas personales en tabla agregada              0
PostgREST financial/payroll                        200 / contrato completo
Preview Vercel                                     Ready
```

## Gates pendientes

1. **Validación financiera:** confirmar cifras y periodos con el responsable financiero.
2. **Control nómina:** revisar la diferencia agregada de Agencia Medellín en el archivo fuente.
3. **QA autenticado:** ejecutar matriz por roles cuando Juan decida retomarlo.
4. **Gate merge/deploy:** PR #12 continúa draft; no merge ni deploy productivo sin aprobación.
