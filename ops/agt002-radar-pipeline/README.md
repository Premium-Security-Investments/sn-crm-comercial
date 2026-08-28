# AGT-002 Radar queue worker — runbook local

**[Actualizado 2026-08-28]** Este directorio ya no ejecuta el pipeline combinado. El `ExecStart` de
`agt002-radar-pipeline.service` —disparado por `agt002-radar-pipeline.timer` cada 15 minutos— pasa a
importar y ejecutar `createAgt002RadarWorker` (`agt002-radar-worker.js`): **reclama primero** un job
de la cola durable y, si no hay ninguno, retorna de inmediato (`status:'empty'`) sin refrescar ESU ni
leer una página completa de `psi_public_tenders`. El único trabajo que este proceso descubre por sí
mismo es *cuál* job reclamó; *qué* hay para drenar lo decide la exploración diaria vecina,
`ops/agt002-radar-scan/` (`agt002-radar-scan.js`), que corre una vez al día tras la exportación de
fuente y encola lo que sobrevive el gate. Ver
`docs/superpowers/specs/2026-08-28-agt002-daily-scan-queue-design.md` para el diseño completo de la
separación.

El módulo combinado `agt002-radar-pipeline.js` **se conserva en el árbol** como artefacto de
compatibilidad y rollback (nadie lo importa ya en producción); el `.service`/`.timer` de este
directorio **no cambiaron ni una línea** en este repurpose — sólo cambió el contenido del archivo que
`ExecStart` ya ejecutaba.

Este artefacto **no convierte licitaciones en oportunidades**, no registra GO/NO-GO y no modifica `internal_status` ni `converted_opportunity_id`.

## Estado seguro por defecto

El archivo versionado `env.example` mantiene:

```dotenv
AGT002_RADAR_GATE=false
AGT002_RADAR_VISIBILITY=false
```

Con `AGT002_RADAR_GATE=false`, el runner responde `disabled` sin consultar base de datos, modificar cola ni invocar proveedor. `AGT002_RADAR_VISIBILITY=true` exige que `AGT002_RADAR_GATE=true`; la configuración rechaza la combinación insegura. Ningún script de este directorio fija flags ni ejecuta `systemctl`.

## Timeout del proveedor y lease de la cola

`AGT002_RADAR_PREANALYSIS_TIMEOUT_MS` acota **una** llamada al proveedor. Rango aceptado:
`1000`..`300000` ms; el valor por defecto y el recomendado en producción es `30000`. Cualquier valor
fuera de rango, no entero o malformado hace fallar cerrado la configuración del runtime: no se
recorta en silencio y no se construye cliente del puente.

El techo son 5 min porque el pipeline reclama el job con `leaseSeconds = 600`. Un timeout igual al
lease no dejaría margen para el aprendizaje, la validación de la salida ni la persistencia: una
respuesta exitosa del proveedor llegaría con la reserva ya vencida. El techo garantiza ≥300 s de
holgura. Ni el lease ni `TimeoutStartSec` cambian con esta variable.

## Contrato operacional

- Radar sólo muestra. Convertir a Oportunidad es una acción humana separada.
- **[Actualizado 2026-08-28]** Una invocación de este proceso **reclama como máximo un job y nada
  más**: nunca refresca ESU ni evalúa una página de `psi_public_tenders`. Eso es responsabilidad
  exclusiva de la exploración diaria (`ops/agt002-radar-scan/`), que corre una vez al día y alimenta
  la cola que este worker drena cada 15 minutos.
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

**[Actualizado 2026-08-28]** El `.service`/`.timer` de este directorio ya están instalados y
habilitados en al menos un entorno operador; el repurpose de este runner **no** requiere reinstalar
ni recargar el `.timer` — sólo el próximo deploy normal del árbol de la aplicación, seguido de la
QA controlada descrita en `docs/superpowers/plans/2026-08-28-agt002-daily-scan-queue-implementation.md`
(Task 8).

## Logs y QA manual

Todos los logs de este proceso quedan en el journal de la unidad, no en la salida de un cron:

```bash
journalctl -u agt002-radar-pipeline.service -n 50 --no-pager
```

Esperado en régimen normal: la mayoría de las corridas de 15 minutos son
`{"status":"empty","stages":["claim"]}` (cola vacía, cero llamadas al puente). Cuando la exploración
diaria (`ops/agt002-radar-scan/`) encoló algo, alguna corrida muestra `status:'completed'` con
`job_id`/`preanalysis_run_id`, o `status:'unavailable'` con `error_code:'stale_input'` si la fila ya
no sobrevivía al reevaluarse.

## Rollback

Ante error, crecimiento de `uncovered_visible_tenders`, staleness inesperada o 503 sostenidos:

1. Poner `AGT002_RADAR_VISIBILITY=false` para restaurar inmediatamente la lectura histórica byte-equivalente.
2. Poner `AGT002_RADAR_GATE=false` para detener nuevas evaluaciones/jobs.
3. Deshabilitar el timer sólo bajo la autorización operacional correspondiente.
4. Conservar ledger, diagnósticos y reporte; no borrar evidencia.
5. Si se hubieran aplicado migraciones, usar el rollback 072 y luego 071 ensayado en PGlite, con aprobación de base de datos.
6. Repetir auditoría y gates antes de considerar una nueva activación.

Copie `env.example` a la ubicación protegida del environment file y complete secretos fuera de control de versiones. Nunca almacene credenciales en este directorio.
