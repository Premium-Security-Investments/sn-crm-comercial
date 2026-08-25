# AGT-002 Radar pipeline — runbook local

Pipeline durable y de una sola ejecución para el preanálisis del Radar. Este artefacto **no convierte licitaciones en oportunidades**, no registra GO/NO-GO y no modifica `internal_status` ni `converted_opportunity_id`.

## Estado seguro por defecto

El archivo versionado `env.example` mantiene:

```dotenv
AGT002_RADAR_GATE=false
AGT002_RADAR_VISIBILITY=false
```

Con `AGT002_RADAR_GATE=false`, el runner responde `disabled` sin consultar base de datos, modificar cola ni invocar proveedor. `AGT002_RADAR_VISIBILITY=true` exige que `AGT002_RADAR_GATE=true`; la configuración rechaza la combinación insegura. Ningún script de este directorio fija flags ni ejecuta `systemctl`.

## Contrato operacional

- Radar sólo muestra. Convertir a Oportunidad es una acción humana separada.
- Una invocación evalúa una página acotada y reclama como máximo un job.
- El aprendizaje es read-only, específico por candidato y acotado.
- El gate determinista y el preanálisis sólo producen su ledger propio mediante RPC gobernadas.
- No hay reintentos internos ni loops continuos.
- Toda licitación cuyo estado vigente sea `convertida_oportunidad` permanece visible aun si es histórica o terminal.
- Con visibilidad activa sólo una canónica fresca `mostrar_en_radar` es visible. `no_mostrar_en_radar`, `no_concluyente`, ausencia, hash stale, policy stale y context stale se ocultan.
- Si el ledger no puede leerse con visibilidad activa, `/api/tenders` responde 503 con `AGT002_RADAR_VISIBILITY_LEDGER_UNAVAILABLE`; no hace fallback abierto.
- El payload público conserva la misma forma; no se añaden campos de gobernanza a las tarjetas.

## Precondiciones antes de cualquier activación

Todas son obligatorias y requieren evidencia revisada:

1. Confirmar el commit realmente desplegado; no asumir que `origin/main` coincide con producción.
2. Revisar y aprobar migraciones 071 y 072. Este trabajo sólo las versiona: no las aplica.
3. Ejecutar pruebas focales, suite completa, build, paridad backend y apply/rollback local con PGlite.
4. Ejecutar la auditoría histórica read-only. Debe producir `uncovered_visible_tenders: []` y `ready_for_visibility_flag: true`.
5. Ejecutar un preanálisis dry-run sin persistencia y revisar sus citas/salida.
6. Revisar presupuesto, límites y rollback.
7. Obtener cuatro autorizaciones explícitas y separadas: migrar, instalar unidad, encender flags y habilitar timer.

No ejecutar `systemctl`, aplicar migraciones reales ni activar flags como parte de una revisión local.

## Herramientas read-only

Cargan `.env.local` (o `ENV_FILE`) y exigen `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. Las lecturas REST son GET. No aceptan modo de aplicación ni escriben ledger/cola/CRM.

### 1. Auditoría histórica

```bash
node scripts/agt002-radar-gate-historical-audit.mjs > /tmp/agt002-radar-audit.json
```

Revisar, como mínimo:

- `eliminadas_por_regla` y `data_gaps_por_tipo`;
- `convertidas_eliminadas_por_gate` (informativo: esas filas nunca son ocultables);
- `canonical_breakdown` por ausencia/staleness/veredicto;
- `uncovered_visible_tenders`;
- `ready_for_visibility_flag`.

El comando sale con código 1 cuando existe cobertura pendiente.

### 2. Preanálisis dry-run cero writes

Requiere configuración del bridge/modelo, pero fuerza el gate sólo dentro del objeto de runtime efímero; no cambia el entorno desplegado:

```bash
node scripts/agt002-radar-preanalysis-dryrun.mjs <tender-id> > /tmp/agt002-radar-dryrun.json
```

El resultado declara `mode: read_only_dry_run` y `persisted: false`. No encola, reclama, completa ni falla jobs.

### 3. Informe de señales y propuesta de aprendizaje

```bash
node scripts/agt002-radar-learning-signals-report.mjs > /tmp/agt002-radar-learning.json
```

Produce señales acotadas por candidato y una propuesta global `DRAFT` con aprobación humana obligatoria. No cambia políticas ni influye directamente en gate/visibilidad.

## Instalación (fuera de alcance local)

`agt002-radar-pipeline.service` y `.timer` son artefactos de deployment. Copiar secretos a una ruta protegida fuera del repositorio. La instalación/habilitación con `systemctl` requiere una **autorización separada** y sólo procede después de las autorizaciones anteriores. Este runbook no autoriza ni ejecuta esa operación.

## Rollback

Ante error, crecimiento de `uncovered_visible_tenders`, staleness inesperada o 503 sostenidos:

1. Poner `AGT002_RADAR_VISIBILITY=false` para restaurar inmediatamente la lectura histórica byte-equivalente.
2. Poner `AGT002_RADAR_GATE=false` para detener nuevas evaluaciones/jobs.
3. Deshabilitar el timer sólo bajo la autorización operacional correspondiente.
4. Conservar ledger, diagnósticos y reporte; no borrar evidencia.
5. Si se hubieran aplicado migraciones, usar el rollback 072 y luego 071 ensayado en PGlite, con aprobación de base de datos.
6. Repetir auditoría y gates antes de considerar una nueva activación.

Copie `env.example` a la ubicación protegida del environment file y complete secretos fuera de control de versiones. Nunca almacene credenciales en este directorio.
